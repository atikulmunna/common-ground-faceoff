import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

// In-memory stand-in for the Prisma calls made by authentication, session access and share links.
const db = vi.hoisted(() => {
  const state = {
    users: {} as Record<string, Row>,
    session: null as Row | null,
    flags: [] as Row[],
    shareLink: null as Row | null,
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
      findUnique: async ({ where }: { where: Row }) =>
        state.session && where.id === state.session.id ? state.session : null,
    },
    moderationFlag: {
      findFirst: async ({ where }: { where: Row }) =>
        state.flags.find((flag) => flag.sessionId === where.sessionId) ?? null,
    },
    shareLink: {
      findUnique: async ({ where }: { where: Row }) =>
        state.shareLink && where.id === state.shareLink.id ? state.shareLink : null,
      update: async ({ data }: { data: Row }) => ({ ...state.shareLink, ...data }),
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

function bearer(id: string, role: string): string {
  return `Bearer ${signAccessToken({ sub: id, email: `${id}@example.test`, role })}`;
}

const asOutsider = bearer("outsider", "individual_user");
const asModerator = bearer("moderator", "moderator");
const asAdminSameOrg = bearer("admin-a", "institutional_admin");
const asAdminOtherOrg = bearer("admin-b", "institutional_admin");
const asAdminWithoutOrg = bearer("admin-none", "institutional_admin");

describe("staff access to conversations", () => {
  beforeEach(() => {
    db.state.users = {
      creator: { organizationId: "org-a" },
      outsider: { organizationId: "org-a" },
      moderator: { organizationId: null },
      "admin-a": { organizationId: "org-a" },
      "admin-b": { organizationId: "org-b" },
      "admin-none": { organizationId: null },
    };
    db.state.session = {
      id: "session-1",
      creatorUserId: "creator",
      status: "completed",
      anonymousMode: false,
      participants: [
        {
          userId: "creator",
          positionText: "Office days help new hires learn quickly.",
          user: { id: "creator", email: "creator@example.test", displayName: "Creator" },
        },
      ],
    };
    db.state.flags = [];
    db.state.shareLink = { id: "link-1", sessionId: "session-1", revoked: false };
    db.state.auditLogs = [];
  });

  function viewConversation(authorization: string) {
    return request(createApp()).get("/sessions/session-1").set("Authorization", authorization);
  }

  function revokeShareLink(authorization: string) {
    return request(createApp()).delete("/share-links/link-1").set("Authorization", authorization);
  }

  it("still keeps out users who are not part of the conversation", async () => {
    await viewConversation(asOutsider).expect(403);
  });

  it("keeps moderators out of conversations nobody has flagged", async () => {
    await viewConversation(asModerator).expect(403);

    expect(db.state.auditLogs).toContainEqual(expect.objectContaining({ eventType: "authz_denied", actorId: "moderator" }));
  });

  it("lets moderators into conversations that have a flag", async () => {
    db.state.flags = [{ sessionId: "session-1", status: "pending" }];

    await viewConversation(asModerator).expect(200);
  });

  it("lets admins into conversations created by members of their organization", async () => {
    await viewConversation(asAdminSameOrg).expect(200);
  });

  it("keeps admins out of other organizations' conversations", async () => {
    await viewConversation(asAdminOtherOrg).expect(403);
  });

  it("gives an admin without an organization no access, even to creators without one", async () => {
    db.state.users.creator = { organizationId: null };

    await viewConversation(asAdminWithoutOrg).expect(403);
  });

  it("lets only same-organization admins revoke another creator's share link", async () => {
    await revokeShareLink(asAdminOtherOrg).expect(403);

    const response = await revokeShareLink(asAdminSameOrg).expect(200);
    expect(response.body.data.shareLink.revoked).toBe(true);
  });
});
