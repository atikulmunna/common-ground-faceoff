import { Router } from "express";
import { randomUUID } from "node:crypto";
import {
  analyzeSessionSchema,
  createSessionSchema,
  createShareLinkSchema,
  feedbackRatingSchema,
  inviteParticipantSchema,
  sectionReactionSchema,
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
/*  Export (CG-FR37, CG-FR40)                                          */
/* ------------------------------------------------------------------ */

sessionsRouter.get("/:id/export/:format", requireSessionAccess, async (req, res) => {
  const format = req.params.format;
  if (!["json", "markdown", "md"].includes(format)) {
    res.status(400).json(createErrorResponse("validation_error", "Supported export formats: json, markdown"));
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
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="common-ground-${session.id}.json"`);
    res.json(exportData);
    return;
  }

  // Markdown export
  const steelmans = (analysis.steelmans as Record<string, string>) ?? {};
  const conflicts = (analysis.conflictMap as Record<string, string[]>) ?? {};
  const confidence = (analysis.confidenceScores as { sharedFoundations?: number; disagreements?: number }) ?? {};

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

  res.setHeader("Content-Type", "text/markdown; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="common-ground-${session.id}.md"`);
  res.send(md);
});
