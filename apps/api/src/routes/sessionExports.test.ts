import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

// In-memory stand-in for the Prisma calls behind GET /sessions/:id/export/:format.
const db = vi.hoisted(() => {
  const state = { analysis: null as Row | null };
  const session = {
    id: "session-1",
    topic: "How many office days should our team keep?",
    creatorUserId: "creator",
    status: "completed",
    anonymousMode: false,
    createdAt: new Date("2026-11-12T10:00:00Z"),
    analyzedAt: new Date("2026-11-12T12:00:00Z"),
    participants: [
      { id: "p1", userId: "creator", role: "session_creator", canExport: true, user: { displayName: "Casey" } },
      { id: "p2", userId: "other", role: "session_participant", canExport: false, user: { displayName: "Val" } },
    ],
  };
  const prisma = {
    user: { findUnique: async () => ({ accountDeletedAt: null }) },
    session: { findUnique: async ({ where }: { where: Row }) => (where.id === session.id ? session : null) },
    analysisResult: { findFirst: async () => state.analysis },
  };
  return { state, prisma };
});

vi.mock("../lib/prisma.js", () => ({ prisma: db.prisma }));
vi.mock("../services/storageService.js", () => ({ uploadExport: vi.fn(async () => undefined) }));

import { createApp } from "../app.js";
import { signAccessToken } from "../lib/auth.js";

const asCreator = `Bearer ${signAccessToken({ sub: "creator", email: "creator@example.test", role: "individual_user" })}`;

function exportAs(format: string) {
  return request(createApp()).get(`/sessions/session-1/export/${format}`).set("Authorization", asCreator).expect(200);
}

const baseResult = {
  analysisVersion: "v1",
  promptTemplateVersion: "p1",
  roundNumber: 1,
  llmProvider: "openrouter",
  modelVersion: "openai/model-a",
  steelmans: { "Participant A": "Office days help new hires learn.", "Participant B": "Remote days protect focus." },
  conflictMap: {},
  sharedFoundations: "Both want new colleagues to learn quickly.",
  trueDisagreements: "They differ on how many days.",
  confidenceScores: { sharedFoundations: 0.9, disagreements: 0.8 },
  createdAt: new Date("2026-11-12T12:00:00Z"),
};

describe("exports of common points", () => {
  beforeEach(() => {
    db.state.analysis = {
      ...baseResult,
      sharedFoundationPoints: [{
        statement: "Both want new colleagues to learn quickly.",
        evidence: [
          { label: "Participant A", quote: "help new hires learn" },
          { label: "Participant B", quote: "protect focus" },
        ],
      }],
      disagreementPoints: [],
      participantValues: { "Participant A": [{ name: "growth", description: "New hires should learn." }] },
    };
  });

  it("names what matters to each participant under their restated view", async () => {
    const response = await exportAs("markdown");

    expect(response.text).toContain("### Participant A\n\nOffice days help new hires learn.\n\n*What matters to them: growth*");
    expect(response.text).not.toContain("*What matters to them: *");
  });

  it("lists each common point with the quotes that support it", async () => {
    const response = await exportAs("markdown");

    expect(response.text).toContain(
      '- Both want new colleagues to learn quickly.\n  - Participant A: "help new hires learn"\n  - Participant B: "protect focus"',
    );
  });

  it("includes the points in the JSON export", async () => {
    const response = await exportAs("json");

    expect(JSON.parse(response.text).analysis.sharedFoundationPoints).toHaveLength(1);
  });

  it("reports how many points held up instead of the model's own confidence", async () => {
    db.state.analysis = {
      ...db.state.analysis,
      verification: { sharedProposed: 2, sharedVerified: 1, differencesProposed: 0, differencesVerified: 0 },
    };

    const response = await exportAs("markdown");

    expect(response.text).toContain("*1 of 2 proposed common points held up against every restated view.*");
    expect(response.text).not.toContain("Confidence");
    expect(JSON.parse((await exportAs("json")).text).analysis).not.toHaveProperty("confidenceScores");
  });

  it("still exports results saved before points were kept", async () => {
    db.state.analysis = { ...baseResult, sharedFoundationPoints: null, disagreementPoints: null };

    const response = await exportAs("markdown");

    expect(response.text).toContain("Both want new colleagues to learn quickly.\n\n");
    expect(response.text).toContain("They differ on how many days.\n\n");
    expect(response.text).not.toContain("Confidence");
  });
});
