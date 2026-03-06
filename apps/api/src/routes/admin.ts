import { Router } from "express";
import {
  createOrganizationSchema,
  createCohortSchema,
  cohortMemberSchema,
  adminCreateSessionSchema,
} from "@common-ground/shared";

import { prisma } from "../lib/prisma.js";
import { createErrorResponse, createSuccessResponse } from "../lib/response.js";

export const adminRouter = Router();

/* ------------------------------------------------------------------ */
/*  Middleware: require institutional_admin role                        */
/* ------------------------------------------------------------------ */

function requireAdmin(req: import("express").Request, res: import("express").Response, next: import("express").NextFunction): void {
  if (req.user.role !== "institutional_admin") {
    res.status(403).json(createErrorResponse("authz_error", "Institutional admin access required"));
    return;
  }
  next();
}

adminRouter.use(requireAdmin);

/* ------------------------------------------------------------------ */
/*  Organization CRUD                                                  */
/* ------------------------------------------------------------------ */

// GET /admin/org — get admin's organization
adminRouter.get("/org", async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { organizationId: true },
  });

  if (!user?.organizationId) {
    res.status(404).json(createErrorResponse("not_found", "No organization associated with this account"));
    return;
  }

  const org = await prisma.organization.findUnique({
    where: { id: user.organizationId },
    include: {
      cohorts: { include: { _count: { select: { members: true } } } },
      _count: { select: { users: true } },
    },
  });

  res.json(createSuccessResponse({ organization: org }));
});

// POST /admin/org — create a new organization
adminRouter.post("/org", async (req, res) => {
  const parse = createOrganizationSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json(createErrorResponse("validation_error", "Invalid organization payload", parse.error.flatten()));
    return;
  }

  const existing = await prisma.organization.findUnique({ where: { slug: parse.data.slug } });
  if (existing) {
    res.status(409).json(createErrorResponse("validation_error", "Organization slug already exists"));
    return;
  }

  const org = await prisma.organization.create({
    data: {
      name: parse.data.name,
      slug: parse.data.slug,
      samlEntryPoint: parse.data.samlEntryPoint,
      samlCert: parse.data.samlCert,
      samlIssuer: parse.data.samlIssuer,
      forceAnonymous: parse.data.forceAnonymous,
    },
  });

  // Link admin to org
  await prisma.user.update({
    where: { id: req.user.id },
    data: { organizationId: org.id },
  });

  res.status(201).json(createSuccessResponse({ organization: org }));
});

// PATCH /admin/org — update organization settings
adminRouter.patch("/org", async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { organizationId: true } });
  if (!user?.organizationId) {
    res.status(404).json(createErrorResponse("not_found", "No organization found"));
    return;
  }

  const { name, forceAnonymous, samlEntryPoint, samlCert, samlIssuer } = req.body as Record<string, unknown>;
  const data: Record<string, unknown> = {};
  if (typeof name === "string" && name.length > 0) data.name = name;
  if (typeof forceAnonymous === "boolean") data.forceAnonymous = forceAnonymous;
  if (typeof samlEntryPoint === "string") data.samlEntryPoint = samlEntryPoint;
  if (typeof samlCert === "string") data.samlCert = samlCert;
  if (typeof samlIssuer === "string") data.samlIssuer = samlIssuer;

  const updated = await prisma.organization.update({
    where: { id: user.organizationId },
    data,
  });

  res.json(createSuccessResponse({ organization: updated }));
});

/* ------------------------------------------------------------------ */
/*  CG-FR45: Cohort (user group) management                           */
/* ------------------------------------------------------------------ */

adminRouter.get("/cohorts", async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { organizationId: true } });
  if (!user?.organizationId) {
    res.status(404).json(createErrorResponse("not_found", "No organization found"));
    return;
  }

  const cohorts = await prisma.cohort.findMany({
    where: { orgId: user.organizationId },
    include: {
      members: {
        include: { user: { select: { id: true, email: true, displayName: true } } },
      },
      _count: { select: { members: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  res.json(createSuccessResponse({ cohorts }));
});

adminRouter.post("/cohorts", async (req, res) => {
  const parse = createCohortSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json(createErrorResponse("validation_error", "Invalid cohort payload", parse.error.flatten()));
    return;
  }

  const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { organizationId: true } });
  if (!user?.organizationId) {
    res.status(404).json(createErrorResponse("not_found", "No organization found"));
    return;
  }

  const cohort = await prisma.cohort.create({
    data: { name: parse.data.name, orgId: user.organizationId },
  });

  res.status(201).json(createSuccessResponse({ cohort }));
});

adminRouter.delete("/cohorts/:id", async (req, res) => {
  const cohort = await prisma.cohort.findUnique({ where: { id: req.params.id } });
  if (!cohort) {
    res.status(404).json(createErrorResponse("not_found", "Cohort not found"));
    return;
  }

  // Verify they own this org
  const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { organizationId: true } });
  if (cohort.orgId !== user?.organizationId) {
    res.status(403).json(createErrorResponse("authz_error", "Not authorized for this cohort"));
    return;
  }

  await prisma.cohortMembership.deleteMany({ where: { cohortId: req.params.id } });
  await prisma.cohort.delete({ where: { id: req.params.id } });

  res.json(createSuccessResponse({ deleted: true }));
});

// Add member to cohort
adminRouter.post("/cohorts/:id/members", async (req, res) => {
  const parse = cohortMemberSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json(createErrorResponse("validation_error", "Invalid member payload", parse.error.flatten()));
    return;
  }

  const cohort = await prisma.cohort.findUnique({ where: { id: req.params.id } });
  if (!cohort) {
    res.status(404).json(createErrorResponse("not_found", "Cohort not found"));
    return;
  }

  const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { organizationId: true } });
  if (cohort.orgId !== user?.organizationId) {
    res.status(403).json(createErrorResponse("authz_error", "Not authorized for this cohort"));
    return;
  }

  // Upsert user (they may not exist yet)
  const member = await prisma.user.upsert({
    where: { email: parse.data.email },
    update: { organizationId: cohort.orgId },
    create: {
      email: parse.data.email,
      displayName: parse.data.email.split("@")[0],
      organizationId: cohort.orgId,
    },
  });

  const membership = await prisma.cohortMembership.upsert({
    where: { cohortId_userId: { cohortId: req.params.id, userId: member.id } },
    update: {},
    create: { cohortId: req.params.id, userId: member.id },
  });

  res.status(201).json(createSuccessResponse({ membership, user: { id: member.id, email: member.email, displayName: member.displayName } }));
});

// Remove member from cohort
adminRouter.delete("/cohorts/:cohortId/members/:userId", async (req, res) => {
  await prisma.cohortMembership.deleteMany({
    where: { cohortId: req.params.cohortId, userId: req.params.userId },
  });

  res.json(createSuccessResponse({ removed: true }));
});

/* ------------------------------------------------------------------ */
/*  CG-FR46: Admin creates session with pre-assigned participants      */
/* ------------------------------------------------------------------ */

adminRouter.post("/sessions", async (req, res) => {
  const parse = adminCreateSessionSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json(createErrorResponse("validation_error", "Invalid session payload", parse.error.flatten()));
    return;
  }

  // CG-FR47: Check if org forces anonymization
  const adminUser = await prisma.user.findUnique({ where: { id: req.user.id }, include: { organization: true } });
  const forceAnon = adminUser?.organization?.forceAnonymous ?? false;

  const session = await prisma.session.create({
    data: {
      topic: parse.data.topic,
      anonymousMode: forceAnon || parse.data.anonymousMode,
      deadline: parse.data.deadline ? new Date(parse.data.deadline) : null,
      maxParticipants: parse.data.participantEmails.length,
      creatorUserId: req.user.id,
      status: "collecting_positions",
      participants: {
        create: { userId: req.user.id, role: "session_creator", canExport: true },
      },
    },
  });

  // Pre-assign participants
  for (const email of parse.data.participantEmails) {
    if (email === req.user.email) continue; // creator already added

    const participant = await prisma.user.upsert({
      where: { email },
      update: {},
      create: { email, displayName: email.split("@")[0] },
    });

    await prisma.sessionParticipant.upsert({
      where: { sessionId_userId: { sessionId: session.id, userId: participant.id } },
      update: {},
      create: { sessionId: session.id, userId: participant.id, role: "session_participant" },
    });
  }

  res.status(201).json(createSuccessResponse({ session }));
});

/* ------------------------------------------------------------------ */
/*  CG-FR48: Analytics dashboard                                       */
/* ------------------------------------------------------------------ */

adminRouter.get("/analytics", async (req, res) => {
  const adminUser = await prisma.user.findUnique({ where: { id: req.user.id }, select: { organizationId: true } });
  if (!adminUser?.organizationId) {
    res.status(404).json(createErrorResponse("not_found", "No organization found"));
    return;
  }

  // Get users in org
  const orgUserIds = (
    await prisma.user.findMany({
      where: { organizationId: adminUser.organizationId },
      select: { id: true },
    })
  ).map((u) => u.id);

  const { from, to } = req.query as { from?: string; to?: string };
  const dateFilter: Record<string, unknown> = {};
  if (from) dateFilter.gte = new Date(from);
  if (to) dateFilter.lte = new Date(to);

  const sessionWhere: Record<string, unknown> = {
    creatorUserId: { in: orgUserIds },
  };
  if (Object.keys(dateFilter).length > 0) {
    sessionWhere.createdAt = dateFilter;
  }

  const [totalSessions, completedSessions, allAnalyses, allReactions, allFeedback] = await Promise.all([
    prisma.session.count({ where: sessionWhere }),
    prisma.session.count({ where: { ...sessionWhere, status: "completed" } }),
    prisma.analysisResult.findMany({
      where: {
        session: sessionWhere as Record<string, unknown>,
        status: "completed",
      },
      select: { conflictMap: true },
    }),
    prisma.sectionReaction.findMany({
      where: {
        sessionId: {
          in: (await prisma.session.findMany({ where: sessionWhere, select: { id: true } })).map((s) => s.id),
        },
        section: { startsWith: "steelman:" },
        reaction: "represents",
      },
    }),
    prisma.feedbackRating.findMany({
      where: {
        sessionId: {
          in: (await prisma.session.findMany({ where: sessionWhere, select: { id: true } })).map((s) => s.id),
        },
      },
      select: { faithfulness: true, neutrality: true },
    }),
  ]);

  // Conflict type distribution
  const conflictTypes: Record<string, number> = { empirical: 0, value: 0, semantic: 0, procedural: 0 };
  for (const a of allAnalyses) {
    const cm = a.conflictMap as { conflicts?: Array<{ category?: string }> } | null;
    if (cm?.conflicts) {
      for (const c of cm.conflicts) {
        if (c.category && c.category in conflictTypes) {
          conflictTypes[c.category]++;
        }
      }
    }
  }

  const completionRate = totalSessions > 0 ? completedSessions / totalSessions : 0;

  // Steelman acceptance rate
  const steelmanTotal = allReactions.length;
  const steelmanAcceptRate = steelmanTotal; // each is a "represents" reaction

  res.json(
    createSuccessResponse({
      analytics: {
        totalSessions,
        completedSessions,
        completionRate: Math.round(completionRate * 100) / 100,
        conflictTypeDistribution: conflictTypes,
        steelmanAcceptanceCount: steelmanAcceptRate,
        feedbackSummary: {
          count: allFeedback.length,
          avgFaithfulness:
            allFeedback.length > 0
              ? Math.round((allFeedback.reduce((s, f) => s + f.faithfulness, 0) / allFeedback.length) * 100) / 100
              : null,
          avgNeutrality:
            allFeedback.length > 0
              ? Math.round((allFeedback.reduce((s, f) => s + f.neutrality, 0) / allFeedback.length) * 100) / 100
              : null,
        },
      },
    })
  );
});

/* ------------------------------------------------------------------ */
/*  CG-FR49: Export analytics as CSV                                   */
/* ------------------------------------------------------------------ */

adminRouter.get("/analytics/export", async (req, res) => {
  const adminUser = await prisma.user.findUnique({ where: { id: req.user.id }, select: { organizationId: true } });
  if (!adminUser?.organizationId) {
    res.status(404).json(createErrorResponse("not_found", "No organization found"));
    return;
  }

  const orgUserIds = (
    await prisma.user.findMany({
      where: { organizationId: adminUser.organizationId },
      select: { id: true },
    })
  ).map((u) => u.id);

  const sessions = await prisma.session.findMany({
    where: { creatorUserId: { in: orgUserIds } },
    include: {
      _count: { select: { participants: true } },
      analysisResults: {
        where: { status: "completed" },
        orderBy: { roundNumber: "desc" },
        take: 1,
        select: { llmProvider: true, roundNumber: true, createdAt: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // Build CSV
  const headers = ["Session ID", "Topic", "Status", "Participants", "Rounds", "LLM Provider", "Created", "Analyzed"];
  const rows = sessions.map((s) => [
    s.id,
    `"${s.topic.replace(/"/g, '""')}"`,
    s.status,
    s._count.participants,
    s.analysisResults[0]?.roundNumber ?? 0,
    s.analysisResults[0]?.llmProvider ?? "N/A",
    s.createdAt.toISOString(),
    s.analyzedAt?.toISOString() ?? "",
  ]);

  const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=\"analytics-export.csv\"");
  res.send(csv);
});
