/* ------------------------------------------------------------------ */
/*  Privacy & GDPR compliance routes (CG-NFR16-18, NFR29-34)           */
/* ------------------------------------------------------------------ */

import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { createSuccessResponse, createErrorResponse } from "../lib/response.js";

export const privacyRouter = Router();

/* ------------------------------------------------------------------ */
/*  CG-NFR32: Consent management                                      */
/* ------------------------------------------------------------------ */

/** Record or update consent for a given purpose */
privacyRouter.post("/consent", async (req, res) => {
  const userId = (req as any).userId as string;
  const { purpose, lawfulBasis, granted } = req.body;

  if (!purpose || !lawfulBasis || typeof granted !== "boolean") {
    return res.status(400).json(createErrorResponse("validation_error", "purpose, lawfulBasis, and granted are required"));
  }

  const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ?? req.ip ?? "";
  const userAgent = req.headers["user-agent"] ?? "";

  // Find latest consent for this user+purpose to determine version
  const latest = await prisma.consentRecord.findFirst({
    where: { userId, purpose },
    orderBy: { version: "desc" },
    select: { version: true },
  });

  const record = await prisma.consentRecord.create({
    data: {
      userId,
      purpose,
      lawfulBasis,
      granted,
      ipAddress: ip,
      userAgent,
      version: (latest?.version ?? 0) + 1,
    },
  });

  res.status(201).json(createSuccessResponse(record));
});

/** Get all consent records for the authenticated user */
privacyRouter.get("/consent", async (req, res) => {
  const userId = (req as any).userId as string;

  // Get latest consent per purpose using raw grouping
  const records = await prisma.consentRecord.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });

  // Deduplicate: keep only the latest per purpose
  const latestByPurpose = new Map<string, typeof records[0]>();
  for (const r of records) {
    if (!latestByPurpose.has(r.purpose)) {
      latestByPurpose.set(r.purpose, r);
    }
  }

  res.json(createSuccessResponse(Array.from(latestByPurpose.values())));
});

/* ------------------------------------------------------------------ */
/*  CG-NFR31: Data subject requests (export, deletion, etc.)           */
/* ------------------------------------------------------------------ */

const DEADLINE_DAYS: Record<string, number> = {
  export: 30,      // CG-NFR17: within 30 days
  deletion: 3,     // CG-NFR18: within 72 hours
  rectification: 30,
  restriction: 30,
};

/** Submit a data subject request */
privacyRouter.post("/requests", async (req, res) => {
  const userId = (req as any).userId as string;
  const { requestType, reason } = req.body;

  if (!requestType || !DEADLINE_DAYS[requestType]) {
    return res.status(400).json(
      createErrorResponse("validation_error", `requestType must be one of: ${Object.keys(DEADLINE_DAYS).join(", ")}`)
    );
  }

  // Prevent duplicate pending requests of the same type
  const existing = await prisma.dataSubjectRequest.findFirst({
    where: { userId, requestType, status: { in: ["received", "verified", "in_progress"] } },
  });
  if (existing) {
    return res.status(409).json(createErrorResponse("duplicate_request", "You already have a pending request of this type"));
  }

  const deadlineDays = DEADLINE_DAYS[requestType];
  const deadlineAt = new Date(Date.now() + deadlineDays * 24 * 60 * 60 * 1000);

  const request = await prisma.dataSubjectRequest.create({
    data: { userId, requestType, reason, deadlineAt },
  });

  res.status(201).json(createSuccessResponse(request));
});

/** List data subject requests for the authenticated user */
privacyRouter.get("/requests", async (req, res) => {
  const userId = (req as any).userId as string;

  const requests = await prisma.dataSubjectRequest.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });

  res.json(createSuccessResponse(requests));
});

/* ------------------------------------------------------------------ */
/*  CG-NFR17: Data export (GDPR right of access / portability)        */
/* ------------------------------------------------------------------ */

privacyRouter.get("/export", async (req, res) => {
  const userId = (req as any).userId as string;

  const [user, participants, reactions, comments, feedback, consents, auditLogs] =
    await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          displayName: true,
          tier: true,
          createdAt: true,
          lastLoginAt: true,
          avatarUrl: true,
          notificationPrefs: true,
        },
      }),
      prisma.sessionParticipant.findMany({
        where: { userId },
        include: { session: { select: { id: true, topic: true, status: true, createdAt: true } } },
      }),
      prisma.sectionReaction.findMany({ where: { userId } }),
      prisma.sectionComment.findMany({ where: { userId } }),
      prisma.feedbackRating.findMany({ where: { userId } }),
      prisma.consentRecord.findMany({ where: { userId }, orderBy: { createdAt: "desc" } }),
      prisma.auditLog.findMany({ where: { actorId: userId }, orderBy: { createdAt: "desc" }, take: 500 }),
    ]);

  const exportData = {
    exportedAt: new Date().toISOString(),
    user,
    sessions: participants.map((p) => ({
      sessionId: p.session.id,
      topic: p.session.topic,
      status: p.session.status,
      role: p.role,
      positionText: p.positionText,
      positionSubmittedAt: p.positionSubmittedAt,
    })),
    reactions,
    comments,
    feedback,
    consents,
    auditLogs,
  };

  res.setHeader("Content-Disposition", `attachment; filename="data-export-${userId}.json"`);
  res.json(createSuccessResponse(exportData));
});

/* ------------------------------------------------------------------ */
/*  CG-NFR18/NFR34: Account deletion (right to erasure)               */
/* ------------------------------------------------------------------ */

privacyRouter.delete("/account", async (req, res) => {
  const userId = (req as any).userId as string;

  // CG-NFR34: Propagate deletion across all related records
  await prisma.$transaction([
    prisma.sectionReaction.deleteMany({ where: { userId } }),
    prisma.sectionComment.deleteMany({ where: { userId } }),
    prisma.feedbackRating.deleteMany({ where: { userId } }),
    prisma.consentRecord.deleteMany({ where: { userId } }),
    prisma.dataSubjectRequest.deleteMany({ where: { userId } }),
    prisma.refreshToken.deleteMany({ where: { userId } }),
    prisma.cohortMembership.deleteMany({ where: { userId } }),

    // Anonymize session participations (don't delete sessions — other users' data)
    prisma.sessionParticipant.updateMany({
      where: { userId },
      data: { positionText: "[DELETED]" },
    }),

    // Anonymize audit logs (keep for compliance, remove PII)
    prisma.auditLog.updateMany({
      where: { actorId: userId },
      data: { actorEmail: "[DELETED]" },
    }),

    // Finally delete the user
    prisma.user.delete({ where: { id: userId } }),
  ]);

  res.json(createSuccessResponse({ deleted: true }));
});

/* ------------------------------------------------------------------ */
/*  CG-NFR33: Subprocessor inventory (public, no auth needed)          */
/* ------------------------------------------------------------------ */

privacyRouter.get("/subprocessors", async (_req, res) => {
  const entries = await prisma.subprocessorEntry.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    select: {
      name: true,
      purpose: true,
      dataTypes: true,
      location: true,
      dpaUrl: true,
      version: true,
      addedAt: true,
      updatedAt: true,
    },
  });

  res.json(createSuccessResponse(entries));
});
