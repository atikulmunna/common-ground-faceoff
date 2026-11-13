import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

// In-memory stand-in for the Prisma calls behind GET /sessions/:id and the reaction and comment lists.
const db = vi.hoisted(() => {
  const state = {
    users: {} as Record<string, Row>,
    session: null as Row | null,
    flags: [] as Row[],
    invitations: [] as Row[],
    reactions: [] as Row[],
    comments: [] as Row[],
  };

  const prisma = {
    user: {
      findUnique: async ({ where }: { where: Row }) => {
        const user = state.users[where.id as string];
        return user ? { accountDeletedAt: null, ...user } : null;
      },
    },
    session: {
      findUnique: async ({ where }: { where: Row }) =>
        state.session && where.id === state.session.id ? state.session : null,
    },
    moderationFlag: {
      findFirst: async ({ where }: { where: { sessionId: string; severity: string; status: { in: string[] } } }) =>
        state.flags.find(
          (flag) => flag.sessionId === where.sessionId && flag.severity === where.severity && where.status.in.includes(flag.status as string),
        ) ?? null,
    },
    emailInvitation: { findMany: async () => state.invitations },
    sectionReaction: { findMany: async () => state.reactions },
    sectionComment: { findMany: async () => state.comments },
    shareLink: {
      findUnique: async ({ where }: { where: Row }) =>
        where.token === "share-token" ? { id: "link-1", sessionId: "session-1", token: "share-token", revoked: false, expiresAt: null } : null,
    },
    analysisResult: {
      findFirst: async () => ({
        roundNumber: 1,
        steelmans: { "Participant A": "View A.", "Participant B": "View B." },
        conflictMap: {},
        sharedFoundations: "Both want the team to do its best work.",
        trueDisagreements: "They differ on how many days.",
        confidenceScores: { sharedFoundations: 0.9, disagreements: 0.8 },
        llmProvider: "openrouter",
        modelVersion: "openai/model-a",
        createdAt: "2026-11-12T12:00:00.000Z",
      }),
    },
  };

  return { state, prisma };
});

vi.mock("../lib/prisma.js", () => ({ prisma: db.prisma }));

import { createApp } from "../app.js";
import { signAccessToken } from "../lib/auth.js";

function asUser(id: string) {
  return `Bearer ${signAccessToken({ sub: id, email: `${id}@example.test`, role: "individual_user" })}`;
}

function participant(userId: string, role: string, extra: Row = {}) {
  return {
    id: `participant-${userId}`,
    sessionId: "session-1",
    userId,
    role,
    canExport: role === "session_creator",
    positionText: `${userId}'s view of the office question.`,
    positionSubmittedAt: "2026-11-12T10:00:00.000Z",
    positionRemovedAt: null,
    user: { id: userId, email: `${userId}@example.test`, displayName: userId },
    ...extra,
  };
}

function getConversation(viewer: string) {
  return request(createApp()).get("/sessions/session-1").set("Authorization", asUser(viewer)).expect(200);
}

describe("GET /sessions/:id details for the conversation page", () => {
  beforeEach(() => {
    db.state.users = { creator: { tier: "free" }, other: { tier: "pro" } };
    db.state.session = {
      id: "session-1",
      topic: "How many office days should our team keep?",
      creatorUserId: "creator",
      status: "collecting_positions",
      anonymousMode: false,
      participants: [participant("creator", "session_creator"), participant("other", "session_participant")],
    };
    db.state.flags = [];
    db.state.invitations = [{ email: "other@example.test", status: "sent" }];
  });

  it("tells the page who the viewer is and how many people may join", async () => {
    const creatorView = await getConversation("creator");
    expect(creatorView.body.data.session).toMatchObject({
      viewer: { isCreator: true, isParticipant: true, canShare: true },
      participantLimit: 2,
      pause: null,
    });

    const participantView = await getConversation("other");
    expect(participantView.body.data.session.viewer).toEqual({ isCreator: false, isParticipant: true, canShare: false });
  });

  it("gives each participant the label the analysis uses, whatever order the database returns", async () => {
    const participants = db.state.session?.participants as Row[];
    db.state.session = { ...db.state.session, participants: [...participants].reverse() };

    const listed = (await getConversation("creator")).body.data.session.participants as Row[];

    expect(listed.map((row) => [row.id, row.label])).toEqual([
      ["participant-creator", "Participant A"],
      ["participant-other", "Participant B"],
    ]);
  });

  it("shows the creator who was invited, and nobody else", async () => {
    expect((await getConversation("creator")).body.data.session.invitations).toEqual([
      { email: "other@example.test", status: "sent" },
    ]);
    expect((await getConversation("other")).body.data.session).not.toHaveProperty("invitations");
  });

  it("explains a pause for moderator review", async () => {
    db.state.session = { ...db.state.session, status: "needs_input" };
    db.state.flags = [{ sessionId: "session-1", severity: "critical", status: "pending" }];

    expect((await getConversation("other")).body.data.session.pause).toEqual({ reason: "moderation_review" });
  });

  it("explains a pause while a removed perspective is rewritten", async () => {
    const participants = db.state.session?.participants as Row[];
    participants[1] = participant("other", "session_participant", { positionText: null, positionRemovedAt: "2026-11-12T12:00:00.000Z" });

    expect((await getConversation("creator")).body.data.session.pause).toEqual({ reason: "awaiting_rewrite" });
  });
});

describe("anonymous conversations stay anonymous after results (D1)", () => {
  beforeEach(() => {
    db.state.users = { creator: { tier: "pro" }, other: { tier: "pro" } };
    db.state.session = {
      id: "session-1",
      topic: "How many office days should our team keep?",
      creatorUserId: "creator",
      status: "completed",
      anonymousMode: true,
      participants: [participant("creator", "session_creator"), participant("other", "session_participant")],
    };
    db.state.flags = [];
    db.state.invitations = [];
    db.state.reactions = [
      { id: "r1", sessionId: "session-1", userId: "creator", section: "sharedFoundations", reaction: "represents" },
      { id: "r2", sessionId: "session-1", userId: "other", section: "sharedFoundations", reaction: "represents" },
    ];
    db.state.comments = [
      { id: "c1", sessionId: "session-1", userId: "other", section: "sharedFoundations", text: "Fair summary.", createdAt: "2026-11-12T12:00:00.000Z" },
    ];
  });

  it("does not reveal who the other participants are, or their own words", async () => {
    const response = await getConversation("creator");
    const other = (response.body.data.session.participants as Row[]).find((row) => row.id === "participant-other");

    expect(other).toMatchObject({ userId: null, positionText: null, user: { id: null, displayName: "Anonymous participant" } });
    expect(JSON.stringify(response.body)).not.toContain("other@example.test");
    expect(JSON.stringify(response.body)).not.toContain("other's view");
  });

  it("marks the viewer's own reactions and comments without exposing anyone else's account", async () => {
    const app = createApp();
    const reactions = await request(app).get("/sessions/session-1/reactions").set("Authorization", asUser("creator")).expect(200);
    expect(reactions.body.data.reactions).toEqual([
      expect.objectContaining({ id: "r1", mine: true, userId: "creator" }),
      expect.objectContaining({ id: "r2", mine: false, userId: null }),
    ]);
    expect(reactions.body.data.mutualAcknowledgments).toEqual({ sharedFoundations: true });

    const comments = await request(app).get("/sessions/session-1/comments").set("Authorization", asUser("creator")).expect(200);
    expect(comments.body.data.comments).toEqual([expect.objectContaining({ id: "c1", mine: false, userId: null })]);
  });
});

describe("public share view", () => {
  it("shows the results without internal details such as the model used", async () => {
    db.state.session = {
      id: "session-1",
      topic: "How many office days should our team keep?",
      creatorUserId: "creator",
      status: "completed",
      anonymousMode: false,
      participants: [participant("creator", "session_creator"), participant("other", "session_participant")],
    };

    const response = await request(createApp()).get("/share-links/view/share-token").expect(200);

    expect(response.body.data.analysis).toMatchObject({ sharedFoundations: "Both want the team to do its best work." });
    expect(response.body.data.analysis).not.toHaveProperty("llmProvider");
    expect(response.body.data.analysis).not.toHaveProperty("modelVersion");
    expect(response.body.data.analysis).not.toHaveProperty("confidenceScores");
  });
});
