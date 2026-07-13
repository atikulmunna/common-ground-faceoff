import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { hash } from "bcrypt";
import { expect, test } from "@playwright/test";

const databaseUrl = process.env.E2E_DATABASE_URL;
if (!databaseUrl) throw new Error("E2E_DATABASE_URL is required");

const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
const runId = randomUUID();
const email = `browser-e2e-${runId}@example.test`;
const password = "BrowserE2E!234";
const topic = "Should browser E2E tests cover the complete release-critical journey?";
const position = "Browser-level verification should cover authentication, session creation, position persistence, completed analysis rendering, and a downloadable export.";

let userId: string | undefined;
let sessionId: string | undefined;

test.beforeAll(async () => {
  const user = await prisma.user.create({
    data: {
      email,
      displayName: "Browser E2E User",
      passwordHash: await hash(password, 10),
      emailVerified: true,
    },
  });
  userId = user.id;
});

test.afterAll(async () => {
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
  await prisma.$disconnect();
});

test("signs in, creates a session, submits a position, views completed analysis, and exports JSON", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).toHaveURL("http://127.0.0.1:3310/");
  await expect(page.getByRole("heading", { name: "Session Dashboard" })).toBeVisible();

  await page.getByRole("link", { name: "+ New Session" }).click();
  await page.getByLabel("Topic statement").fill(topic);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page).toHaveURL(/\/session\/[^/]+$/);
  sessionId = new URL(page.url()).pathname.split("/").pop();
  expect(sessionId).toBeTruthy();

  await page.getByPlaceholder("Submit your position in 100-5000 characters").fill(position);
  await page.getByRole("button", { name: "Submit your position" }).click();
  await expect(page.getByRole("button", { name: "Trigger Analysis" })).toBeVisible();

  await prisma.analysisResult.create({
    data: {
      sessionId: sessionId!,
      roundNumber: 1,
      pipelineRunId: `browser-e2e-${runId}`,
      analysisVersion: "browser-e2e-v1",
      promptTemplateVersion: "browser-e2e-prompt-v1",
      inputHash: `browser-e2e-input-${runId}`,
      steelmans: { participant: "Release-critical journeys benefit from browser-level verification." },
      conflictMap: { scope: ["test speed versus production fidelity"] },
      sharedFoundations: "Everyone benefits from reliable and repeatable releases.",
      trueDisagreements: "The remaining disagreement concerns the breadth of external provider testing.",
      confidenceScores: { sharedFoundations: 0.96, disagreements: 0.91 },
      llmProvider: "e2e-fixture",
      modelVersion: "deterministic",
      status: "completed",
    },
  });
  await prisma.session.update({
    where: { id: sessionId },
    data: { status: "completed", analyzedAt: new Date() },
  });

  await page.reload();
  await expect(page.getByRole("heading", { name: "Common Ground Map" })).toBeVisible();
  await expect(page.getByText("Everyone benefits from reliable and repeatable releases.")).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "JSON", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(`common-ground-${sessionId}.json`);
});
