import type { NextFunction, Request, Response } from "express";

import { prisma } from "../lib/prisma.js";

export async function requireSessionAccess(req: Request, res: Response, next: NextFunction): Promise<void> {
  const sessionId = req.params.id;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { participants: true }
  });

  if (!session) {
    res.status(404).json({
      success: false,
      data: null,
      error: { code: "not_found", message: "Session not found" }
    });
    return;
  }

  const isCreator = session.creatorUserId === req.user.id;
  const isParticipant = session.participants.some((p: { userId: string }) => p.userId === req.user.id);
  const isAdmin = req.user.role === "institutional_admin";
  const isModerator = req.user.role === "moderator";

  if (!isCreator && !isParticipant && !isAdmin && !isModerator) {
    await prisma.analysisEvent.create({
      data: {
        sessionId,
        pipelineRunId: "authz",
        eventType: "authz_denied",
        actorType: req.user.role,
        reasonCode: "session_access_denied"
      }
    });

    res.status(403).json({
      success: false,
      data: null,
      error: { code: "authz_error", message: "Forbidden" }
    });
    return;
  }

  next();
}
