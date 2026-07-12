import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
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
