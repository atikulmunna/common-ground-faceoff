import { Router } from "express";

import { prisma } from "../lib/prisma.js";
import { createErrorResponse, createSuccessResponse } from "../lib/response.js";

export const shareLinksRouter = Router();

/* ------------------------------------------------------------------ */
/*  GET /share-links/view/:token — read-only shared view (CG-FR38)     */
/*  Public route — no auth required                                    */
/* ------------------------------------------------------------------ */

shareLinksRouter.get("/view/:token", async (req, res) => {
  const link = await prisma.shareLink.findUnique({ where: { token: req.params.token } });
  if (!link) {
    res.status(404).json(createErrorResponse("not_found", "Share link not found"));
    return;
  }

  // CG-FR39: Check revocation
  if (link.revoked) {
    res.status(410).json(createErrorResponse("not_found", "This share link has been revoked"));
    return;
  }

  // Check expiration
  if (link.expiresAt && new Date(link.expiresAt) < new Date()) {
    res.status(410).json(createErrorResponse("not_found", "This share link has expired"));
    return;
  }

  const session = await prisma.session.findUnique({
    where: { id: link.sessionId },
    include: {
      participants: {
        include: {
          user: { select: { displayName: true } },
        },
      },
    },
  });

  if (!session) {
    res.status(404).json(createErrorResponse("not_found", "Session not found"));
    return;
  }

  const analysis = await prisma.analysisResult.findFirst({
    where: { sessionId: session.id, status: "completed" },
    orderBy: [{ roundNumber: "desc" }, { createdAt: "desc" }],
  });

  // Build read-only view (hide raw positions for privacy)
  const readOnlySession = {
    id: session.id,
    topic: session.topic,
    status: session.status,
    anonymousMode: session.anonymousMode,
    createdAt: session.createdAt,
    analyzedAt: session.analyzedAt,
    participantCount: session.participants.length,
    participants: session.participants.map((p) => ({
      displayName: session.anonymousMode ? "Anonymous Participant" : p.user.displayName,
      role: p.role,
    })),
  };

  const readOnlyAnalysis = analysis
    ? {
        roundNumber: analysis.roundNumber,
        steelmans: analysis.steelmans,
        conflictMap: analysis.conflictMap,
        sharedFoundations: analysis.sharedFoundations,
        trueDisagreements: analysis.trueDisagreements,
        confidenceScores: analysis.confidenceScores,
        llmProvider: analysis.llmProvider,
        modelVersion: analysis.modelVersion,
        createdAt: analysis.createdAt,
      }
    : null;

  res.json(createSuccessResponse({ session: readOnlySession, analysis: readOnlyAnalysis }));
});

shareLinksRouter.delete("/:id", async (req, res) => {
  const link = await prisma.shareLink.findUnique({ where: { id: req.params.id } });
  if (!link) {
    res.status(404).json(createErrorResponse("not_found", "Share link not found"));
    return;
  }

  const session = await prisma.session.findUnique({ where: { id: link.sessionId } });
  if (!session) {
    res.status(404).json(createErrorResponse("not_found", "Session not found"));
    return;
  }

  if (session.creatorUserId !== req.user.id && req.user.role !== "institutional_admin") {
    await prisma.analysisEvent.create({
      data: {
        sessionId: link.sessionId,
        pipelineRunId: "authz",
        eventType: "authz_denied",
        actorType: req.user.role,
        reasonCode: "share_link_revoke_denied"
      }
    });

    res.status(403).json(createErrorResponse("authz_error", "Only creator/admin can revoke share links"));
    return;
  }

  const revoked = await prisma.shareLink.update({
    where: { id: req.params.id },
    data: {
      revoked: true,
      revocationReason: "manual_revoke"
    }
  });

  res.json(createSuccessResponse({ shareLink: revoked }));
});
