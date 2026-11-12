import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const db = vi.hoisted(() => {
  const state = {
    flag: null as Row | null,
    participants: [] as Row[],
    auditLogs: [] as Row[],
  };

  const prisma = {
    user: { findUnique: async () => ({ accountDeletedAt: null }) },
    moderationFlag: {
      findUnique: async ({ where }: { where: Row }) => {
        if (!state.flag || state.flag.id !== where.id) return null;
        const participant = state.participants.find((row) => row.id === state.flag?.participantId) ?? null;
        return { ...state.flag, participant: participant ? { userId: participant.userId } : null };
      },
      update: async ({ data }: { data: Row }) => Object.assign(state.flag ?? {}, data),
    },
    sessionParticipant: {
      findUnique: async ({ where }: { where: { sessionId_userId: Row } }) =>
        state.participants.find(
          (row) => row.sessionId === where.sessionId_userId.sessionId && row.userId === where.sessionId_userId.userId,
        ) ?? null,
    },
    auditLog: {
      create: async ({ data }: { data: Row }) => {
        state.auditLogs.push(data);
        return data;
      },
    },
  };

  return { state, prisma };
});

vi.mock("../lib/prisma.js", () => ({ prisma: db.prisma }));

import { createApp } from "../app.js";
import { signAccessToken } from "../lib/auth.js";

function appealAs(userId: string) {
  const authorization = `Bearer ${signAccessToken({ sub: userId, email: `${userId}@example.test`, role: "individual_user" })}`;
  return request(createApp())
    .post("/moderation/flag-1/appeal")
    .set("Authorization", authorization)
    .send({ text: "My perspective did not break the guidelines; please look again." });
}

describe("POST /moderation/:flagId/appeal", () => {
  beforeEach(() => {
    db.state.participants = [
      { id: "p-author", sessionId: "session-1", userId: "author" },
      { id: "p-other", sessionId: "session-1", userId: "other" },
    ];
    db.state.flag = { id: "flag-1", sessionId: "session-1", participantId: "p-author", status: "deleted" };
    db.state.auditLogs = [];
  });

  it("refuses people outside the conversation", async () => {
    await appealAs("outsider").expect(403);

    expect(db.state.flag?.status).toBe("deleted");
    expect(db.state.auditLogs).toContainEqual(expect.objectContaining({ eventType: "authz_denied", actorId: "outsider" }));
  });

  it("refuses other participants when the flag is about someone's perspective", async () => {
    await appealAs("other").expect(403);

    expect(db.state.flag?.status).toBe("deleted");
  });

  it("lets the author appeal", async () => {
    const response = await appealAs("author").expect(200);

    expect(response.body.data.flag).toMatchObject({ status: "appealed", appealStatus: "pending_appeal" });
  });

  it("lets any participant appeal a flag that names no perspective", async () => {
    db.state.flag = { id: "flag-1", sessionId: "session-1", participantId: null, status: "deleted" };

    await appealAs("outsider").expect(403);
    await appealAs("other").expect(200);
  });
});
