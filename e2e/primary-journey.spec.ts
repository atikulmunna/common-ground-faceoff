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
const invitedEmail = `browser-invite-${runId}@example.test`;

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
    await prisma.moderationFlag.deleteMany({ where: { sessionId } });
    await prisma.sectionComment.deleteMany({ where: { sessionId } });
    await prisma.sectionReaction.deleteMany({ where: { sessionId } });
    await prisma.feedbackRating.deleteMany({ where: { sessionId } });
    await prisma.analysisEvent.deleteMany({ where: { sessionId } });
    await prisma.shareLink.deleteMany({ where: { sessionId } });
    await prisma.notificationEmail.deleteMany({ where: { sessionId } });
    await prisma.emailInvitation.deleteMany({ where: { sessionId } });
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
  await prisma.user.deleteMany({ where: { email: invitedEmail } });
  await prisma.$disconnect();
});

test("signs in, starts a conversation, shares a perspective, reviews common ground, and exports JSON", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Turn disagreement into shared understanding." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Common Ground home" }).locator("img")).toBeVisible();
  await expect(page.getByRole("heading", { name: "A clear path through difficult conversations" })).toBeVisible();

  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).toHaveURL("http://127.0.0.1:3310/");
  await expect(page.getByRole("heading", { name: "Your conversations" })).toBeVisible();

  await page.goto("/profile");
  await expect(page.getByRole("heading", { name: "Profile Settings" })).toBeVisible();
  await page.getByLabel("Display Name").fill("Browser E2E User Updated");
  await page.getByRole("button", { name: "Save Changes" }).click();
  await expect(page.getByText("Profile saved.")).toBeVisible();
  await page.getByRole("button", { name: "Enable MFA" }).click();
  await expect(page.getByRole("img", { name: "MFA QR Code" })).toBeVisible();
  await page.goto("/");

  await page.getByRole("main").getByRole("link", { name: "New conversation" }).click();
  await page.getByLabel("Conversation topic or question").fill(topic);
  await page.getByRole("button", { name: "Start conversation", exact: true }).click();
  await expect(page).toHaveURL(/\/session\/[^/]+$/);
  sessionId = new URL(page.url()).pathname.split("/").pop();
  expect(sessionId).toBeTruthy();

  await page.getByLabel("Participant email address").fill(invitedEmail);
  await page.getByLabel("Personal message for invitation").fill("Please add your perspective to this release check.");
  await page.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByText(`Invitation sent to ${invitedEmail}`)).toBeVisible();

  page.once("dialog", async (dialog) => dialog.accept("This is a disposable browser moderation report."));
  await page.getByRole("button", { name: "Report this conversation" }).click();
  await expect(page.getByRole("button", { name: "Report this conversation" })).toHaveText("Reported");

  await page.getByPlaceholder("Share your perspective in 100–5000 characters").fill(position);
  await page.getByRole("button", { name: "Submit your perspective" }).click();
  await expect(page.getByRole("button", { name: "Find common ground" })).toBeVisible();

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
  const shareToken = `browser-share-${runId}`;
  await prisma.shareLink.create({
    data: {
      sessionId: sessionId!,
      token: shareToken,
      scope: "read_only",
      createdByUserId: userId!,
    },
  });

  await page.reload();
  await expect(page.getByRole("heading", { name: "Your common ground" })).toBeVisible();
  await expect(page.getByText("Everyone benefits from reliable and repeatable releases.")).toBeVisible();

  const sharedPage = await page.context().newPage();
  await sharedPage.goto(`/shared?token=${encodeURIComponent(shareToken)}`);
  await expect(sharedPage.getByRole("heading", { name: `Shared Session: ${topic}` })).toBeVisible();
  await expect(sharedPage.getByText("Everyone benefits from reliable and repeatable releases.")).toBeVisible();
  await sharedPage.close();

  const sharedFoundation = page.locator(".cgm-overlap");
  await sharedFoundation.getByTitle("Represents my view", { exact: true }).click();
  await expect(sharedFoundation.getByTitle("Represents my view", { exact: true })).toHaveClass(/cgm-reactions__btn--active/);
  await sharedFoundation.getByRole("button", { name: "Add comment" }).click();
  await sharedFoundation.getByPlaceholder("Write a comment…").fill("This shared foundation is accurately represented.");
  await sharedFoundation.getByRole("button", { name: "Post" }).click();
  await expect(sharedFoundation.getByText("This shared foundation is accurately represented.")).toBeVisible();

  const ratings = page.locator(".cgm-rating");
  await ratings.nth(0).getByRole("button", { name: "5 out of 5" }).click();
  await ratings.nth(1).getByRole("button", { name: "4 out of 5" }).click();
  await page.getByPlaceholder("Optional comment…").fill("Clear and balanced analysis.");
  await page.getByRole("button", { name: "Submit Feedback" }).click();
  await expect(page.getByText("Feedback submitted. Thank you!")).toBeVisible();

  for (const [format, extension] of [["JSON", "json"], ["Markdown", "md"], ["PDF", "pdf"]] as const) {
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: format, exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(`common-ground-${sessionId}.${extension}`);
  }

  await page.getByRole("button", { name: "Revise perspectives" }).click();
  await expect(page.getByRole("heading", { name: "Share your perspective" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Conversation progress" }).getByText("Perspectives")).toBeVisible();
});
