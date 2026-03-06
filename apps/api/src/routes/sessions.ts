import { Router } from "express";
import { randomUUID } from "node:crypto";
import PDFDocument from "pdfkit";
import {
  analyzeSessionSchema,
  createSessionSchema,
  createShareLinkSchema,
  emailInvitationSchema,
  feedbackRatingSchema,
  inviteParticipantSchema,
  sectionCommentSchema,
  sectionReactionSchema,
  submitPositionSchema
} from "@common-ground/shared";

import { prisma } from "../lib/prisma.js";
import { createErrorResponse, createSuccessResponse } from "../lib/response.js";
import { requireSessionAccess } from "../middleware/rbac.js";
import { requirePermission, logDeniedAction } from "../middleware/authorization.js";
import { enqueueAnalysis } from "../services/queueService.js";
import { runAnalysis } from "../services/analysisService.js";
import { detectSeverity } from "./moderation.js";
import { sendSessionInvitation } from "../services/emailService.js";
import { uploadExport } from "../services/storageService.js";

export const sessionsRouter = Router();

/* ------------------------------------------------------------------ */
/*  Dashboard (CG-FR41, FR42, FR43)                                    */
/* ------------------------------------------------------------------ */

sessionsRouter.get("/", async (req, res) => {
  const { status, q, page, from, to } = req.query;

  const where: Record<string, unknown> = {
    participants: { some: { userId: req.user.id } },
  };

  if (status && typeof status === "string" && status !== "all") {
    where.status = status;
  }

  if (q && typeof q === "string" && q.trim().length > 0) {
    where.topic = { contains: q.trim(), mode: "insensitive" };
  }

  if (from && typeof from === "string") {
    const d = new Date(from);
    if (!isNaN(d.getTime())) {
      where.createdAt = { ...(where.createdAt as object ?? {}), gte: d };
    }
  }

  if (to && typeof to === "string") {
    const d = new Date(to);
    if (!isNaN(d.getTime())) {
      // set to end of the day
      d.setHours(23, 59, 59, 999);
      where.createdAt = { ...(where.createdAt as object ?? {}), lte: d };
    }
  }

  const pageNum = Math.max(1, Number(page) || 1);
  const pageSize = 20;
  const skip = (pageNum - 1) * pageSize;

  const [sessions, total] = await Promise.all([
    prisma.session.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
      select: {
        id: true,
        topic: true,
        status: true,
        createdAt: true,
        analyzedAt: true,
        _count: { select: { participants: true } },
      },
    }),
    prisma.session.count({ where }),
  ]);

  const rows = sessions.map((s) => ({
    id: s.id,
    topic: s.topic,
    status: s.status,
    createdAt: s.createdAt,
    analyzedAt: s.analyzedAt,
    participantCount: s._count.participants,
  }));

  res.json(createSuccessResponse({ sessions: rows, total, page: pageNum, pageSize }));
});

sessionsRouter.get("/demo-list", async (_req, res) => {
  const sessions = await prisma.session.findMany({
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      topic: true,
      status: true,
      createdAt: true
    }
  });

  res.json(createSuccessResponse({ sessions }));
});

sessionsRouter.post("/", requirePermission("create_session"), async (req, res) => {
  const parse = createSessionSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json(createErrorResponse("validation_error", "Invalid session payload", parse.error.flatten()));
    return;
  }

  const session = await prisma.session.create({
    data: {
      topic: parse.data.topic,
      anonymousMode: parse.data.anonymousMode,
      deadline: parse.data.deadline ? new Date(parse.data.deadline) : null,
      creatorUserId: req.user.id,
      status: "collecting_positions",
      participants: {
        create: {
          userId: req.user.id,
          role: "session_creator",
          canExport: true
        }
      }
    }
  });

  res.status(201).json(createSuccessResponse({ session }));
});

sessionsRouter.post("/:id/invite", requireSessionAccess, requirePermission("invite_participants", { sessionScoped: true }), async (req, res) => {
  const parse = inviteParticipantSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json(createErrorResponse("validation_error", "Invalid invite payload", parse.error.flatten()));
    return;
  }

  const session = await prisma.session.findUnique({ where: { id: req.params.id } });
  if (!session) {
    res.status(404).json(createErrorResponse("not_found", "Session not found"));
    return;
  }

  // CG-FR11: Enforce participant limits based on creator's tier
  const creator = await prisma.user.findUnique({ where: { id: session.creatorUserId }, select: { tier: true } });
  const maxParticipants = creator?.tier === "free" ? 2 : 6;
  const currentCount = await prisma.sessionParticipant.count({ where: { sessionId: req.params.id } });
  if (currentCount >= maxParticipants) {
    res.status(403).json(createErrorResponse("limit_reached", `Participant limit reached (${maxParticipants} for ${creator?.tier ?? "free"} tier)`));
    return;
  }

  const invitedUser = await prisma.user.upsert({
    where: { email: parse.data.email },
    update: {},
    create: {
      email: parse.data.email,
      displayName: parse.data.email.split("@")[0]
    }
  });

  const participant = await prisma.sessionParticipant.upsert({
    where: {
      sessionId_userId: {
        sessionId: req.params.id,
        userId: invitedUser.id
      }
    },
    update: { role: "session_participant" },
    create: {
      sessionId: req.params.id,
      userId: invitedUser.id,
      role: "session_participant"
    }
  });

  // CG-FR10/13: Send email invitation via SendGrid & track it
  const inviter = await prisma.user.findUnique({ where: { id: req.user.id }, select: { displayName: true } });
  const emailInvite = await prisma.emailInvitation.upsert({
    where: { sessionId_email: { sessionId: req.params.id, email: parse.data.email } },
    update: { status: "pending" },
    create: {
      sessionId: req.params.id,
      email: parse.data.email,
      invitedById: req.user.id,
      status: "pending",
    },
  });

  const emailSent = await sendSessionInvitation({
    recipientEmail: parse.data.email,
    inviterName: inviter?.displayName ?? "A user",
    sessionTopic: session.topic,
    sessionId: req.params.id,
  });

  if (emailSent) {
    await prisma.emailInvitation.update({
      where: { id: emailInvite.id },
      data: { status: "sent", sentAt: new Date() },
    });
  }

  res.json(createSuccessResponse({ participant, invitation: emailSent ? "sent" : "queued" }));
});

/* ------------------------------------------------------------------ */
/*  CG-FR10/13: Email invitation with optional message                 */
/* ------------------------------------------------------------------ */

sessionsRouter.post("/:id/email-invite", requireSessionAccess, requirePermission("invite_participants", { sessionScoped: true }), async (req, res) => {
  const parse = emailInvitationSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json(createErrorResponse("validation_error", "Invalid email invite payload", parse.error.flatten()));
    return;
  }

  const session = await prisma.session.findUnique({ where: { id: req.params.id } });
  if (!session) {
    res.status(404).json(createErrorResponse("not_found", "Session not found"));
    return;
  }

  // Enforce participant limits
  const creator = await prisma.user.findUnique({ where: { id: session.creatorUserId }, select: { tier: true } });
  const maxParticipants = creator?.tier === "free" ? 2 : 6;
  const currentCount = await prisma.sessionParticipant.count({ where: { sessionId: req.params.id } });
  if (currentCount >= maxParticipants) {
    res.status(403).json(createErrorResponse("limit_reached", `Participant limit reached (${maxParticipants})`));
    return;
  }

  // Upsert the invited user
  const invitedUser = await prisma.user.upsert({
    where: { email: parse.data.email },
    update: {},
    create: {
      email: parse.data.email,
      displayName: parse.data.email.split("@")[0],
    },
  });

  await prisma.sessionParticipant.upsert({
    where: { sessionId_userId: { sessionId: req.params.id, userId: invitedUser.id } },
    update: { role: "session_participant" },
    create: { sessionId: req.params.id, userId: invitedUser.id, role: "session_participant" },
  });

  const inviter = await prisma.user.findUnique({ where: { id: req.user.id }, select: { displayName: true } });
  const emailInvite = await prisma.emailInvitation.upsert({
    where: { sessionId_email: { sessionId: req.params.id, email: parse.data.email } },
    update: { status: "pending" },
    create: {
      sessionId: req.params.id,
      email: parse.data.email,
      invitedById: req.user.id,
      status: "pending",
    },
  });

  const emailSent = await sendSessionInvitation({
    recipientEmail: parse.data.email,
    inviterName: inviter?.displayName ?? "A user",
    sessionTopic: session.topic,
    sessionId: req.params.id,
    message: parse.data.message,
  });

  if (emailSent) {
    await prisma.emailInvitation.update({
      where: { id: emailInvite.id },
      data: { status: "sent", sentAt: new Date() },
    });
  }

  res.json(createSuccessResponse({ status: emailSent ? "sent" : "pending", email: parse.data.email }));
});

sessionsRouter.post("/:id/positions", requireSessionAccess, async (req, res) => {
  const parse = submitPositionSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json(createErrorResponse("validation_error", "Invalid position payload", parse.error.flatten()));
    return;
  }

  // CG-FR17: Block edits once analysis has been triggered
  const session = await prisma.session.findUnique({ where: { id: req.params.id } });
  if (!session) {
    res.status(404).json(createErrorResponse("not_found", "Session not found"));
    return;
  }
  const lockedStatuses = ["queued", "running", "completed"];
  if (lockedStatuses.includes(session.status)) {
    res.status(409).json(createErrorResponse("async_state_error", "Positions cannot be edited after analysis has been triggered"));
    return;
  }

  // CG-FR12: Enforce submission deadline
  if (session.deadline && new Date(session.deadline) < new Date()) {
    res.status(409).json(createErrorResponse("async_state_error", "The position submission deadline has passed"));
    return;
  }

  const participant = await prisma.sessionParticipant.findUnique({
    where: {
      sessionId_userId: {
        sessionId: req.params.id,
        userId: req.user.id
      }
    }
  });

  if (!participant) {
    res.status(403).json(createErrorResponse("authz_error", "User is not a participant in this session"));
    return;
  }

  const updated = await prisma.sessionParticipant.update({
    where: { id: participant.id },
    data: {
      positionText: parse.data.positionText,
      positionSubmittedAt: new Date()
    }
  });

  // CG-FR50, CG-FR64: Auto-flag for High/Critical severity content
  const check = detectSeverity(parse.data.positionText);
  if (check.flagged && (check.severity === "high" || check.severity === "critical")) {
    await prisma.moderationFlag.create({
      data: {
        sessionId: req.params.id,
        reportedBy: "system",
        reason: `Auto-detected ${check.severity} content`,
        severity: check.severity,
        autoDetected: true,
        status: "pending",
      },
    });

    // CG-FR51: Suspend session for critical content
    if (check.severity === "critical") {
      await prisma.session.update({
        where: { id: req.params.id },
        data: { status: "needs_input" },
      });
    }
  }

  res.json(createSuccessResponse({ participant: updated }));
});

sessionsRouter.post("/:id/analyze", requireSessionAccess, requirePermission("trigger_analysis", { sessionScoped: true }), async (req, res) => {
  const parse = analyzeSessionSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json(createErrorResponse("validation_error", "Invalid analyze payload", parse.error.flatten()));
    return;
  }

  try {
    const result = await runAnalysis({
      sessionId: req.params.id,
      analysisVersion: parse.data.analysisVersion,
      promptTemplateVersion: parse.data.promptTemplateVersion
    });

    if (result.status === "queued") {
      enqueueAnalysis({ sessionId: req.params.id, pipelineRunId: result.pipelineRunId });
      // CG-FR57: Include estimated completion time for async runs
      const updatedSession = await prisma.session.findUnique({
        where: { id: req.params.id },
        select: { estimatedCompletionAt: true },
      });
      res.status(202).json(
        createSuccessResponse({
          status: "queued",
          pipelineRunId: result.pipelineRunId,
          analysisVersion: parse.data.analysisVersion,
          promptTemplateVersion: parse.data.promptTemplateVersion,
          estimatedCompletionAt: updatedSession?.estimatedCompletionAt ?? null,
        })
      );
      return;
    }

    res.json(
      createSuccessResponse({
        status: result.status,
        pipelineRunId: result.pipelineRunId,
        analysisVersion: parse.data.analysisVersion,
        promptTemplateVersion: parse.data.promptTemplateVersion,
        result: result.status === "completed" ? result.result : null,
        estimatedCompletionAt: null,
      })
    );
  } catch (error) {
    res.status(422).json(
      createErrorResponse(
        "async_state_error",
        error instanceof Error ? error.message : "Analysis could not be started"
      )
    );
  }
});

sessionsRouter.get("/:id", requireSessionAccess, async (req, res) => {
  const session = await prisma.session.findUnique({
    where: { id: req.params.id },
    include: {
      participants: {
        include: {
          user: {
            select: { id: true, email: true, displayName: true }
          }
        }
      }
    }
  });

  if (!session) {
    res.status(404).json(createErrorResponse("not_found", "Session not found"));
    return;
  }

  const sessionWithPrivacy = {
    ...session,
    participants: session.participants.map((participant: { userId: string; positionText: string | null; user: { id: string; email: string; displayName: string } }) => {
      const canSeeRaw = participant.userId === req.user.id || session.status === "completed";
      // CG-FR14: In anonymous mode, hide other participant identities until analysis is complete
      const hideIdentity = session.anonymousMode && session.status !== "completed" && participant.userId !== req.user.id;
      return {
        ...participant,
        positionText: canSeeRaw ? participant.positionText : null,
        user: hideIdentity
          ? { id: participant.user.id, email: "anonymous", displayName: "Anonymous Participant" }
          : participant.user,
      };
    })
  };

  res.json(createSuccessResponse({ session: sessionWithPrivacy }));
});

sessionsRouter.get("/:id/analysis", requireSessionAccess, async (req, res) => {
  const result = await prisma.analysisResult.findFirst({
    where: { sessionId: req.params.id },
    orderBy: [{ roundNumber: "desc" }, { createdAt: "desc" }]
  });

  const session = await prisma.session.findUnique({
    where: { id: req.params.id },
    select: { status: true, estimatedCompletionAt: true },
  });

  if (!session) {
    res.status(404).json(createErrorResponse("not_found", "Session not found"));
    return;
  }

  if (!result) {
    res.json(
      createSuccessResponse({
        status: session.status,
        pipelineRunId: null,
        analysisVersion: null,
        promptTemplateVersion: null,
        result: null,
        estimatedCompletionAt: session.estimatedCompletionAt,
      })
    );
    return;
  }

  res.json(
    createSuccessResponse({
      status: result.status,
      pipelineRunId: result.pipelineRunId,
      analysisVersion: result.analysisVersion,
      promptTemplateVersion: result.promptTemplateVersion,
      result,
      estimatedCompletionAt: session.estimatedCompletionAt,
    })
  );
});

sessionsRouter.post("/:id/feedback", requireSessionAccess, async (req, res) => {
  const parse = feedbackRatingSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json(createErrorResponse("validation_error", "Invalid feedback payload", parse.error.flatten()));
    return;
  }

  const feedback = await prisma.feedbackRating.create({
    data: {
      sessionId: req.params.id,
      userId: req.user.id,
      faithfulness: parse.data.faithfulness,
      neutrality: parse.data.neutrality,
      comment: parse.data.comment
    }
  });

  res.status(201).json(createSuccessResponse({ feedback }));
});

/* ------------------------------------------------------------------ */
/*  CG-FR58: Post-analysis ratings summary                             */
/* ------------------------------------------------------------------ */

sessionsRouter.get("/:id/feedback", requireSessionAccess, async (req, res) => {
  const ratings = await prisma.feedbackRating.findMany({
    where: { sessionId: req.params.id },
    select: { faithfulness: true, neutrality: true, userId: true, comment: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  const count = ratings.length;
  const avgFaithfulness = count > 0 ? ratings.reduce((s, r) => s + r.faithfulness, 0) / count : null;
  const avgNeutrality = count > 0 ? ratings.reduce((s, r) => s + r.neutrality, 0) / count : null;

  res.json(createSuccessResponse({
    ratings,
    summary: { count, avgFaithfulness, avgNeutrality },
  }));
});

sessionsRouter.post("/:id/share-links", requireSessionAccess, async (req, res) => {
  const parse = createShareLinkSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json(createErrorResponse("validation_error", "Invalid share-link payload", parse.error.flatten()));
    return;
  }

  const participant = await prisma.sessionParticipant.findUnique({
    where: {
      sessionId_userId: {
        sessionId: req.params.id,
        userId: req.user.id
      }
    }
  });

  const session = await prisma.session.findUnique({ where: { id: req.params.id } });
  const isCreator = session?.creatorUserId === req.user.id;

  if (!isCreator && !participant?.canExport) {
    res.status(403).json(createErrorResponse("authz_error", "No export permission for this session"));
    return;
  }

  const shareLink = await prisma.shareLink.create({
    data: {
      sessionId: req.params.id,
      token: randomUUID(),
      scope: parse.data.scope,
      createdByUserId: req.user.id,
      expiresAt: parse.data.expiresAt ? new Date(parse.data.expiresAt) : null
    }
  });

  res.status(201).json(createSuccessResponse({ shareLink }));
});

/* ------------------------------------------------------------------ */
/*  Re-entry (CG-FR36, CG-FR68)                                        */
/* ------------------------------------------------------------------ */

sessionsRouter.post("/:id/reenter", requireSessionAccess, async (req, res) => {
  const session = await prisma.session.findUnique({ where: { id: req.params.id } });
  if (!session) {
    res.status(404).json(createErrorResponse("not_found", "Session not found"));
    return;
  }

  if (session.creatorUserId !== req.user.id) {
    res.status(403).json(createErrorResponse("authz_error", "Only the session creator can initiate re-entry"));
    return;
  }

  if (session.status !== "completed") {
    res.status(409).json(createErrorResponse("async_state_error", "Re-entry is only available after a completed analysis"));
    return;
  }

  await prisma.session.update({
    where: { id: req.params.id },
    data: { status: "collecting_positions" },
  });

  const latestRound = await prisma.analysisResult.findFirst({
    where: { sessionId: req.params.id },
    orderBy: { roundNumber: "desc" },
    select: { roundNumber: true },
  });

  await prisma.analysisEvent.create({
    data: {
      sessionId: req.params.id,
      pipelineRunId: "reentry",
      eventType: "reentry_initiated",
      fromState: "completed",
      toState: "collecting_positions",
      reasonCode: `round_${(latestRound?.roundNumber ?? 1) + 1}`,
      actorType: "user",
    },
  });

  res.json(createSuccessResponse({ status: "collecting_positions", nextRound: (latestRound?.roundNumber ?? 1) + 1 }));
});

/* ------------------------------------------------------------------ */
/*  Rounds listing & comparison (CG-FR69)                              */
/* ------------------------------------------------------------------ */

sessionsRouter.get("/:id/rounds", requireSessionAccess, async (req, res) => {
  const rounds = await prisma.analysisResult.findMany({
    where: { sessionId: req.params.id, status: "completed" },
    orderBy: { roundNumber: "asc" },
    select: {
      id: true,
      roundNumber: true,
      parentSessionOrRoundId: true,
      analysisVersion: true,
      steelmans: true,
      conflictMap: true,
      sharedFoundations: true,
      trueDisagreements: true,
      confidenceScores: true,
      llmProvider: true,
      modelVersion: true,
      createdAt: true,
    },
  });

  res.json(createSuccessResponse({ rounds }));
});

/* ------------------------------------------------------------------ */
/*  CG-FR68: Per-round position snapshots                              */
/* ------------------------------------------------------------------ */

sessionsRouter.get("/:id/rounds/:roundNumber/positions", requireSessionAccess, async (req, res) => {
  const roundNumber = Number(req.params.roundNumber);
  if (!Number.isInteger(roundNumber) || roundNumber < 1) {
    res.status(400).json(createErrorResponse("validation_error", "roundNumber must be a positive integer"));
    return;
  }

  const snapshots = await prisma.positionSnapshot.findMany({
    where: {
      sessionId: req.params.id,
      roundNumber,
    },
    select: {
      userId: true,
      roundNumber: true,
      positionText: true,
      snapshotAt: true,
    },
    orderBy: { snapshotAt: "asc" },
  });

  res.json(createSuccessResponse({ snapshots }));
});

/* ------------------------------------------------------------------ */
/*  Reactions (CG-FR33, CG-FR34)                                       */
/* ------------------------------------------------------------------ */

sessionsRouter.post("/:id/reactions", requireSessionAccess, async (req, res) => {
  const parse = sectionReactionSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json(createErrorResponse("validation_error", "Invalid reaction payload", parse.error.flatten()));
    return;
  }

  const reaction = await prisma.sectionReaction.upsert({
    where: {
      sessionId_userId_section: {
        sessionId: req.params.id,
        userId: req.user.id,
        section: parse.data.section,
      },
    },
    update: { reaction: parse.data.reaction },
    create: {
      sessionId: req.params.id,
      userId: req.user.id,
      section: parse.data.section,
      reaction: parse.data.reaction,
    },
  });

  res.json(createSuccessResponse({ reaction }));
});

sessionsRouter.get("/:id/reactions", requireSessionAccess, async (req, res) => {
  const reactions = await prisma.sectionReaction.findMany({
    where: { sessionId: req.params.id },
    orderBy: { createdAt: "asc" },
  });

  // Group by section and compute mutual acknowledgment
  const bySection: Record<string, { userId: string; reaction: string }[]> = {};
  for (const r of reactions) {
    if (!bySection[r.section]) bySection[r.section] = [];
    bySection[r.section].push({ userId: r.userId, reaction: r.reaction });
  }

  const mutualAcknowledgments: Record<string, boolean> = {};
  for (const [section, entries] of Object.entries(bySection)) {
    mutualAcknowledgments[section] = entries.length >= 2 && entries.every((e) => e.reaction === "represents");
  }

  res.json(createSuccessResponse({ reactions, mutualAcknowledgments }));
});

/* ------------------------------------------------------------------ */
/*  Section Comments / Annotations (CG-FR35)                           */
/* ------------------------------------------------------------------ */

sessionsRouter.post("/:id/comments", requireSessionAccess, async (req, res) => {
  const parse = sectionCommentSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json(createErrorResponse("validation_error", "Invalid comment payload", parse.error.flatten()));
    return;
  }

  const comment = await prisma.sectionComment.create({
    data: {
      sessionId: req.params.id,
      userId: req.user.id,
      section: parse.data.section,
      text: parse.data.text,
    },
  });

  res.status(201).json(createSuccessResponse({ comment }));
});

sessionsRouter.get("/:id/comments", requireSessionAccess, async (req, res) => {
  const comments = await prisma.sectionComment.findMany({
    where: { sessionId: req.params.id },
    orderBy: { createdAt: "asc" },
  });

  res.json(createSuccessResponse({ comments }));
});

/* ------------------------------------------------------------------ */
/*  Export (CG-FR37, CG-FR40)                                          */
/* ------------------------------------------------------------------ */

sessionsRouter.get("/:id/export/:format", requireSessionAccess, requirePermission("export_session", { sessionScoped: true }), async (req, res) => {
  const format = req.params.format;
  if (!["json", "markdown", "md", "pdf"].includes(format)) {
    res.status(400).json(createErrorResponse("validation_error", "Supported export formats: json, markdown, pdf"));
    return;
  }

  const session = await prisma.session.findUnique({
    where: { id: req.params.id },
    include: {
      participants: {
        include: {
          user: { select: { displayName: true, email: true } }
        }
      }
    }
  });

  if (!session) {
    res.status(404).json(createErrorResponse("not_found", "Session not found"));
    return;
  }

  const analysis = await prisma.analysisResult.findFirst({
    where: { sessionId: req.params.id, status: "completed" },
    orderBy: [{ roundNumber: "desc" }, { createdAt: "desc" }]
  });

  if (!analysis) {
    res.status(422).json(createErrorResponse("async_state_error", "No completed analysis to export"));
    return;
  }

  const exportData = {
    session: {
      id: session.id,
      topic: session.topic,
      createdAt: session.createdAt,
      analyzedAt: session.analyzedAt,
      anonymousMode: session.anonymousMode,
    },
    participants: session.participants.map((p) => ({
      displayName: session.anonymousMode ? `Participant` : p.user.displayName,
      role: p.role,
    })),
    analysis: {
      version: analysis.analysisVersion,
      promptTemplateVersion: analysis.promptTemplateVersion,
      roundNumber: analysis.roundNumber,
      llmProvider: analysis.llmProvider,
      modelVersion: analysis.modelVersion,
      steelmans: analysis.steelmans,
      conflictMap: analysis.conflictMap,
      sharedFoundations: analysis.sharedFoundations,
      trueDisagreements: analysis.trueDisagreements,
      confidenceScores: analysis.confidenceScores,
      createdAt: analysis.createdAt,
    },
  };

  if (format === "json") {
    const jsonContent = JSON.stringify(exportData, null, 2);
    // Fire-and-forget R2 upload
    uploadExport({ sessionId: session.id, format: "json", content: jsonContent, contentType: "application/json" }).catch(() => {});
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="common-ground-${session.id}.json"`);
    res.send(jsonContent);
    return;
  }

  // Shared helpers for markdown and PDF
  const steelmans = (analysis.steelmans as Record<string, string>) ?? {};
  const conflicts = (analysis.conflictMap as Record<string, string[]>) ?? {};
  const confidence = (analysis.confidenceScores as { sharedFoundations?: number; disagreements?: number }) ?? {};

  if (format === "pdf") {
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="common-ground-${session.id}.pdf"`);

    const doc = new PDFDocument({ margin: 50 });

    // Collect PDF buffer for R2 upload
    const pdfChunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => pdfChunks.push(chunk));
    doc.on("end", () => {
      const pdfBuffer = Buffer.concat(pdfChunks);
      uploadExport({ sessionId: session.id, format: "pdf", content: pdfBuffer, contentType: "application/pdf" }).catch(() => {});
    });

    doc.pipe(res);

    // Title
    doc.fontSize(20).text("Common Ground Map", { align: "center" });
    doc.moveDown(0.5);

    // Metadata (CG-FR40)
    doc.fontSize(10).fillColor("#666");
    doc.text(`Topic: ${session.topic}`);
    doc.text(`Date: ${session.createdAt.toISOString().split("T")[0]}`);
    doc.text(`Analysis Version: ${analysis.analysisVersion ?? "v1"}`);
    doc.text(`Model: ${analysis.llmProvider} / ${analysis.modelVersion}`);
    doc.text(`Participants: ${session.participants.map((p) => session.anonymousMode ? "Participant" : p.user.displayName).join(", ")}`);
    doc.moveDown(1);

    // Steelmanned Positions
    doc.fontSize(14).fillColor("#000").text("Steelmanned Positions", { underline: true });
    doc.moveDown(0.3);
    for (const [label, text] of Object.entries(steelmans)) {
      doc.fontSize(12).text(label, { underline: true });
      doc.fontSize(10).fillColor("#333").text(String(text));
      doc.fillColor("#000").moveDown(0.5);
    }

    // Shared Foundations
    doc.fontSize(14).fillColor("#000").text("Shared Foundations", { underline: true });
    if (confidence.sharedFoundations != null) {
      doc.fontSize(9).fillColor("#888").text(`Confidence: ${Math.round(confidence.sharedFoundations * 100)}%`);
    }
    doc.fontSize(10).fillColor("#333").text(analysis.sharedFoundations);
    doc.fillColor("#000").moveDown(0.5);

    // True Disagreements
    doc.fontSize(14).fillColor("#000").text("True Points of Disagreement", { underline: true });
    if (confidence.disagreements != null) {
      doc.fontSize(9).fillColor("#888").text(`Confidence: ${Math.round(confidence.disagreements * 100)}%`);
    }
    doc.fontSize(10).fillColor("#333").text(analysis.trueDisagreements);
    doc.fillColor("#000").moveDown(0.5);

    // Conflict Classification
    if (Object.keys(conflicts).length > 0) {
      doc.fontSize(14).fillColor("#000").text("Conflict Classification", { underline: true });
      doc.moveDown(0.3);
      for (const [category, descriptions] of Object.entries(conflicts)) {
        doc.fontSize(11).text(category.charAt(0).toUpperCase() + category.slice(1));
        for (const desc of descriptions) {
          doc.fontSize(10).fillColor("#333").text(`  • ${desc}`);
        }
        doc.fillColor("#000").moveDown(0.3);
      }
    }

    doc.moveDown(1);
    doc.fontSize(8).fillColor("#999").text(
      `Exported from Common Ground on ${new Date().toISOString().split("T")[0]}`,
      { align: "center" }
    );

    doc.end();
    return;
  }

  // Markdown export

  let md = `# Common Ground Map\n\n`;
  md += `**Topic:** ${session.topic}\n`;
  md += `**Date:** ${session.createdAt.toISOString().split("T")[0]}\n`;
  md += `**Analysis Version:** ${analysis.analysisVersion ?? "v1"}\n`;
  md += `**Model:** ${analysis.llmProvider} / ${analysis.modelVersion}\n\n`;
  md += `---\n\n`;

  md += `## Steelmanned Positions\n\n`;
  for (const [label, text] of Object.entries(steelmans)) {
    md += `### ${label}\n\n${text}\n\n`;
  }

  md += `## Shared Foundations\n\n`;
  if (confidence.sharedFoundations != null) {
    md += `*Confidence: ${Math.round(confidence.sharedFoundations * 100)}%*\n\n`;
  }
  md += `${analysis.sharedFoundations}\n\n`;

  md += `## True Points of Disagreement\n\n`;
  if (confidence.disagreements != null) {
    md += `*Confidence: ${Math.round(confidence.disagreements * 100)}%*\n\n`;
  }
  md += `${analysis.trueDisagreements}\n\n`;

  if (Object.keys(conflicts).length > 0) {
    md += `## Conflict Classification\n\n`;
    for (const [category, descriptions] of Object.entries(conflicts)) {
      md += `### ${category.charAt(0).toUpperCase() + category.slice(1)}\n\n`;
      for (const desc of descriptions) {
        md += `- ${desc}\n`;
      }
      md += `\n`;
    }
  }

  md += `---\n\n*Exported from Common Ground on ${new Date().toISOString().split("T")[0]}*\n`;

  // Fire-and-forget R2 upload
  uploadExport({ sessionId: session.id, format: "md", content: md, contentType: "text/markdown; charset=utf-8" }).catch(() => {});
  res.setHeader("Content-Type", "text/markdown; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="common-ground-${session.id}.md"`);
  res.send(md);
});

/* ------------------------------------------------------------------ */
/*  CG-FR07: Session heartbeat — touch lastActivityAt                  */
/* ------------------------------------------------------------------ */

sessionsRouter.post("/:id/heartbeat", requireSessionAccess, async (req, res) => {
  const TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

  const session = await prisma.session.findUnique({ where: { id: req.params.id } });
  if (!session) {
    res.status(404).json(createErrorResponse("not_found", "Session not found"));
    return;
  }

  // Check if the session has timed out based on lastActivityAt
  if (session.lastActivityAt) {
    const elapsed = Date.now() - new Date(session.lastActivityAt).getTime();
    if (elapsed >= TIMEOUT_MS && session.status === "collecting_positions") {
      await prisma.session.update({
        where: { id: req.params.id },
        data: { status: "needs_input" },
      });
      res.json(createSuccessResponse({ status: "expired", message: "Session expired due to inactivity" }));
      return;
    }
  }

  await prisma.session.update({
    where: { id: req.params.id },
    data: { lastActivityAt: new Date() },
  });

  res.json(createSuccessResponse({ status: "active", lastActivityAt: new Date().toISOString() }));
});
