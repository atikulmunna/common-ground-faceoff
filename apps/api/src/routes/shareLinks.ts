import { Router } from "express";

import { prisma } from "../lib/prisma.js";
import { createErrorResponse, createSuccessResponse } from "../lib/response.js";

export const shareLinksRouter = Router();

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
