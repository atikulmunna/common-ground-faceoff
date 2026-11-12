import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const db = vi.hoisted(() => {
  const state: { session: Row | null; latestResult: Row | null } = { session: null, latestResult: null };
  const prisma = {
    user: { findUnique: async () => ({ accountDeletedAt: null }) },
    session: {
      findUnique: async ({ where }: { where: Row }) =>
        state.session && where.id === state.session.id ? state.session : null,
      findMany: vi.fn(async () => []),
    },
    analysisResult: { findFirst: async () => state.latestResult },
  };
  return { state, prisma };
});

vi.mock("../lib/prisma.js", () => ({ prisma: db.prisma }));

const runAnalysis = vi.hoisted(() => vi.fn());
vi.mock("../services/analysisService.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/analysisService.js")>()),
  runAnalysis,
}));

import { createApp } from "../app.js";
import { signAccessToken } from "../lib/auth.js";
import { AnalysisConflictError } from "../services/analysisService.js";

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

describe("POST /sessions/:id/analyze", () => {
  beforeEach(() => {
    db.state.session = {
      id: "session-1",
      creatorUserId: "user-1",
      participants: [{ userId: "user-1", canExport: true }],
      status: "collecting_positions",
    };
    runAnalysis.mockReset();
  });

  function analyze() {
    return request(createApp())
      .post("/sessions/session-1/analyze")
      .set("Authorization", authorization)
      .send({ analysisVersion: "v1", promptTemplateVersion: "tpl-v1" });
  }

  it("answers 409 when the conversation cannot start an analysis right now", async () => {
    runAnalysis.mockRejectedValueOnce(new AnalysisConflictError("An analysis is already in progress for this conversation."));

    const response = await analyze().expect(409);

    expect(response.body.error).toMatchObject({
      code: "async_state_error",
      message: "An analysis is already in progress for this conversation.",
    });
  });

  it("still answers 422 when the input cannot be analyzed", async () => {
    runAnalysis.mockRejectedValueOnce(new Error("At least 2 participant positions are required for analysis"));

    await analyze().expect(422);
  });
});

describe("GET /sessions/demo-list", () => {
  it("no longer lists conversations from other users", async () => {
    db.state.session = null;
    db.prisma.session.findMany.mockClear();

    await request(createApp())
      .get("/sessions/demo-list")
      .set("Authorization", authorization)
      .expect(404);

    expect(db.prisma.session.findMany).not.toHaveBeenCalled();
  });
});
