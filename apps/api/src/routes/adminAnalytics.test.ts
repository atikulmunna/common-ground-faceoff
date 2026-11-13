import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

// In-memory stand-in for the Prisma calls behind GET /admin/analytics.
const db = vi.hoisted(() => {
  const state = { analyses: [] as Row[], feedback: [] as Row[] };
  const prisma = {
    user: {
      findUnique: async () => ({ accountDeletedAt: null, organizationId: "org-1" }),
      findMany: async () => [{ id: "admin" }],
    },
    session: {
      count: async () => 2,
      findMany: async () => [{ id: "session-1" }],
    },
    analysisResult: { findMany: async () => state.analyses },
    sectionReaction: { findMany: async () => [] },
    feedbackRating: { findMany: async () => state.feedback },
  };
  return { state, prisma };
});

vi.mock("../lib/prisma.js", () => ({ prisma: db.prisma }));

import { createApp } from "../app.js";
import { signAccessToken } from "../lib/auth.js";

const asAdmin = `Bearer ${signAccessToken({ sub: "admin", email: "admin@example.test", role: "institutional_admin" })}`;

function analytics() {
  return request(createApp()).get("/admin/analytics").set("Authorization", asAdmin).expect(200);
}

describe("GET /admin/analytics", () => {
  beforeEach(() => {
    db.state.analyses = [];
    db.state.feedback = [];
  });

  it("counts each kind of difference from the saved conflict map", async () => {
    db.state.analyses = [
      { conflictMap: { empirical: ["Whether quiet rooms help."], policy: ["How many days.", "Which days."] } },
      // Older results called approach differences "procedural".
      { conflictMap: { procedural: ["Who decides."], value: ["Focus against cohesion."] } },
    ];

    const response = await analytics();

    expect(response.body.data.analytics.conflictTypeDistribution).toEqual({ empirical: 1, value: 1, semantic: 0, policy: 3 });
  });

  it("counts answers to the fairness question, and averages only the older star ratings", async () => {
    db.state.feedback = [
      { fairness: "yes", faithfulness: null, neutrality: null },
      { fairness: "yes", faithfulness: null, neutrality: null },
      { fairness: "somewhat", faithfulness: null, neutrality: null },
      { fairness: null, faithfulness: 4, neutrality: 2 },
    ];

    const response = await analytics();

    expect(response.body.data.analytics.feedbackSummary).toEqual({
      count: 4,
      fairness: { yes: 2, somewhat: 1, no: 0 },
      avgFaithfulness: 4,
      avgNeutrality: 2,
    });
  });
});
