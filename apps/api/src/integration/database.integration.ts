import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

function requireSafeTestDatabaseUrl(): string {
  const value = process.env.TEST_DATABASE_URL;
  if (!value) {
    throw new Error("TEST_DATABASE_URL is required for integration tests");
  }

  const url = new URL(value);
  const databaseName = url.pathname.replace(/^\//, "").toLowerCase();
  if (!databaseName.includes("test")) {
    throw new Error("Refusing integration tests: database name must contain 'test'");
  }
  return value;
}

const testDatabaseUrl = requireSafeTestDatabaseUrl();
process.env.DATABASE_URL = testDatabaseUrl;
process.env.NEXTAUTH_SECRET = "integration-nextauth-secret-at-least-32-characters";
const oauthExchangeSecret = "integration-oauth-exchange-secret-at-least-32-characters";
process.env.OAUTH_EXCHANGE_SECRET = oauthExchangeSecret;
process.env.NODE_ENV = "test";
process.env.ENABLE_SAML = "false";
process.env.ENABLE_BILLING = "false";
process.env.ENABLE_SMS_MFA = "false";
process.env.ENABLE_EXTERNAL_EXPORT_STORAGE = "false";
const prisma = new PrismaClient({ datasourceUrl: testDatabaseUrl });

describe("PostgreSQL session lifecycle", () => {
  const runId = randomUUID();
  const creatorEmail = `integration-creator-${runId}@example.test`;
  const participantEmail = `integration-participant-${runId}@example.test`;
  let creatorId: string;
  let participantId: string;
  let sessionId: string;

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    if (sessionId) {
      await prisma.positionSnapshot.deleteMany({ where: { sessionId } });
      await prisma.sessionParticipant.deleteMany({ where: { sessionId } });
      await prisma.session.deleteMany({ where: { id: sessionId } });
    }
    await prisma.user.deleteMany({
      where: { email: { in: [creatorEmail, participantEmail] } },
    });
    await prisma.$disconnect();
  });

  it("persists participants, positions, and round snapshots", async () => {
    const [creator, participant] = await Promise.all([
      prisma.user.create({
        data: { email: creatorEmail, displayName: "Integration Creator", emailVerified: true },
      }),
      prisma.user.create({
        data: { email: participantEmail, displayName: "Integration Participant", emailVerified: true },
      }),
    ]);
    creatorId = creator.id;
    participantId = participant.id;

    const session = await prisma.session.create({
      data: {
        topic: "Should this integration fixture persist correctly?",
        status: "collecting_positions",
        creatorUserId: creatorId,
        participants: {
          create: [
            { userId: creatorId, role: "session_creator", canExport: true },
            { userId: participantId, role: "session_participant" },
          ],
        },
      },
      include: { participants: true },
    });
    sessionId = session.id;

    const positionText = "A".repeat(120);
    await prisma.$transaction([
      prisma.sessionParticipant.update({
        where: { sessionId_userId: { sessionId, userId: participantId } },
        data: { positionText, positionSubmittedAt: new Date() },
      }),
      prisma.positionSnapshot.create({
        data: { sessionId, userId: participantId, roundNumber: 1, positionText },
      }),
    ]);

    const persisted = await prisma.session.findUniqueOrThrow({
      where: { id: sessionId },
      include: { participants: true, positionSnapshots: true },
    });

    expect(persisted.participants).toHaveLength(2);
    expect(persisted.positionSnapshots).toMatchObject([
      { userId: participantId, roundNumber: 1, positionText },
    ]);
  });
});

describe("authenticated HTTP journey", () => {
  const runId = randomUUID();
  const email = `integration-http-${runId}@example.test`;
  const topic = "Should this authenticated integration journey persist correctly?";
  const positionText = "A durable integration test should exercise real HTTP authorization and PostgreSQL persistence without calling paid external providers.";
  let app: Express;
  let userId: string | undefined;
  let sessionId: string | undefined;
  let refreshToken: string | undefined;

  beforeAll(async () => {
    const { createApp } = await import("../app.js");
    app = createApp();
  });

  afterAll(async () => {
    if (sessionId) {
      await prisma.analysisResult.deleteMany({ where: { sessionId } });
      await prisma.positionSnapshot.deleteMany({ where: { sessionId } });
      await prisma.sessionParticipant.deleteMany({ where: { sessionId } });
      await prisma.session.deleteMany({ where: { id: sessionId } });
    }
    if (userId) {
      await prisma.refreshToken.deleteMany({ where: { userId } });
      await prisma.auditLog.deleteMany({ where: { actorId: userId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    }
  });

  it("authenticates, creates a session, submits a position, reads analysis, exports, and logs out", async () => {
    const authResponse = await request(app)
      .post("/auth/oauth-exchange")
      .set("x-common-ground-internal-secret", oauthExchangeSecret)
      .send({ email, displayName: "HTTP Integration User", provider: "google" })
      .expect(200);

    const authData = authResponse.body.data as {
      user: { id: string };
      accessToken: string;
      refreshToken: string;
    };
    userId = authData.user.id;
    refreshToken = authData.refreshToken;
    const authorization = `Bearer ${authData.accessToken}`;

    const createResponse = await request(app)
      .post("/sessions")
      .set("Authorization", authorization)
      .send({ topic, anonymousMode: false })
      .expect(201);

    sessionId = (createResponse.body.data as { session: { id: string } }).session.id;

    await request(app)
      .post(`/sessions/${sessionId}/positions`)
      .set("Authorization", authorization)
      .send({ positionText, roundNumber: 1 })
      .expect(200);

    await prisma.analysisResult.create({
      data: {
        sessionId,
        roundNumber: 1,
        pipelineRunId: `integration-${runId}`,
        analysisVersion: "integration-v1",
        promptTemplateVersion: "integration-prompt-v1",
        inputHash: `integration-input-${runId}`,
        steelmans: { participant: "Integration testing should cover real persistence boundaries." },
        conflictMap: { priorities: ["speed versus breadth"] },
        sharedFoundations: "Reliable releases require repeatable verification.",
        trueDisagreements: "How much of the external provider boundary belongs in this test.",
        confidenceScores: { sharedFoundations: 0.95, disagreements: 0.9 },
        llmProvider: "integration-fixture",
        modelVersion: "deterministic",
        status: "completed",
      },
    });
    await prisma.session.update({
      where: { id: sessionId },
      data: { status: "completed", analyzedAt: new Date() },
    });

    const sessionResponse = await request(app)
      .get(`/sessions/${sessionId}`)
      .set("Authorization", authorization)
      .expect(200);
    expect(sessionResponse.body.data.session).toMatchObject({
      id: sessionId,
      topic,
      status: "completed",
    });
    expect(sessionResponse.body.data.session.participants[0].positionText).toBe(positionText);

    const analysisResponse = await request(app)
      .get(`/sessions/${sessionId}/analysis`)
      .set("Authorization", authorization)
      .expect(200);
    expect(analysisResponse.body.data).toMatchObject({
      status: "completed",
      analysisVersion: "integration-v1",
      promptTemplateVersion: "integration-prompt-v1",
    });

    const exportResponse = await request(app)
      .get(`/sessions/${sessionId}/export/json`)
      .set("Authorization", authorization)
      .expect("Content-Type", /json/)
      .expect(200);
    expect(exportResponse.body).toMatchObject({
      session: { id: sessionId, topic },
      analysis: { version: "integration-v1", modelVersion: "deterministic" },
    });

    await request(app)
      .post("/auth/logout")
      .send({ refreshToken })
      .expect(200);

    await expect(prisma.refreshToken.findUnique({
      where: { token: refreshToken },
    })).resolves.toBeNull();
  });
});

describe("retention and account erasure", () => {
  let app: Express;

  beforeAll(async () => {
    const { createApp } = await import("../app.js");
    app = createApp();
  });

  it("deletes an expired free-tier session and every linked record", async () => {
    const runId = randomUUID();
    const user = await prisma.user.create({
      data: {
        email: `retention-${runId}@example.test`,
        displayName: "Retention Fixture",
        emailVerified: true,
      },
    });
    const session = await prisma.session.create({
      data: {
        topic: "This expired free-tier session should be removed by retention.",
        creatorUserId: user.id,
        status: "collecting_positions",
        createdAt: new Date(Date.now() - 91 * 24 * 60 * 60 * 1000),
        participants: {
          create: { userId: user.id, role: "session_creator", canExport: true },
        },
      },
    });

    await prisma.positionSnapshot.create({
      data: { sessionId: session.id, userId: user.id, roundNumber: 1, positionText: "x".repeat(120) },
    });
    await prisma.promptLog.create({
      data: {
        sessionId: session.id,
        pipelineRunId: `retention-${runId}`,
        stage: "synthesis",
        provider: "fixture",
        model: "fixture",
        systemPrompt: "fixture",
        userPrompt: "fixture",
        responseText: "fixture",
      },
    });
    await prisma.emailInvitation.create({
      data: {
        sessionId: session.id,
        email: `invite-${runId}@example.test`,
        invitedById: user.id,
      },
    });
    await prisma.notificationEmail.create({
      data: {
        kind: "fixture",
        recipientEmail: user.email,
        sessionId: session.id,
      },
    });

    const { runRetentionCleanup } = await import("../jobs/retentionJob.js");
    await expect(runRetentionCleanup(prisma)).resolves.toEqual({ deleted: 1 });
    await expect(prisma.session.findUnique({ where: { id: session.id } })).resolves.toBeNull();
    await expect(prisma.notificationEmail.count({ where: { sessionId: session.id } })).resolves.toBe(0);

    await prisma.user.delete({ where: { id: user.id } });
  });

  it("pseudonymizes a session owner and rejects their existing access token", async () => {
    const runId = randomUUID();
    const email = `erasure-${runId}@example.test`;
    const authResponse = await request(app)
      .post("/auth/oauth-exchange")
      .set("x-common-ground-internal-secret", oauthExchangeSecret)
      .send({ email, displayName: "Erasure Fixture", provider: "google" })
      .expect(200);
    const authData = authResponse.body.data as {
      user: { id: string };
      accessToken: string;
    };
    const authorization = `Bearer ${authData.accessToken}`;

    const createResponse = await request(app)
      .post("/sessions")
      .set("Authorization", authorization)
      .send({ topic: "This session must survive owner erasure without retaining PII.", anonymousMode: false })
      .expect(201);
    const sessionId = (createResponse.body.data as { session: { id: string } }).session.id;

    await request(app)
      .post(`/sessions/${sessionId}/positions`)
      .set("Authorization", authorization)
      .send({ positionText: "This personally authored position must be scrubbed when the account is erased.".repeat(2), roundNumber: 1 })
      .expect(200);
    await prisma.positionSnapshot.create({
      data: { sessionId, userId: authData.user.id, roundNumber: 1, positionText: "sensitive snapshot" },
    });
    const auditIds = (await prisma.auditLog.findMany({
      where: { actorId: authData.user.id },
      select: { id: true },
    })).map((entry) => entry.id);

    await request(app)
      .delete("/privacy/account")
      .set("Authorization", authorization)
      .expect(200, { success: true, data: { deleted: true }, error: null });

    await request(app)
      .get("/sessions")
      .set("Authorization", authorization)
      .expect(401);

    const tombstone = await prisma.user.findUniqueOrThrow({ where: { id: authData.user.id } });
    expect(tombstone).toMatchObject({
      displayName: "[DELETED]",
      passwordHash: null,
      emailVerified: false,
    });
    expect(tombstone.email).toMatch(/^deleted-.*@deleted\.invalid$/);
    expect(tombstone.accountDeletedAt).toBeInstanceOf(Date);
    await expect(prisma.positionSnapshot.count({ where: { userId: authData.user.id } })).resolves.toBe(0);
    await expect(prisma.sessionParticipant.findUniqueOrThrow({
      where: { sessionId_userId: { sessionId, userId: authData.user.id } },
    })).resolves.toMatchObject({ positionText: "[DELETED]", positionSubmittedAt: null });

    await prisma.sessionParticipant.deleteMany({ where: { sessionId } });
    await prisma.session.delete({ where: { id: sessionId } });
    await prisma.auditLog.deleteMany({ where: { id: { in: auditIds } } });
    await prisma.user.delete({ where: { id: authData.user.id } });
  });
});

describe("public route boundaries", () => {
  let app: Express;

  beforeAll(async () => {
    const { createApp } = await import("../app.js");
    app = createApp();
  });

  it("serves the public subprocessor inventory without authentication", async () => {
    const response = await request(app)
      .get("/privacy/subprocessors")
      .expect("Content-Type", /json/)
      .expect(200);

    expect(response.body).toMatchObject({ success: true, error: null });
    expect(Array.isArray(response.body.data)).toBe(true);
  });

  it("reaches public MFA login verification before protected middleware", async () => {
    const response = await request(app)
      .post("/mfa/verify-login")
      .send({})
      .expect("Content-Type", /json/)
      .expect(400);

    expect(response.body.error.code).toBe("validation_error");
  });
});
