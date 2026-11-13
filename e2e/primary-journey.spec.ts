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
  await expect(page.getByRole("heading", { name: "Find the ground you share." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Common Ground home" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Three steps, and nobody has to win." })).toBeVisible();

  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("http://127.0.0.1:3310/");
  await expect(page.getByRole("heading", { name: "Your conversations" })).toBeVisible();

  await page.goto("/profile");
  await expect(page.getByRole("heading", { name: "Profile and settings" })).toBeVisible();
  await page.getByLabel("Display name").fill("Browser E2E User Updated");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Profile saved.")).toBeVisible();
  await page.getByRole("button", { name: "Set up two-step sign-in" }).click();
  await expect(page.getByRole("img", { name: "QR code for your authenticator app" })).toBeVisible();
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
  // The test environment has no email transport, so the page may report that the email was not sent.
  await expect(page.getByRole("status").filter({ hasText: invitedEmail })).toBeVisible();
  await expect(page.getByText("This conversation is full: 2 of 2 places are taken.")).toBeVisible();

  await page.getByRole("button", { name: "Report this conversation" }).click();
  await page.getByLabel("What is wrong?").fill("This is a disposable browser moderation report.");
  await page.getByRole("button", { name: "Send report" }).click();
  await expect(page.getByText("Report sent. A moderator will review it.")).toBeVisible();

  await page.getByLabel("What do you believe?").fill("Browser-level checks should cover the release-critical journey.");
  await page.getByLabel("Why do you believe it?").fill(position);
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
      steelmans: {
        "Participant A": "Release-critical journeys benefit from browser-level verification of reliable releases.",
        "Participant B": "Reliable releases matter, but external provider testing should stay narrow.",
      },
      conflictMap: { policy: ["How much external provider testing belongs in the release check."] },
      sharedFoundations: "Everyone benefits from reliable and repeatable releases.",
      trueDisagreements: "The remaining disagreement concerns the breadth of external provider testing.",
      sharedFoundationPoints: [{
        statement: "Everyone benefits from reliable and repeatable releases.",
        evidence: [
          { label: "Participant A", quote: "verification of reliable releases" },
          { label: "Participant B", quote: "Reliable releases matter" },
        ],
      }],
      disagreementPoints: [{
        statement: "How broad external provider testing should be.",
        category: "policy",
        evidence: [
          { label: "Participant A", quote: "browser-level verification" },
          { label: "Participant B", quote: "external provider testing should stay narrow" },
        ],
      }],
      verification: { sharedProposed: 1, sharedVerified: 1, differencesProposed: 1, differencesVerified: 1 },
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
  await expect(page.getByText("You agree on 1 point and differ on 1.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Where you agree" })).toBeVisible();
  await expect(page.getByText("Everyone benefits from reliable and repeatable releases.")).toBeVisible();
  await expect(page.getByText("From your view")).toBeVisible();
  await expect(page.getByRole("heading", { name: "How broad external provider testing should be." })).toBeVisible();
  await expect(page.getByText("Approach", { exact: true })).toBeVisible();

  const sharedPage = await page.context().newPage();
  await sharedPage.goto(`/shared?token=${encodeURIComponent(shareToken)}`);
  await expect(sharedPage.getByRole("heading", { name: topic })).toBeVisible();
  await expect(sharedPage.getByText("They agree on 1 point and differ on 1.")).toBeVisible();
  await expect(sharedPage.getByText("Everyone benefits from reliable and repeatable releases.")).toBeVisible();
  await expect(sharedPage.getByRole("link", { name: "Start your own conversation" })).toBeVisible();
  await expect(sharedPage.getByText("e2e-fixture")).toHaveCount(0);
  await sharedPage.close();

  const sharedFoundation = page.getByRole("region", { name: "Where you agree" });
  await sharedFoundation.getByRole("button", { name: "Yes" }).click();
  await expect(sharedFoundation.getByRole("button", { name: "Yes" })).toHaveAttribute("aria-pressed", "true");
  await sharedFoundation.getByRole("button", { name: "Add a comment" }).click();
  await sharedFoundation.getByLabel("Your comment").fill("This shared foundation is accurately represented.");
  await sharedFoundation.getByRole("button", { name: "Post comment" }).click();
  await expect(sharedFoundation.getByText("This shared foundation is accurately represented.")).toBeVisible();

  await page.getByRole("group", { name: "Did this feel fair to you?" }).getByRole("button", { name: "Yes" }).click();
  await page.getByLabel("Anything to add? (optional)").fill("Clear and balanced analysis.");
  await page.getByRole("button", { name: "Save my answer" }).click();
  await expect(page.getByText("Thanks. Your answer was saved.")).toBeVisible();

  for (const [format, extension] of [["JSON", "json"], ["Markdown", "md"], ["PDF", "pdf"]] as const) {
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: format, exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(`common-ground-${sessionId}.${extension}`);
  }

  await page.getByRole("button", { name: "Start round 2" }).click();
  await expect(page.getByRole("heading", { name: "Share your perspective" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Conversation progress" }).getByText("Perspectives")).toBeVisible();
});
