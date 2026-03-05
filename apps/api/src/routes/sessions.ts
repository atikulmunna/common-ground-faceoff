import { Router } from "express";
import { randomUUID } from "node:crypto";
import {
  analyzeSessionSchema,
  createSessionSchema,
  createShareLinkSchema,
  feedbackRatingSchema,
  inviteParticipantSchema,
  submitPositionSchema
} from "@common-ground/shared";

import { prisma } from "../lib/prisma.js";
import { createErrorResponse, createSuccessResponse } from "../lib/response.js";
import { requireSessionAccess } from "../middleware/rbac.js";
import { enqueueAnalysis } from "../services/queueService.js";
import { runAnalysis } from "../services/analysisService.js";

export const sessionsRouter = Router();

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

sessionsRouter.post("/", async (req, res) => {
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

sessionsRouter.post("/:id/invite", requireSessionAccess, async (req, res) => {
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

  if (session.creatorUserId !== req.user.id && req.user.role !== "institutional_admin") {
    res.status(403).json(createErrorResponse("authz_error", "Only creator or admin can invite"));
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

  res.json(createSuccessResponse({ participant, invitation: "queued_email_placeholder" }));
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

  res.json(createSuccessResponse({ participant: updated }));
});

sessionsRouter.post("/:id/analyze", requireSessionAccess, async (req, res) => {
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
      res.status(202).json(
        createSuccessResponse({
          status: "queued",
          pipelineRunId: result.pipelineRunId,
          analysisVersion: parse.data.analysisVersion,
          promptTemplateVersion: parse.data.promptTemplateVersion
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
        result: result.status === "completed" ? result.result : null
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
    participants: session.participants.map((participant: { userId: string; positionText: string | null }) => {
      const canSeeRaw = participant.userId === req.user.id || session.status === "completed";
      return {
        ...participant,
        positionText: canSeeRaw ? participant.positionText : null
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

  const session = await prisma.session.findUnique({ where: { id: req.params.id } });

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
        result: null
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
      result
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
