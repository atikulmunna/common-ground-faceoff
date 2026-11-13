import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const db = vi.hoisted(() => {
  const state = { session: null as Row | null };
  const prisma = {
    user: { findUnique: async () => ({ accountDeletedAt: null }) },
    session: {
      findUnique: async ({ where }: { where: Row }) =>
        state.session && where.id === state.session.id ? state.session : null,
    },
    moderationFlag: { findFirst: async () => null },
    emailInvitation: { findMany: async () => [] },
  };
  return { state, prisma };
});

vi.mock("../lib/prisma.js", () => ({ prisma: db.prisma }));

import { createApp } from "../app.js";
import { signAccessToken } from "../lib/auth.js";

function participant(userId: string, role: string, displayName: string) {
  return {
    id: `participant-${userId}`,
    sessionId: "session-1",
    userId,
    role,
    positionText: null,
    positionSubmittedAt: null,
    positionRemovedAt: null as Date | null,
    user: { id: userId, email: `${userId}@example.test`, displayName },
  };
}

function viewAs(userId: string) {
  const authorization = `Bearer ${signAccessToken({ sub: userId, email: `${userId}@example.test`, role: "individual_user" })}`;
  return request(createApp()).get("/sessions/session-1").set("Authorization", authorization).expect(200);
}

function entryFor(body: { data: { session: { participants: Row[] } } }, id: string): Row {
  const entry = body.data.session.participants.find((row) => row.id === `participant-${id}`);
  if (!entry) throw new Error(`No participant entry for ${id}`);
  return entry;
}

describe("participant identity in GET /sessions/:id", () => {
  beforeEach(() => {
    db.state.session = {
      id: "session-1",
      topic: "How many office days should we keep?",
      creatorUserId: "creator",
      status: "collecting_positions",
      anonymousMode: false,
      participants: [
        participant("creator", "session_creator", "Casey"),
        participant("viewer", "session_participant", "Val"),
        participant("other", "session_participant", "Oli"),
      ],
    };
  });

  it("shows participants each other's names but not their email addresses", async () => {
    const response = await viewAs("viewer");

    expect(entryFor(response.body, "other").user).toEqual({ id: "other", displayName: "Oli" });
    expect(entryFor(response.body, "creator").user).not.toHaveProperty("email");
    expect(JSON.stringify(response.body)).not.toContain("other@example.test");
  });

  it("still shows the creator the email addresses they invited", async () => {
    const response = await viewAs("creator");

    expect(entryFor(response.body, "other").user).toMatchObject({ email: "other@example.test" });
  });

  it("tells only the author that a moderator removed their perspective", async () => {
    const participants = db.state.session?.participants as Array<{ userId: string; positionRemovedAt: Date | null }>;
    participants.find((row) => row.userId === "other")!.positionRemovedAt = new Date("2026-11-12T12:00:00Z");

    const asViewer = await viewAs("viewer");
    expect(entryFor(asViewer.body, "other").positionRemovedAt).toBeNull();

    const asAuthor = await viewAs("other");
    expect(entryFor(asAuthor.body, "other").positionRemovedAt).toBe("2026-11-12T12:00:00.000Z");
  });

  it("keeps anonymous participants' account ids out of the response", async () => {
    db.state.session = { ...db.state.session, anonymousMode: true };

    const response = await viewAs("viewer");

    expect(entryFor(response.body, "other")).toMatchObject({
      userId: null,
      user: { id: null, displayName: "Anonymous participant" },
    });
    expect(JSON.stringify(response.body)).not.toContain("\"other\"");
    expect(entryFor(response.body, "viewer")).toMatchObject({ userId: "viewer" });
  });
});
