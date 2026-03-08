import { prisma } from "../lib/prisma.js";
import { sendAnalysisCompleteNotificationDetailed } from "./emailService.js";

const ANALYSIS_COMPLETE_KIND = "analysis_complete";
const MAX_ATTEMPTS = 5;

interface AnalysisCompletePayload {
  sessionId: string;
  sessionTopic: string;
}

function computeRetryDelayMs(attempt: number): number {
  const seconds = Math.min(300, 2 ** Math.max(0, attempt - 1) * 15);
  return seconds * 1000;
}

export async function enqueueAnalysisCompletionEmails(sessionId: string, topic: string): Promise<number> {
  const participants = await prisma.sessionParticipant.findMany({
    where: { sessionId },
    select: {
      user: {
        select: {
          email: true,
          notificationPrefs: true,
        },
      },
    },
  });

  const recipients = participants
    .filter((p) => {
      const prefs = p.user.notificationPrefs as { emailAnalysisComplete?: boolean } | null;
      return prefs?.emailAnalysisComplete ?? true;
    })
    .map((p) => p.user.email);

  if (recipients.length === 0) {
    console.info("[EmailOutbox] No eligible recipients for analysis completion", { sessionId });
    return 0;
  }

  const payload: AnalysisCompletePayload = {
    sessionId,
    sessionTopic: topic,
  };

  const created = await prisma.notificationEmail.createMany({
    data: recipients.map((recipientEmail) => ({
      kind: ANALYSIS_COMPLETE_KIND,
      recipientEmail,
      sessionId,
      payload: payload as any,
      status: "pending",
    })),
  });

  console.info("[EmailOutbox] Queued analysis completion notifications", {
    sessionId,
    count: created.count,
  });

  return created.count;
}

export async function processNotificationEmailOutbox(limit = 20): Promise<number> {
  const now = new Date();
  const pending = await prisma.notificationEmail.findMany({
    where: {
      status: { in: ["pending", "retrying"] },
      nextAttemptAt: { lte: now },
    },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  if (pending.length === 0) return 0;

  let processed = 0;
  for (const item of pending) {
    const attempt = item.attempts + 1;

    if (item.kind !== ANALYSIS_COMPLETE_KIND) {
      await prisma.notificationEmail.update({
        where: { id: item.id },
        data: {
          attempts: attempt,
          status: "failed",
          lastAttemptAt: now,
          lastError: `Unsupported notification kind: ${item.kind}`,
        },
      });
      processed += 1;
      continue;
    }

    const payload = (item.payload ?? {}) as Partial<AnalysisCompletePayload>;
    if (!payload.sessionId || !payload.sessionTopic) {
      await prisma.notificationEmail.update({
        where: { id: item.id },
        data: {
          attempts: attempt,
          status: "failed",
          lastAttemptAt: now,
          lastError: "Invalid payload for analysis completion notification",
        },
      });
      processed += 1;
      continue;
    }

    const result = await sendAnalysisCompleteNotificationDetailed({
      recipientEmail: item.recipientEmail,
      sessionId: payload.sessionId,
      sessionTopic: payload.sessionTopic,
    });

    if (result.ok) {
      await prisma.notificationEmail.update({
        where: { id: item.id },
        data: {
          attempts: attempt,
          status: "sent",
          lastAttemptAt: now,
          lastError: null,
          providerMessageId: result.providerMessageId,
          sentAt: now,
        },
      });
      console.info("[EmailOutbox] Delivered analysis completion email", {
        notificationId: item.id,
        sessionId: item.sessionId,
        recipientEmail: item.recipientEmail,
        providerMessageId: result.providerMessageId ?? null,
      });
    } else {
      const shouldRetry = attempt < MAX_ATTEMPTS;
      await prisma.notificationEmail.update({
        where: { id: item.id },
        data: {
          attempts: attempt,
          status: shouldRetry ? "retrying" : "failed",
          lastAttemptAt: now,
          lastError: result.error ?? "Unknown send failure",
          nextAttemptAt: shouldRetry ? new Date(now.getTime() + computeRetryDelayMs(attempt)) : item.nextAttemptAt,
        },
      });
      console.error("[EmailOutbox] Delivery failed", {
        notificationId: item.id,
        sessionId: item.sessionId,
        recipientEmail: item.recipientEmail,
        attempt,
        willRetry: shouldRetry,
        error: result.error ?? "Unknown send failure",
      });
    }

    processed += 1;
  }

  return processed;
}
