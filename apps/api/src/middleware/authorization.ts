import type { Request, Response, NextFunction } from "express";

import { prisma } from "../lib/prisma.js";
import { createErrorResponse } from "../lib/response.js";

/* ------------------------------------------------------------------ */
/*  CG-FR61: Authorization Matrix (SRS §6.2)                          */
/*  CG-FR62: Denied-action audit logging with IP                       */
/* ------------------------------------------------------------------ */

/**
 * Actions from the SRS §6.2 authorization matrix.
 */
export type AuthzAction =
  | "create_session"
  | "invite_participants"
  | "view_own_position"
  | "view_others_positions_pre_analysis"
  | "trigger_analysis"
  | "export_session"
  | "revoke_share_links"
  | "moderate_flagged_content"
  | "access_org_analytics"
  | "manage_cohorts";

type UserRole =
  | "individual_user"
  | "session_creator"
  | "session_participant"
  | "institutional_admin"
  | "moderator";

/**
 * "yes" = unconditionally allowed
 * "org_scope" = allowed but only within org
 * "if_granted" = allowed when the participant has canExport=true
 * "flagged_only" = limited to flagged content viewing
 * "no" = denied
 */
type Permission = "yes" | "no" | "org_scope" | "if_granted" | "flagged_only";

const MATRIX: Record<AuthzAction, Record<UserRole, Permission>> = {
  create_session: {
    individual_user: "yes",
    session_creator: "yes",
    session_participant: "no",
    institutional_admin: "yes",
    moderator: "no",
  },
  invite_participants: {
    individual_user: "no",
    session_creator: "yes",
    session_participant: "no",
    institutional_admin: "yes",
    moderator: "no",
  },
  view_own_position: {
    individual_user: "yes",
    session_creator: "yes",
    session_participant: "yes",
    institutional_admin: "org_scope",
    moderator: "flagged_only",
  },
  view_others_positions_pre_analysis: {
    individual_user: "no",
    session_creator: "no",
    session_participant: "no",
    institutional_admin: "no",
    moderator: "flagged_only",
  },
  trigger_analysis: {
    individual_user: "no",
    session_creator: "yes",
    session_participant: "no",
    institutional_admin: "yes",
    moderator: "no",
  },
  export_session: {
    individual_user: "no",
    session_creator: "yes",
    session_participant: "if_granted",
    institutional_admin: "org_scope",
    moderator: "no",
  },
  revoke_share_links: {
    individual_user: "no",
    session_creator: "yes",
    session_participant: "no",
    institutional_admin: "org_scope",
    moderator: "no",
  },
  moderate_flagged_content: {
    individual_user: "no",
    session_creator: "no",
    session_participant: "no",
    institutional_admin: "no",
    moderator: "yes",
  },
  access_org_analytics: {
    individual_user: "no",
    session_creator: "no",
    session_participant: "no",
    institutional_admin: "yes",
    moderator: "no",
  },
  manage_cohorts: {
    individual_user: "no",
    session_creator: "no",
    session_participant: "no",
    institutional_admin: "yes",
    moderator: "no",
  },
};

/**
 * Resolve the effective role for a user relative to a session.
 * A user with role "individual_user" who is the creator of the session
 * gets elevated to "session_creator"; if they are a participant, to
 * "session_participant". institutional_admin and moderator roles are
 * always returned as-is.
 */
function resolveEffectiveRole(
  userRole: UserRole,
  userId: string,
  session?: { creatorUserId: string; participants: { userId: string }[] } | null,
): UserRole {
  if (userRole === "institutional_admin" || userRole === "moderator") {
    return userRole;
  }

  if (session) {
    if (session.creatorUserId === userId) return "session_creator";
    if (session.participants.some((p) => p.userId === userId)) return "session_participant";
  }

  return userRole;
}

/**
 * Check if a user is authorized for a specific action.
 * Returns the Permission value from the matrix.
 */
export function checkPermission(
  action: AuthzAction,
  userRole: UserRole,
  userId: string,
  session?: { creatorUserId: string; participants: { userId: string; canExport?: boolean }[] } | null,
): { allowed: boolean; permission: Permission; effectiveRole: UserRole } {
  const effectiveRole = resolveEffectiveRole(userRole, userId, session);
  const permission = MATRIX[action][effectiveRole];

  let allowed = false;
  switch (permission) {
    case "yes":
      allowed = true;
      break;
    case "org_scope":
      // For org_scope, we allow it — the route handler should verify org membership
      allowed = true;
      break;
    case "if_granted":
      // Check canExport on the participant record
      if (session) {
        const participant = session.participants.find((p) => p.userId === userId);
        allowed = !!participant?.canExport;
      }
      break;
    case "flagged_only":
      // Limited access — allow through, route handler enforces flagged-only scope
      allowed = effectiveRole === "moderator";
      break;
    case "no":
      allowed = false;
      break;
  }

  return { allowed, permission, effectiveRole };
}

/**
 * CG-FR62: Log denied action attempts to AuditLog with actor, action,
 * resource, timestamp, and source IP.
 */
export async function logDeniedAction(
  req: Request,
  action: AuthzAction,
  resourceId?: string,
): Promise<void> {
  const ip = req.headers["x-forwarded-for"]
    ? String(req.headers["x-forwarded-for"]).split(",")[0].trim()
    : req.ip ?? "unknown";

  await prisma.auditLog.create({
    data: {
      eventType: "authz_denied",
      actorId: req.user?.id ?? null,
      actorEmail: req.user?.email ?? null,
      ip,
      detail: JSON.stringify({
        action,
        resource: resourceId ?? req.params.id ?? null,
        method: req.method,
        path: req.path,
        role: req.user?.role ?? "anonymous",
      }),
    },
  });
}

/**
 * Express middleware factory: require a specific authorization matrix action.
 * Optionally accepts a session loader function for session-scoped actions.
 *
 * Usage:
 *   router.post("/", requirePermission("create_session"), handler);
 *   router.post("/:id/analyze", requirePermission("trigger_analysis", { sessionScoped: true }), handler);
 */
export function requirePermission(
  action: AuthzAction,
  opts: { sessionScoped?: boolean } = {},
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    let session: { creatorUserId: string; participants: { userId: string; canExport: boolean }[] } | null = null;

    if (opts.sessionScoped && req.params.id) {
      const found = await prisma.session.findUnique({
        where: { id: req.params.id },
        select: {
          creatorUserId: true,
          participants: { select: { userId: true, canExport: true } },
        },
      });
      session = found;

      if (!session) {
        res.status(404).json(createErrorResponse("not_found", "Session not found"));
        return;
      }
    }

    const { allowed } = checkPermission(
      action,
      req.user.role as UserRole,
      req.user.id,
      session,
    );

    if (!allowed) {
      await logDeniedAction(req, action, req.params.id);
      res.status(403).json(
        createErrorResponse("authz_error", `Not authorized for action: ${action}`),
      );
      return;
    }

    next();
  };
}
