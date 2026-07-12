import { randomUUID } from "node:crypto";
import { Router } from "express";
import {
  createShareLinkSchema,
  feedbackRatingSchema,
  sectionCommentSchema,
  sectionReactionSchema,
} from "@common-ground/shared";

import { prisma } from "../lib/prisma.js";
import { createErrorResponse, createSuccessResponse } from "../lib/response.js";
import { requireSessionAccess } from "../middleware/rbac.js";

export const sessionCollaborationRouter = Router();

sessionCollaborationRouter.post("/:id/feedback", requireSessionAccess, async (req, res) => {
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

sessionCollaborationRouter.get("/:id/feedback", requireSessionAccess, async (req, res) => {
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

sessionCollaborationRouter.post("/:id/share-links", requireSessionAccess, async (req, res) => {
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

sessionCollaborationRouter.post("/:id/reenter", requireSessionAccess, async (req, res) => {
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

sessionCollaborationRouter.get("/:id/rounds", requireSessionAccess, async (req, res) => {
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

sessionCollaborationRouter.get("/:id/rounds/:roundNumber/positions", requireSessionAccess, async (req, res) => {
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

sessionCollaborationRouter.post("/:id/reactions", requireSessionAccess, async (req, res) => {
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

sessionCollaborationRouter.get("/:id/reactions", requireSessionAccess, async (req, res) => {
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

sessionCollaborationRouter.post("/:id/comments", requireSessionAccess, async (req, res) => {
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

sessionCollaborationRouter.get("/:id/comments", requireSessionAccess, async (req, res) => {
  const comments = await prisma.sectionComment.findMany({
    where: { sessionId: req.params.id },
    orderBy: { createdAt: "asc" },
  });

  res.json(createSuccessResponse({ comments }));
});
