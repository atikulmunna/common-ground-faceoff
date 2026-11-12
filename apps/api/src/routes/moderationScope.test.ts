import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

// Two organizations, one conversation each, one pending flag each.
const db = vi.hoisted(() => {
  const state = {
    users: {} as Record<string, Row>,
    sessions: [] as Row[],
    flags: [] as Row[],
    auditLogs: [] as Row[],
  };

  const prisma = {
    user: {
      findUnique: async ({ where }: { where: Row }) => {
        const user = state.users[where.id as string];
        return user ? { accountDeletedAt: null, ...user } : null;
      },
    },
    session: {
      findUnique: async ({ where }: { where: Row }) => state.sessions.find((row) => row.id === where.id) ?? null,
      findMany: async ({ where }: { where: { creator: { organizationId: string } } }) =>
        state.sessions.filter(
          (row) => state.users[row.creatorUserId as string]?.organizationId === where.creator.organizationId,
        ),
    },
    moderationFlag: {
      findMany: async ({ where }: { where: { sessionId?: { in: string[] } } }) =>
        state.flags
          .filter((flag) => !where.sessionId || where.sessionId.in.includes(flag.sessionId as string))
          .map((flag) => ({ ...flag, participant: null })),
      findUnique: async ({ where }: { where: Row }) => state.flags.find((flag) => flag.id === where.id) ?? null,
      update: async ({ where, data }: { where: Row; data: Row }) =>
        Object.assign(state.flags.find((flag) => flag.id === where.id) ?? {}, data),
    },
    auditLog: {
      create: async ({ data }: { data: Row }) => {
        state.auditLogs.push(data);
        return data;
      },
    },
    $transaction: async (operations: Promise<unknown>[]) => Promise.all(operations),
  };

  return { state, prisma };
});

vi.mock("../lib/prisma.js", () => ({ prisma: db.prisma }));

import { createApp } from "../app.js";
import { signAccessToken } from "../lib/auth.js";

function bearer(id: string, role: string): string {
  return `Bearer ${signAccessToken({ sub: id, email: `${id}@example.test`, role })}`;
}

function queueAs(authorization: string) {
  return request(createApp()).get("/moderation/queue").set("Authorization", authorization).expect(200);
}

function reviewAs(authorization: string, flagId: string) {
  return request(createApp())
    .post(`/moderation/${flagId}/review`)
    .set("Authorization", authorization)
    .send({ action: "approve", notes: "Within the guidelines." });
}

describe("institutional admins moderate only their organization", () => {
  beforeEach(() => {
    db.state.users = {
      "creator-a": { organizationId: "org-a" },
      "creator-b": { organizationId: "org-b" },
      "admin-a": { organizationId: "org-a" },
      "admin-none": { organizationId: null },
      moderator: { organizationId: null },
    };
    db.state.sessions = [
      { id: "session-a", creatorUserId: "creator-a" },
      { id: "session-b", creatorUserId: "creator-b" },
    ];
    db.state.flags = [
      { id: "flag-a", sessionId: "session-a", severity: "medium", status: "pending", slaDueAt: null },
      { id: "flag-b", sessionId: "session-b", severity: "medium", status: "pending", slaDueAt: null },
    ];
    db.state.auditLogs = [];
  });

  it("shows an admin only their organization's flags", async () => {
    const response = await queueAs(bearer("admin-a", "institutional_admin"));

    expect(response.body.data.flags.map((flag: Row) => flag.id)).toEqual(["flag-a"]);
  });

  it("shows an admin without an organization no flags", async () => {
    const response = await queueAs(bearer("admin-none", "institutional_admin"));

    expect(response.body.data.flags).toEqual([]);
  });

  it("still shows moderators every flag", async () => {
    const response = await queueAs(bearer("moderator", "moderator"));

    expect(response.body.data.flags).toHaveLength(2);
  });

  it("lets an admin review their organization's flags but not another's", async () => {
    await reviewAs(bearer("admin-a", "institutional_admin"), "flag-b").expect(403);
    expect(db.state.flags.find((flag) => flag.id === "flag-b")?.status).toBe("pending");
    expect(db.state.auditLogs).toContainEqual(expect.objectContaining({ eventType: "authz_denied", actorId: "admin-a" }));

    await reviewAs(bearer("admin-a", "institutional_admin"), "flag-a").expect(200);
    expect(db.state.flags.find((flag) => flag.id === "flag-a")?.status).toBe("approved");
  });
});
