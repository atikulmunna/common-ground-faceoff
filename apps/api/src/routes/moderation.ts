import { Router } from "express";
import { reportContentSchema, moderationActionSchema } from "@common-ground/shared";

import { prisma } from "../lib/prisma.js";
import { createErrorResponse, createSuccessResponse } from "../lib/response.js";
import { logDeniedAction } from "../middleware/authorization.js";
import { staffCanAccessSession } from "../middleware/rbac.js";
import { computeModerationSlaDueAt, getModerationSlaTargetMinutes } from "../lib/moderationSla.js";

export const moderationRouter = Router();

/* ------------------------------------------------------------------ */
/*  Auto-flag helpers (CG-FR50, CG-FR63, CG-FR64)                     */
/* ------------------------------------------------------------------ */

const HATE_PATTERNS = [
  /\b(kill|murder|attack|bomb|shoot)\b.*\b(you|them|people|group)\b/i,
  /\b(hate|exterminate|eliminate)\b.*\b(race|racial|ethnic|ethnicity|religion|religious|gender)\b/i,
];

export function detectSeverity(text: string): { flagged: boolean; severity: "low" | "medium" | "high" | "critical" } {
  for (const pattern of HATE_PATTERNS) {
    if (pattern.test(text)) return { flagged: true, severity: "critical" };
  }
  // Additional keyword heuristic
  const threats = /\b(threaten|threat|die|destroy)\b/i;
  if (threats.test(text)) return { flagged: true, severity: "high" };
  return { flagged: false, severity: "low" };
}

/* ------------------------------------------------------------------ */
/*  POST /moderation/report/:sessionId — user reports content (CG-FR53)*/
/* ------------------------------------------------------------------ */

moderationRouter.post("/report/:sessionId", async (req, res) => {
  const parse = reportContentSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json(createErrorResponse("validation_error", "Invalid report payload", parse.error.flatten()));
    return;
  }

  // Verify the user is a participant in the session
  const participant = await prisma.sessionParticipant.findUnique({
    where: {
      sessionId_userId: {
        sessionId: req.params.sessionId,
        userId: req.user.id,
      },
    },
  });
  if (!participant) {
    res.status(403).json(createErrorResponse("authz_error", "Not a participant in this session"));
    return;
  }

  const flag = await prisma.moderationFlag.create({
    data: {
      sessionId: req.params.sessionId,
      reportedBy: req.user.id,
      reason: parse.data.reason,
      section: parse.data.section,
      severity: "medium",
      autoDetected: false,
      status: "pending",
      slaDueAt: computeModerationSlaDueAt("medium"),
    },
  });

  // CG-FR54: Audit log
  await prisma.auditLog.create({
    data: {
      eventType: "content_reported",
      actorId: req.user.id,
      actorEmail: req.user.email,
      ip: req.ip,
      detail: `session:${req.params.sessionId} flag:${flag.id}`,
    },
  });

  res.status(201).json(createSuccessResponse({ flag }));
});

/** Conversations created by members of the admin's organization; none when the admin has no organization. */
async function organizationSessionIds(adminId: string): Promise<string[]> {
  const admin = await prisma.user.findUnique({ where: { id: adminId }, select: { organizationId: true } });
  if (!admin?.organizationId) return [];
  const sessions = await prisma.session.findMany({
    where: { creator: { organizationId: admin.organizationId } },
    select: { id: true },
  });
  return sessions.map((session) => session.id);
}

/* ------------------------------------------------------------------ */
/*  GET /moderation/queue: moderator queue (CG-FR51, FR52)             */
/* ------------------------------------------------------------------ */

moderationRouter.get("/queue", async (req, res) => {
  if (req.user.role !== "moderator" && req.user.role !== "institutional_admin") {
    await logDeniedAction(req, "moderate_flagged_content");
    res.status(403).json(createErrorResponse("authz_error", "Moderator access required"));
    return;
  }

  const { status } = req.query;
  const where: Record<string, unknown> = {};
  if (status && typeof status === "string") {
    where.status = status;
  } else {
    where.status = "pending";
  }
  // Moderators work platform-wide; institutional admins only see their organization's conversations.
  if (req.user.role === "institutional_admin") {
    where.sessionId = { in: await organizationSessionIds(req.user.id) };
  }

  const flags = await prisma.moderationFlag.findMany({
    where,
    orderBy: [
      { severity: "desc" },
      { createdAt: "asc" },
    ],
    take: 50,
    include: { participant: { select: { positionText: true } } },
  });

  const now = new Date();
  const updates = flags
    .filter((f) => f.status === "pending" && f.slaDueAt && f.slaDueAt < now && !f.slaBreachedAt)
    .map((f) =>
      prisma.moderationFlag.update({
        where: { id: f.id },
        data: { slaBreachedAt: now },
      })
    );
  if (updates.length > 0) await prisma.$transaction(updates);

  const enrichedFlags = flags.map(({ participant, ...f }) => {
    const targetMinutes = getModerationSlaTargetMinutes(f.severity);
    const isBreached = f.status === "pending" && !!f.slaDueAt && f.slaDueAt < now;
    const remainingSeconds =
      f.status === "pending" && f.slaDueAt
        ? Math.max(0, Math.ceil((new Date(f.slaDueAt).getTime() - now.getTime()) / 1000))
        : null;

    return {
      ...f,
      // The text under review, so moderators can judge it. Null when the flag names no position.
      flaggedText: participant?.positionText ?? null,
      sla: {
        targetMinutes,
        dueAt: f.slaDueAt,
        breachedAt: f.slaBreachedAt ?? (isBreached ? now : null),
        isBreached,
        remainingSeconds,
      },
    };
  });

  res.json(createSuccessResponse({ flags: enrichedFlags }));
});

/* ------------------------------------------------------------------ */
/*  POST /moderation/:flagId/review — moderator action (CG-FR52)       */
/* ------------------------------------------------------------------ */

moderationRouter.post("/:flagId/review", async (req, res) => {
  if (req.user.role !== "moderator" && req.user.role !== "institutional_admin") {
    await logDeniedAction(req, "moderate_flagged_content", req.params.flagId);
    res.status(403).json(createErrorResponse("authz_error", "Moderator access required"));
    return;
  }

  const parse = moderationActionSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json(createErrorResponse("validation_error", "Invalid review payload", parse.error.flatten()));
    return;
  }

  const flag = await prisma.moderationFlag.findUnique({ where: { id: req.params.flagId } });
  if (!flag) {
    res.status(404).json(createErrorResponse("not_found", "Flag not found"));
    return;
  }

  if (req.user.role === "institutional_admin") {
    const session = await prisma.session.findUnique({
      where: { id: flag.sessionId },
      select: { id: true, creatorUserId: true },
    });
    if (!session || !(await staffCanAccessSession(req.user, session))) {
      await logDeniedAction(req, "moderate_flagged_content", flag.id);
      res.status(403).json(createErrorResponse("authz_error", "This flag belongs to another organization"));
      return;
    }
  }

  const updatedFlag = await prisma.moderationFlag.update({
    where: { id: req.params.flagId },
    data: {
      status: parse.data.action === "approve" ? "approved" : parse.data.action === "delete" ? "deleted" : "edited",
      reviewedBy: req.user.id,
      reviewNotes: parse.data.notes,
      editedContent: parse.data.action === "edit" ? parse.data.editedContent : undefined,
      reviewedAt: new Date(),
    },
  });

  // CG-FR54: Immutable audit log
  await prisma.auditLog.create({
    data: {
      eventType: `moderation_${parse.data.action}`,
      actorId: req.user.id,
      actorEmail: req.user.email,
      ip: req.ip,
      detail: `flag:${flag.id} session:${flag.sessionId}`,
    },
  });

  // CG-FR51: Deleting suspends the conversation and, when the flag names a position, removes it.
  if (parse.data.action === "delete") {
    await prisma.session.update({
      where: { id: flag.sessionId },
      data: { status: "needs_input" },
    });
    if (flag.participantId) {
      await removeFlaggedPosition(flag.sessionId, flag.participantId);
    }
  }

  res.json(createSuccessResponse({ flag: updatedFlag }));
});

/**
 * Clears a position a moderator deleted, so it never reaches the analysis, and marks it removed so its
 * author is asked to rewrite it (analysis waits until they do).
 */
async function removeFlaggedPosition(sessionId: string, participantId: string): Promise<void> {
  const participant = await prisma.sessionParticipant.update({
    where: { id: participantId },
    data: { positionText: null, positionSubmittedAt: null, positionRemovedAt: new Date() },
  });

  // Copies saved when an analysis started become readable once that round completes,
  // so drop the author's copies from rounds that have no results yet.
  const latestCompleted = await prisma.analysisResult.findFirst({
    where: { sessionId, status: "completed" },
    orderBy: { roundNumber: "desc" },
    select: { roundNumber: true },
  });
  await prisma.positionSnapshot.deleteMany({
    where: { sessionId, userId: participant.userId, roundNumber: { gt: latestCompleted?.roundNumber ?? 0 } },
  });
}

/* ------------------------------------------------------------------ */
/*  POST /moderation/:flagId/appeal — appeal a moderation action       */
/*  (CG-FR66)                                                         */
/* ------------------------------------------------------------------ */

moderationRouter.post("/:flagId/appeal", async (req, res) => {
  const { text } = req.body as { text?: string };
  if (!text || typeof text !== "string" || text.length < 10) {
    res.status(400).json(createErrorResponse("validation_error", "Appeal text must be at least 10 characters"));
    return;
  }

  const flag = await prisma.moderationFlag.findUnique({
    where: { id: req.params.flagId },
    include: { participant: { select: { userId: true } } },
  });
  if (!flag) {
    res.status(404).json(createErrorResponse("not_found", "Flag not found"));
    return;
  }

  // A flag about someone's perspective can be appealed only by its author. Report flags name no
  // perspective, so any participant of that conversation may appeal those.
  const mayAppeal = flag.participant
    ? flag.participant.userId === req.user.id
    : (await prisma.sessionParticipant.findUnique({
        where: { sessionId_userId: { sessionId: flag.sessionId, userId: req.user.id } },
        select: { id: true },
      })) !== null;
  if (!mayAppeal) {
    await logDeniedAction(req, "appeal_moderation_decision", flag.id);
    res.status(403).json(createErrorResponse("authz_error", "Only the author of the flagged content can appeal"));
    return;
  }

  if (!["approved", "edited", "deleted"].includes(flag.status)) {
    res.status(409).json(createErrorResponse("async_state_error", "Only reviewed flags can be appealed"));
    return;
  }

  const updated = await prisma.moderationFlag.update({
    where: { id: req.params.flagId },
    data: {
      appealText: text,
      appealStatus: "pending_appeal",
      status: "appealed",
    },
  });

  await prisma.auditLog.create({
    data: {
      eventType: "moderation_appeal",
      actorId: req.user.id,
      actorEmail: req.user.email,
      ip: req.ip,
      detail: `flag:${flag.id}`,
    },
  });

  res.json(createSuccessResponse({ flag: updated }));
});

/* ------------------------------------------------------------------ */
/*  GET /moderation/session/:sessionId/sla — participant-visible SLA   */
/*  (CG-FR65)                                                          */
/* ------------------------------------------------------------------ */

moderationRouter.get("/session/:sessionId/sla", async (req, res) => {
  const participant = await prisma.sessionParticipant.findUnique({
    where: {
      sessionId_userId: {
        sessionId: req.params.sessionId,
        userId: req.user.id,
      },
    },
  });
  if (!participant) {
    res.status(403).json(createErrorResponse("authz_error", "Not a participant in this session"));
    return;
  }

  const flags = await prisma.moderationFlag.findMany({
    where: { sessionId: req.params.sessionId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      severity: true,
      status: true,
      createdAt: true,
      reviewedAt: true,
      slaDueAt: true,
      slaBreachedAt: true,
    },
  });

  const now = new Date();
  const pending = flags.filter((f) => f.status === "pending" || f.status === "appealed");
  const breaches = pending.filter((f) => f.slaDueAt && new Date(f.slaDueAt) < now);
  const nextDueAt = pending
    .map((f) => f.slaDueAt)
    .filter((d): d is Date => !!d)
    .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;

  res.json(
    createSuccessResponse({
      summary: {
        pendingCount: pending.length,
        breachedCount: breaches.length,
        nextDueAt,
      },
      flags: pending.map((f) => ({
        ...f,
        sla: {
          targetMinutes: getModerationSlaTargetMinutes(f.severity),
          isBreached: !!f.slaDueAt && new Date(f.slaDueAt) < now,
          remainingSeconds: f.slaDueAt ? Math.max(0, Math.ceil((new Date(f.slaDueAt).getTime() - now.getTime()) / 1000)) : null,
        },
      })),
    })
  );
});
