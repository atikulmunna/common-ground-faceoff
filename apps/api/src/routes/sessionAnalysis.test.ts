import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const db = vi.hoisted(() => {
  const state: { session: Row | null; latestResult: Row | null } = { session: null, latestResult: null };
  const prisma = {
    user: { findUnique: async () => ({ accountDeletedAt: null }) },
    session: { findUnique: async () => state.session },
    analysisResult: { findFirst: async () => state.latestResult },
  };
  return { state, prisma };
});

vi.mock("../lib/prisma.js", () => ({ prisma: db.prisma }));

import { createApp } from "../app.js";
import { signAccessToken } from "../lib/auth.js";

const authorization = `Bearer ${signAccessToken({ sub: "user-1", email: "user@example.test", role: "individual_user" })}`;

describe("GET /sessions/:id/analysis", () => {
  beforeEach(() => {
    db.state.session = {
      id: "session-1",
      creatorUserId: "user-1",
      participants: [{ userId: "user-1" }],
      status: "collecting_positions",
      estimatedCompletionAt: null,
    };
    db.state.latestResult = null;
  });

  it("reports the conversation's current status while a new round collects perspectives", async () => {
    db.state.latestResult = {
      id: "result-1",
      roundNumber: 1,
      status: "completed",
      pipelineRunId: "run-1",
      analysisVersion: "v1",
      promptTemplateVersion: "tpl-v1",
    };

    const response = await request(createApp())
      .get("/sessions/session-1/analysis")
      .set("Authorization", authorization)
      .expect(200);

    expect(response.body.data.status).toBe("collecting_positions");
    // The previous round's result stays available for reference.
    expect(response.body.data.result).toMatchObject({ id: "result-1", roundNumber: 1 });
  });

  it("reports the conversation's status when no analysis exists yet", async () => {
    db.state.session = { ...db.state.session, status: "running" };

    const response = await request(createApp())
      .get("/sessions/session-1/analysis")
      .set("Authorization", authorization)
      .expect(200);

    expect(response.body.data).toMatchObject({ status: "running", result: null });
  });
});
