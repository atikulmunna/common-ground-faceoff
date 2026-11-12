import type { NextFunction, Request, Response } from "express";

import { prisma } from "../lib/prisma.js";
import type { AuthUser } from "./auth.js";
import { logDeniedAction } from "./authorization.js";

/**
 * Staff who are not part of a conversation reach it only within their remit:
 * moderators only when it has a moderation flag, institutional admins only when
 * its creator belongs to their organization.
 */
export async function staffCanAccessSession(
  user: Pick<AuthUser, "id" | "role">,
  session: { id: string; creatorUserId: string },
): Promise<boolean> {
  if (user.role === "moderator") {
    const flag = await prisma.moderationFlag.findFirst({
      where: { sessionId: session.id },
      select: { id: true },
    });
    return flag !== null;
  }

  if (user.role === "institutional_admin") {
    const [admin, creator] = await Promise.all([
      prisma.user.findUnique({ where: { id: user.id }, select: { organizationId: true } }),
      prisma.user.findUnique({ where: { id: session.creatorUserId }, select: { organizationId: true } }),
    ]);
    // Both must belong to an organization; two users without one share nothing.
    return Boolean(admin?.organizationId) && admin?.organizationId === creator?.organizationId;
  }

  return false;
}

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

  if (!isCreator && !isParticipant && !(await staffCanAccessSession(req.user, session))) {
    // CG-FR62: Log denied access with IP to AuditLog
    await logDeniedAction(req, "view_own_position", sessionId);

    res.status(403).json({
      success: false,
      data: null,
      error: { code: "authz_error", message: "Forbidden" }
    });
    return;
  }

  next();
}
