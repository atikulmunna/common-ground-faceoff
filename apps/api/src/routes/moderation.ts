import { Router } from "express";
import { reportContentSchema, moderationActionSchema } from "@common-ground/shared";

import { prisma } from "../lib/prisma.js";
import { createErrorResponse, createSuccessResponse } from "../lib/response.js";

export const moderationRouter = Router();

/* ------------------------------------------------------------------ */
/*  Auto-flag helpers (CG-FR50, CG-FR63, CG-FR64)                     */
/* ------------------------------------------------------------------ */

const HATE_PATTERNS = [
  /\b(kill|murder|attack|bomb|shoot)\b.*\b(you|them|people|group)\b/i,
  /\b(hate|exterminate|eliminate)\b.*\b(race|ethnic|religion|gender)\b/i,
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

/* ------------------------------------------------------------------ */
/*  GET /moderation/queue — moderator queue (CG-FR51, FR52)            */
/* ------------------------------------------------------------------ */

moderationRouter.get("/queue", async (req, res) => {
  if (req.user.role !== "moderator" && req.user.role !== "institutional_admin") {
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

  const flags = await prisma.moderationFlag.findMany({
    where,
    orderBy: [
      { severity: "desc" },
      { createdAt: "asc" },
    ],
    take: 50,
  });

  res.json(createSuccessResponse({ flags }));
});

/* ------------------------------------------------------------------ */
/*  POST /moderation/:flagId/review — moderator action (CG-FR52)       */
/* ------------------------------------------------------------------ */

moderationRouter.post("/:flagId/review", async (req, res) => {
  if (req.user.role !== "moderator" && req.user.role !== "institutional_admin") {
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

  // CG-FR51: If deleted, suspend the session
  if (parse.data.action === "delete") {
    await prisma.session.update({
      where: { id: flag.sessionId },
      data: { status: "needs_input" },
    });
  }

  res.json(createSuccessResponse({ flag: updatedFlag }));
});

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

  const flag = await prisma.moderationFlag.findUnique({ where: { id: req.params.flagId } });
  if (!flag) {
    res.status(404).json(createErrorResponse("not_found", "Flag not found"));
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
