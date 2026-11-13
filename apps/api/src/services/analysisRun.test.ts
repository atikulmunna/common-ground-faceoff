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
    redactionLogs: [] as Row[],
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
      // Like Postgres, returns rows in no particular order unless asked to sort.
      findMany: async ({ where, orderBy }: { where: Row; orderBy?: { id: "asc" } }) => {
        const rows = state.participants.filter((row) => row.sessionId === where.sessionId);
        return orderBy?.id === "asc" ? [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id))) : rows;
      },
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
    redactionLog: {
      create: async ({ data }: { data: Row }) => {
        state.redactionLogs.push(data);
        return data;
      },
    },
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
    db.state.redactionLogs = [];
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

  it("saves each common point with the quotes that support it", async () => {
    answerEveryStage();
    const synthesis = STAGE_OUTPUT.find(([marker]) => marker === "# Stage 5")!;
    const original = synthesis[1];
    synthesis[1] = {
      sharedFoundations: [{
        statement: "Both care about how well the team works.",
        evidence: [
          { label: "Participant A", quote: "help new hires learn quickly" },
          { label: "Participant B", quote: "protect time for focused work" },
        ],
      }],
      trueDisagreements: [],
      confidenceScores: { sharedFoundations: 0.8, disagreements: 0.5 },
    };

    try {
      await runClaimedAnalysis("session-1");
    } finally {
      synthesis[1] = original;
    }

    expect(db.state.results[0]).toMatchObject({
      sharedFoundations: "Both care about how well the team works.",
      sharedFoundationPoints: [{
        statement: "Both care about how well the team works.",
        evidence: [
          { label: "Participant A", quote: "help new hires learn quickly" },
          { label: "Participant B", quote: "protect time for focused work" },
        ],
      }],
      disagreementPoints: [],
    });
  });

  it("redacts the topic as well as the perspectives, and logs what was found without the values", async () => {
    answerEveryStage();
    db.state.sessions[0].topic = "Should jane@example.com decide how many office days we keep?";
    db.state.participants[0].positionText = "Office days help new hires learn quickly. Call 555-444-3333.";

    await runClaimedAnalysis("session-1");

    const prompts = callLlm.mock.calls.map((call) => String(call[1])).join("\n");
    expect(prompts).not.toContain("jane@example.com");
    expect(prompts).not.toContain("555-444-3333");
    expect(prompts).toContain("Should [REDACTED:EMAIL] decide");

    expect(db.state.redactionLogs).toHaveLength(1);
    expect(db.state.redactionLogs[0]).toMatchObject({ findingsCount: 2, confidence: null, blocked: false });
    const logged = JSON.stringify(db.state.redactionLogs[0]);
    expect(logged).toContain("\"field\":\"topic\"");
    expect(logged).not.toContain("jane@example.com");
    expect(logged).not.toContain("555-444-3333");
  });

  it("marks the conversation failed, without throwing, when the pipeline fails", async () => {
    callLlm.mockRejectedValue(new Error("OpenRouter is unavailable"));

    await expect(runClaimedAnalysis("session-1")).resolves.toBeUndefined();

    expect(db.state.sessions[0].status).toBe("failed");
    expect(db.state.results).toHaveLength(0);
    expect(db.state.events.at(-1)).toMatchObject({ eventType: "analysis_failed", reasonCode: expect.stringContaining("unavailable") });
  });

  it("labels participants by when they joined, whatever order the database returns them in", async () => {
    answerEveryStage();
    db.state.participants = [
      { id: "c2-joined-second", sessionId: "session-1", userId: "user-b", positionText: "Remote days protect time for focused work." },
      { id: "c1-joined-first", sessionId: "session-1", userId: "user-a", positionText: "Office days help new hires learn quickly." },
    ];

    await runClaimedAnalysis("session-1");

    const normalizationPrompt = String(callLlm.mock.calls[0][1]);
    expect(normalizationPrompt).toContain("### Participant A\nOffice days help new hires learn quickly.");
    expect(normalizationPrompt).toContain("### Participant B\nRemote days protect time for focused work.");
  });

  it("labels anonymous participants in a stable order that does not follow when they joined", async () => {
    answerEveryStage();
    db.state.sessions[0].anonymousMode = true;
    // For these ids the shuffled order is the reverse of the join order.
    db.state.participants = [
      { id: "c1-first", sessionId: "session-1", userId: "user-a", positionText: "Office days help new hires learn quickly." },
      { id: "c2-second", sessionId: "session-1", userId: "user-b", positionText: "Remote days protect time for focused work." },
    ];

    await runClaimedAnalysis("session-1");

    const normalizationPrompt = String(callLlm.mock.calls[0][1]);
    expect(normalizationPrompt).toContain("### Participant A\nRemote days protect time for focused work.");
    expect(normalizationPrompt).toContain("### Participant B\nOffice days help new hires learn quickly.");
  });

  it("keeps everyone's label when a participant has not submitted this round", async () => {
    answerEveryStage();
    db.state.participants = [
      { id: "c1", sessionId: "session-1", userId: "user-a", positionText: "Office days help new hires learn quickly." },
      { id: "c2", sessionId: "session-1", userId: "user-skip", positionText: null },
      { id: "c3", sessionId: "session-1", userId: "user-c", positionText: "Remote days protect time for focused work." },
    ];
    callLlm.mockImplementation(async (_system: string, user: string, validate?: (content: string) => void) => {
      // Answer with whatever labels the prompt used, so this test only checks the labelling.
      const labels = [...user.matchAll(/### (Participant [A-Z])/g)].map((match) => match[1]);
      const stage = Number(/# Stage (\d)/.exec(user)?.[1]);
      const content = JSON.stringify(
        stage === 1 ? { positions: labels.map((label) => ({ label, normalized: "View." })) }
        : stage === 2 ? { steelmans: labels.map((label) => ({ label, steelman: "View." })) }
        : stage === 3 ? { participants: labels.map((label) => ({ label, values: [] })) }
        : stage === 4 ? { conflicts: [] }
        : { sharedFoundations: [], trueDisagreements: [], confidenceScores: { sharedFoundations: 0.5, disagreements: 0.5 } },
      );
      validate?.(content);
      return { content, provider: "openrouter", model: "openai/model-a", promptTokens: 1, completionTokens: 1 };
    });

    await runClaimedAnalysis("session-1");

    expect(Object.keys(db.state.results[0].steelmans as Record<string, string>)).toEqual(["Participant A", "Participant C"]);
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
