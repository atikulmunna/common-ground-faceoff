import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

// In-memory stand-in for the Prisma calls startAnalysis makes when it queues an analysis.
const db = vi.hoisted(() => {
  const state = {
    session: {} as Row,
    participants: [] as Row[],
    flags: [] as Row[],
    events: [] as Row[],
  };

  const matches = (row: Row, where: Row) =>
    Object.entries(where).every(([key, condition]) =>
      condition && typeof condition === "object" && "in" in condition
        ? (condition as { in: unknown[] }).in.includes(row[key])
        : row[key] === condition,
    );

  const prisma = {
    session: {
      findUniqueOrThrow: async () => ({ ...state.session }),
      findUnique: async () => ({ ...state.session }),
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        if (!matches(state.session, where)) return { count: 0 };
        Object.assign(state.session, data);
        return { count: 1 };
      },
    },
    sessionParticipant: { findMany: async () => state.participants },
    moderationFlag: {
      findFirst: async ({ where }: { where: Row }) => state.flags.find((flag) => matches(flag, where)) ?? null,
    },
    redactionLog: { create: async () => ({}) },
    analysisEvent: {
      create: async ({ data }: { data: Row }) => {
        state.events.push(data);
        return data;
      },
    },
  };

  return { state, prisma };
});

vi.mock("../lib/prisma.js", () => ({ prisma: db.prisma }));

import { AnalysisConflictError, startAnalysis } from "./analysisService.js";

// Long enough to look like a real conversation; every analysis is queued regardless of size.
const LONG_POSITION = "Our team needs a predictable rhythm of shared office days for mentoring. ".repeat(40);

describe("startAnalysis claim", () => {
  beforeEach(() => {
    db.state.session = { id: "session-1", status: "collecting_positions", estimatedCompletionAt: null };
    db.state.participants = [
      { userId: "user-1", positionText: LONG_POSITION, user: { displayName: "A" } },
      { userId: "user-2", positionText: LONG_POSITION, user: { displayName: "B" } },
    ];
    db.state.flags = [];
    db.state.events = [];
  });

  it("starts only one analysis when two requests race", async () => {
    const outcomes = await Promise.allSettled([startAnalysis("session-1"), startAnalysis("session-1")]);

    const started = outcomes.filter((outcome) => outcome.status === "fulfilled");
    const refused = outcomes.filter((outcome) => outcome.status === "rejected");
    expect(started).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect((refused[0] as PromiseRejectedResult).reason).toBeInstanceOf(AnalysisConflictError);
    expect(db.state.session.status).toBe("queued");
    expect(db.state.events.filter((event) => event.eventType === "analysis_queued")).toHaveLength(1);
  });

  it("refuses while a critical flag awaits a moderator", async () => {
    db.state.session.status = "needs_input";
    db.state.flags = [{ sessionId: "session-1", severity: "critical", status: "pending" }];

    await expect(startAnalysis("session-1")).rejects.toThrow(/moderator/i);
    expect(db.state.session.status).toBe("needs_input");
    expect(db.state.events).toHaveLength(0);
  });

  it("allows analysis once the critical flag has been reviewed", async () => {
    db.state.session.status = "needs_input";
    db.state.flags = [{ sessionId: "session-1", severity: "critical", status: "approved" }];

    await expect(startAnalysis("session-1")).resolves.toMatchObject({ status: "queued" });
  });

  it("refuses a conversation that already has results until a new round starts", async () => {
    db.state.session.status = "completed";

    await expect(startAnalysis("session-1")).rejects.toThrow(/new round/i);
    expect(db.state.session.status).toBe("completed");
  });

  it("waits while a participant rewrites a perspective a moderator removed", async () => {
    db.state.participants.push({ userId: "user-3", positionText: null, positionRemovedAt: new Date(), user: { displayName: "C" } });

    await expect(startAnalysis("session-1")).rejects.toThrow(/rewrite/i);
    expect(db.state.session.status).toBe("collecting_positions");
  });

  it("allows a retry after a failed run", async () => {
    db.state.session.status = "failed";

    await expect(startAnalysis("session-1")).resolves.toMatchObject({ status: "queued" });
  });
});
