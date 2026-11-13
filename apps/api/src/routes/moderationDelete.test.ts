import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

// In-memory stand-in for the Prisma calls made by the positions and moderation routes.
const db = vi.hoisted(() => {
  const state = {
    session: {} as Row,
    participants: [] as Row[],
    flags: [] as Row[],
    snapshots: [] as Row[],
    latestCompletedRound: null as number | null,
  };

  const matches = (row: Row, where: Row) =>
    Object.entries(where).every(([key, condition]) => {
      if (condition && typeof condition === "object" && "gt" in condition) {
        return Number(row[key]) > Number((condition as { gt: number }).gt);
      }
      return row[key] === condition;
    });

  const prisma = {
    user: { findUnique: async () => ({ accountDeletedAt: null }) },
    session: {
      findUnique: async () => ({ ...state.session, participants: state.participants }),
      update: async ({ data }: { data: Row }) => Object.assign(state.session, data),
    },
    sessionParticipant: {
      findUnique: async ({ where }: { where: { sessionId_userId: Row } }) =>
        state.participants.find((row) => row.userId === where.sessionId_userId.userId) ?? null,
      update: async ({ where, data }: { where: Row; data: Row }) => {
        const row = state.participants.find((participant) => participant.id === where.id);
        if (!row) throw new Error("Record to update not found");
        return Object.assign(row, data);
      },
    },
    moderationFlag: {
      create: async ({ data }: { data: Row }) => {
        const flag = { id: `flag-${state.flags.length + 1}`, ...data };
        state.flags.push(flag);
        return flag;
      },
      findUnique: async ({ where }: { where: Row }) => state.flags.find((flag) => flag.id === where.id) ?? null,
      update: async ({ where, data }: { where: Row; data: Row }) => {
        const flag = state.flags.find((row) => row.id === where.id);
        return Object.assign(flag ?? {}, data);
      },
      findMany: async () =>
        state.flags.map((flag) => ({
          ...flag,
          participant: state.participants.find((row) => row.id === flag.participantId) ?? null,
        })),
    },
    analysisResult: {
      findFirst: async () =>
        state.latestCompletedRound === null ? null : { roundNumber: state.latestCompletedRound },
    },
    positionSnapshot: {
      deleteMany: async ({ where }: { where: Row }) => {
        const before = state.snapshots.length;
        state.snapshots = state.snapshots.filter((row) => !matches(row, where));
        return { count: before - state.snapshots.length };
      },
    },
    auditLog: { create: async ({ data }: { data: Row }) => data },
    $transaction: async (operations: Promise<unknown>[]) => Promise.all(operations),
  };

  return { state, prisma };
});

vi.mock("../lib/prisma.js", () => ({ prisma: db.prisma }));

import { createApp } from "../app.js";
import { signAccessToken } from "../lib/auth.js";

const asAuthor = `Bearer ${signAccessToken({ sub: "author", email: "author@example.test", role: "individual_user" })}`;
const asModerator = `Bearer ${signAccessToken({ sub: "moderator", email: "mod@example.test", role: "moderator" })}`;

const FLAGGED_TEXT = "Honestly we should attack them until they give up, because nothing else has ever worked with that group of people.";

describe("moderation removes deleted content", () => {
  beforeEach(() => {
    db.state.session = { id: "session-1", creatorUserId: "creator", status: "collecting_positions" };
    db.state.participants = [
      { id: "p-creator", sessionId: "session-1", userId: "creator", positionText: "Creator view.", positionRemovedAt: null },
      { id: "p-author", sessionId: "session-1", userId: "author", positionText: null, positionRemovedAt: null },
    ];
    db.state.flags = [];
    db.state.snapshots = [];
    db.state.latestCompletedRound = null;
  });

  function submit(positionText: string, changeMind?: string) {
    return request(createApp())
      .post("/sessions/session-1/positions")
      .set("Authorization", asAuthor)
      .send({ positionText, changeMind });
  }

  function review(flagId: string, action: "approve" | "delete") {
    return request(createApp())
      .post(`/moderation/${flagId}/review`)
      .set("Authorization", asModerator)
      .send({ action, notes: "Reviewed against the conversation guidelines." });
  }

  it("records whose perspective an automatic flag is about", async () => {
    await submit(FLAGGED_TEXT).expect(200);

    expect(db.state.flags).toHaveLength(1);
    expect(db.state.flags[0]).toMatchObject({ severity: "critical", participantId: "p-author" });
  });

  it("shows moderators the text they are reviewing", async () => {
    await submit(FLAGGED_TEXT).expect(200);

    const response = await request(createApp()).get("/moderation/queue").set("Authorization", asModerator).expect(200);

    expect(response.body.data.flags[0].flaggedText).toBe(FLAGGED_TEXT);
  });

  it("saves what could change the author's mind with their perspective", async () => {
    await submit("I think we should keep two office days a week, because new colleagues learn faster when they can ask in person.", "  Data showing remote hires learn just as fast.  ").expect(200);

    expect(db.state.participants.find((row) => row.id === "p-author")?.positionChangeMind).toBe("Data showing remote hires learn just as fast.");
  });

  it("clears the author's perspective when a moderator deletes it", async () => {
    await submit(FLAGGED_TEXT, "Nothing would.").expect(200);
    db.state.latestCompletedRound = 1;
    db.state.snapshots = [
      { sessionId: "session-1", userId: "author", roundNumber: 1, positionText: "Round one text." },
      { sessionId: "session-1", userId: "author", roundNumber: 2, positionText: FLAGGED_TEXT },
    ];

    await review("flag-1", "delete").expect(200);

    const author = db.state.participants.find((row) => row.id === "p-author");
    expect(author).toMatchObject({ positionText: null, positionChangeMind: null, positionSubmittedAt: null });
    expect(author?.positionRemovedAt).toBeInstanceOf(Date);
    // The unfinished round's copy goes; the completed round's history stays.
    expect(db.state.snapshots.map((row) => row.roundNumber)).toEqual([1]);
    expect(db.state.session.status).toBe("needs_input");
  });

  it("leaves the perspective alone when a moderator approves it", async () => {
    await submit(FLAGGED_TEXT).expect(200);

    await review("flag-1", "approve").expect(200);

    expect(db.state.participants.find((row) => row.id === "p-author")?.positionText).toBe(FLAGGED_TEXT);
  });

  it("clears the removal notice once the author writes a new perspective", async () => {
    const author = db.state.participants.find((row) => row.id === "p-author");
    Object.assign(author ?? {}, { positionRemovedAt: new Date() });

    await submit("I think we should keep two office days a week, because new colleagues learn faster when they can ask in person.").expect(200);

    expect(author?.positionRemovedAt).toBeNull();
  });
});
