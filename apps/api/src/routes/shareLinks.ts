import { Router } from "express";

import { prisma } from "../lib/prisma.js";
import { createErrorResponse, createSuccessResponse } from "../lib/response.js";
import { logDeniedAction } from "../middleware/authorization.js";
import { staffCanAccessSession } from "../middleware/rbac.js";

export const shareLinksRouter = Router();
export const publicShareLinksRouter = Router();

/* ------------------------------------------------------------------ */
/*  GET /share-links/view/:token — read-only shared view (CG-FR38)     */
/*  Public route — no auth required                                    */
/* ------------------------------------------------------------------ */

publicShareLinksRouter.get("/view/:token", async (req, res) => {
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

  // Build the read-only view. Raw perspectives and internal details (model, confidence) stay private.
  const readOnlySession = {
    id: session.id,
    topic: session.topic,
    status: session.status,
    anonymousMode: session.anonymousMode,
    createdAt: session.createdAt,
    analyzedAt: session.analyzedAt,
    participantCount: session.participants.length,
    participants: session.participants.map((p) => ({
      displayName: session.anonymousMode ? "Anonymous participant" : p.user.displayName,
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

  const isCreator = session.creatorUserId === req.user.id;
  const isOrganizationAdmin =
    req.user.role === "institutional_admin" && (await staffCanAccessSession(req.user, session));

  if (!isCreator && !isOrganizationAdmin) {
    await logDeniedAction(req, "revoke_share_links", link.sessionId);

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
