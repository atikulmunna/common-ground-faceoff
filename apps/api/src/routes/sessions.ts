import { Router } from "express";
import {
  analyzeSessionSchema,
  createSessionSchema,
  emailInvitationSchema,
  inviteParticipantSchema,
  submitPositionSchema
} from "@common-ground/shared";

import { prisma } from "../lib/prisma.js";
import { createErrorResponse, createSuccessResponse } from "../lib/response.js";
import { requireSessionAccess } from "../middleware/rbac.js";
import { requirePermission } from "../middleware/authorization.js";
import { enqueueAnalysis } from "../services/queueService.js";
import { runAnalysis } from "../services/analysisService.js";
import { detectSeverity } from "./moderation.js";
import { computeModerationSlaDueAt } from "../lib/moderationSla.js";
import { sendSessionInvitation } from "../services/emailService.js";
import { sessionExportsRouter } from "./sessionExports.js";
import { sessionHeartbeatRouter } from "./sessionHeartbeat.js";
import { sessionCollaborationRouter } from "./sessionCollaboration.js";

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
        slaDueAt: computeModerationSlaDueAt(check.severity),
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
    console.error("[Analyze] Error:", error instanceof Error ? error.message : error);
    if (error instanceof Error && error.stack) console.error(error.stack);
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

sessionsRouter.use(sessionCollaborationRouter);


sessionsRouter.use(sessionExportsRouter);


/* ------------------------------------------------------------------ */
/*  CG-FR07: Session heartbeat — touch lastActivityAt                  */
/* ------------------------------------------------------------------ */

sessionsRouter.use(sessionHeartbeatRouter);
