import { randomUUID } from "node:crypto";
import { Router } from "express";
import {
  createShareLinkSchema,
  feedbackRatingSchema,
  sectionCommentSchema,
  sectionReactionSchema,
} from "@common-ground/shared";

import { prisma } from "../lib/prisma.js";
import { anonymousOrderKey, attributeToViewer, labelOrder, participantLabel } from "../lib/conversationPrivacy.js";
import { createErrorResponse, createSuccessResponse } from "../lib/response.js";
import { requireSessionAccess } from "../middleware/rbac.js";
import { summarizeFeedback } from "../services/feedbackSummary.js";

export const sessionCollaborationRouter = Router();

/**
 * Who wrote each restated view in the latest results: label to account id, for the people the
 * analysis included. Uses the same label order as the analysis.
 */
async function restatedViewAuthors(sessionId: string): Promise<Map<string, string>> {
  const [session, latest] = await Promise.all([
    prisma.session.findUnique({
      where: { id: sessionId },
      select: { anonymousMode: true, participants: { select: { id: true, userId: true } } },
    }),
    prisma.analysisResult.findFirst({
      where: { sessionId, status: "completed" },
      orderBy: { roundNumber: "desc" },
      select: { steelmans: true },
    }),
  ]);
  const labelled = new Set(Object.keys((latest?.steelmans as Record<string, unknown> | null) ?? {}));
  const authors = new Map<string, string>();
  labelOrder(sessionId, session?.participants ?? [], Boolean(session?.anonymousMode)).forEach((participant, index) => {
    const label = participantLabel(index);
    if (labelled.has(label)) authors.set(label, participant.userId);
  });
  return authors;
}

async function isAnonymous(sessionId: string): Promise<boolean> {
  const session = await prisma.session.findUnique({ where: { id: sessionId }, select: { anonymousMode: true } });
  return Boolean(session?.anonymousMode);
}

sessionCollaborationRouter.post("/:id/feedback", requireSessionAccess, async (req, res) => {
  const parse = feedbackRatingSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json(createErrorResponse("validation_error", "Invalid feedback payload", parse.error.flatten()));
    return;
  }

  // One answer per person: answering again replaces the earlier answer.
  const [, feedback] = await prisma.$transaction([
    prisma.feedbackRating.deleteMany({ where: { sessionId: req.params.id, userId: req.user.id } }),
    prisma.feedbackRating.create({
      data: {
        sessionId: req.params.id,
        userId: req.user.id,
        fairness: parse.data.fairness,
        comment: parse.data.comment
      }
    }),
  ]);

  res.status(201).json(createSuccessResponse({ feedback }));
});

/* ------------------------------------------------------------------ */
/*  CG-FR58: Post-analysis ratings summary                             */
/* ------------------------------------------------------------------ */

sessionCollaborationRouter.get("/:id/feedback", requireSessionAccess, async (req, res) => {
  const ratings = await prisma.feedbackRating.findMany({
    where: { sessionId: req.params.id },
    select: { fairness: true, faithfulness: true, neutrality: true, userId: true, comment: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  const count = ratings.length;
  const summary = { count, ...summarizeFeedback(ratings) };

  const anonymous = await isAnonymous(req.params.id);
  res.json(createSuccessResponse({
    ratings: attributeToViewer(ratings, req.user.id, anonymous),
    summary,
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
      sharedFoundationPoints: true,
      disagreementPoints: true,
      participantValues: true,
      verification: true,
      roundChanges: true,
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

  // Positions are snapshotted when an analysis starts, so running and failed rounds have snapshots
  // too. Everyone's text may only be revealed once that round has completed results.
  const completedRound = await prisma.analysisResult.findFirst({
    where: { sessionId: req.params.id, roundNumber, status: "completed" },
    select: { id: true },
  });
  if (!completedRound) {
    res.status(404).json(createErrorResponse("not_found", "This round has no completed analysis"));
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

  const anonymous = await isAnonymous(req.params.id);
  // Snapshots are saved in the order people joined; shuffle them stably when anonymous.
  const ordered = anonymous
    ? [...snapshots].sort((a, b) =>
        anonymousOrderKey(req.params.id, a.userId).localeCompare(anonymousOrderKey(req.params.id, b.userId)))
    : snapshots;

  res.json(createSuccessResponse({ snapshots: attributeToViewer(ordered, req.user.id, anonymous) }));
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

  // A restated view is mutually acknowledged when its author confirmed it and everyone else the
  // analysis included said they understand it. Other sections: everyone who answered said yes.
  const authors = Object.keys(bySection).some((section) => section.startsWith("steelman:"))
    ? await restatedViewAuthors(req.params.id)
    : new Map<string, string>();
  const mutualAcknowledgments: Record<string, boolean> = {};
  for (const [section, entries] of Object.entries(bySection)) {
    const author = section.startsWith("steelman:") ? authors.get(section.slice("steelman:".length)) : undefined;
    if (author) {
      const answers = new Map(entries.map((entry) => [entry.userId, entry.reaction]));
      const others = [...authors.values()].filter((userId) => userId !== author);
      mutualAcknowledgments[section] =
        answers.get(author) === "represents" && others.length > 0 && others.every((userId) => answers.get(userId) === "represents");
    } else {
      mutualAcknowledgments[section] = entries.length >= 2 && entries.every((e) => e.reaction === "represents");
    }
  }

  const anonymous = await isAnonymous(req.params.id);
  res.json(createSuccessResponse({
    reactions: attributeToViewer(reactions, req.user.id, anonymous),
    mutualAcknowledgments,
  }));
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

  const anonymous = await isAnonymous(req.params.id);
  res.json(createSuccessResponse({ comments: attributeToViewer(comments, req.user.id, anonymous) }));
});
