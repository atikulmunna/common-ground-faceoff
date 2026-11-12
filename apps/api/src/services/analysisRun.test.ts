import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

// In-memory stand-in for the Prisma calls made while a worker claims and runs an analysis.
const db = vi.hoisted(() => {
  const state = {
    sessions: [] as Row[],
    participants: [] as Row[],
    results: [] as Row[],
    snapshots: [] as Row[],
    events: [] as Row[],
  };

  const matches = (row: Row, where: Row): boolean =>
    Object.entries(where).every(([key, condition]) => {
      if (key === "OR") return (condition as Row[]).some((alternative) => matches(row, alternative));
      if (condition && typeof condition === "object" && !(condition instanceof Date)) {
        if ("in" in condition) return (condition as { in: unknown[] }).in.includes(row[key]);
        if ("lt" in condition) return row[key] instanceof Date && (row[key] as Date) < (condition as { lt: Date }).lt;
      }
      return row[key] === condition;
    });

  const prisma = {
    session: {
      findUniqueOrThrow: async ({ where }: { where: Row }) => {
        const session = state.sessions.find((row) => row.id === where.id);
        if (!session) throw new Error("No Session found");
        return { ...session };
      },
      findFirst: async ({ where }: { where: Row }) => state.sessions.find((row) => matches(row, where)) ?? null,
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        const rows = state.sessions.filter((row) => matches(row, where));
        rows.forEach((row) => Object.assign(row, data));
        return { count: rows.length };
      },
      update: async ({ where, data }: { where: Row; data: Row }) =>
        Object.assign(state.sessions.find((row) => row.id === where.id) ?? {}, data),
    },
    sessionParticipant: {
      findMany: async ({ where }: { where: Row }) => state.participants.filter((row) => row.sessionId === where.sessionId),
    },
    analysisResult: {
      findFirst: async ({ where }: { where: Row }) =>
        state.results
          .filter((row) => row.sessionId === where.sessionId && row.status === "completed")
          .sort((a, b) => Number(b.roundNumber) - Number(a.roundNumber))[0] ?? null,
      create: async ({ data }: { data: Row }) => {
        const row = { id: `result-${state.results.length + 1}`, ...data };
        state.results.push(row);
        return row;
      },
    },
    positionSnapshot: {
      upsert: async ({ create }: { create: Row }) => {
        state.snapshots.push(create);
        return create;
      },
    },
    analysisEvent: {
      create: async ({ data }: { data: Row }) => {
        state.events.push(data);
        return data;
      },
    },
    promptLog: { create: async () => ({}) },
  };

  return { state, prisma };
});

vi.mock("../lib/prisma.js", () => ({ prisma: db.prisma }));
vi.mock("./emailOutbox.js", () => ({
  enqueueAnalysisCompletionEmails: vi.fn(async () => 0),
  processNotificationEmailOutbox: vi.fn(async () => undefined),
}));

const callLlm = vi.hoisted(() => vi.fn());
vi.mock("./llmProvider.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./llmProvider.js")>()),
  callLlm,
}));

import { claimNextQueuedAnalysis, requeueStaleAnalyses, runClaimedAnalysis } from "./analysisService.js";

const STAGE_OUTPUT: Array<[marker: string, content: unknown]> = [
  ["# Stage 1", { positions: [
    { label: "Participant A", normalized: "Office days help new hires learn quickly." },
    { label: "Participant B", normalized: "Remote days protect time for focused work." },
  ] }],
  ["# Stage 2", { steelmans: [
    { label: "Participant A", steelman: "Office days help new hires learn quickly." },
    { label: "Participant B", steelman: "Remote days protect time for focused work." },
  ] }],
  ["# Stage 3", { participants: [
    { label: "Participant A", values: [{ name: "growth", description: "New hires should learn quickly." }] },
    { label: "Participant B", values: [{ name: "focus", description: "Deep work needs quiet time." }] },
  ] }],
  ["# Stage 4", { conflicts: [] }],
  ["# Stage 5", { sharedFoundations: [], trueDisagreements: [], confidenceScores: { sharedFoundations: 0.5, disagreements: 0.5 } }],
];

function answerEveryStage() {
  callLlm.mockImplementation(async (_system: string, user: string, validate?: (content: string) => void) => {
    const stage = STAGE_OUTPUT.find(([marker]) => user.includes(marker));
    if (!stage) throw new Error("Unexpected prompt");
    const content = JSON.stringify(stage[1]);
    validate?.(content);
    return { content, provider: "openrouter", model: "openai/model-a", promptTokens: 1, completionTokens: 1 };
  });
}

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);

describe("analysis worker steps", () => {
  beforeEach(() => {
    db.state.sessions = [
      { id: "session-1", topic: "How many office days should we keep?", status: "running", estimatedCompletionAt: new Date() },
    ];
    db.state.participants = [
      { sessionId: "session-1", userId: "user-a", positionText: "Office days help new hires learn quickly." },
      { sessionId: "session-1", userId: "user-b", positionText: "Remote days protect time for focused work." },
    ];
    db.state.results = [];
    db.state.snapshots = [];
    db.state.events = [];
    callLlm.mockReset();
  });

  it("runs a claimed analysis to a completed result", async () => {
    answerEveryStage();

    await runClaimedAnalysis("session-1");

    expect(db.state.sessions[0].status).toBe("completed");
    expect(db.state.results).toHaveLength(1);
    expect(db.state.results[0]).toMatchObject({ roundNumber: 1, status: "completed", llmProvider: "openrouter" });
    expect(db.state.snapshots).toHaveLength(2);
    expect(db.state.events.map((event) => event.eventType)).toEqual(["analysis_started", "analysis_completed"]);
  });

  it("marks the conversation failed, without throwing, when the pipeline fails", async () => {
    callLlm.mockRejectedValue(new Error("OpenRouter is unavailable"));

    await expect(runClaimedAnalysis("session-1")).resolves.toBeUndefined();

    expect(db.state.sessions[0].status).toBe("failed");
    expect(db.state.results).toHaveLength(0);
    expect(db.state.events.at(-1)).toMatchObject({ eventType: "analysis_failed", reasonCode: expect.stringContaining("unavailable") });
  });

  it("lets only one worker claim a queued conversation", async () => {
    db.state.sessions[0].status = "queued";

    const claims = await Promise.all([claimNextQueuedAnalysis(), claimNextQueuedAnalysis()]);

    expect(claims.filter(Boolean)).toEqual(["session-1"]);
    expect(db.state.sessions[0].status).toBe("running");
  });

  it("finds nothing to claim when no conversation is queued", async () => {
    await expect(claimNextQueuedAnalysis()).resolves.toBeNull();
  });

  it("puts runs abandoned by a dead worker back in the queue, and leaves live runs alone", async () => {
    db.state.sessions = [
      { id: "abandoned", status: "running", estimatedCompletionAt: minutesAgo(30) },
      { id: "no-estimate", status: "running", estimatedCompletionAt: null },
      { id: "live", status: "running", estimatedCompletionAt: minutesAgo(1) },
    ];

    await expect(requeueStaleAnalyses()).resolves.toBe(2);

    expect(db.state.sessions.map((row) => [row.id, row.status])).toEqual([
      ["abandoned", "queued"],
      ["no-estimate", "queued"],
      ["live", "running"],
    ]);
  });
});
