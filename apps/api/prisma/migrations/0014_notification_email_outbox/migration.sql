-- CG-FR13/operational reliability: durable email outbox for notifications
CREATE TABLE "NotificationEmail" (
  "id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "recipientEmail" TEXT NOT NULL,
  "sessionId" TEXT,
  "payload" JSONB,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastAttemptAt" TIMESTAMP(3),
  "lastError" TEXT,
  "providerMessageId" TEXT,
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "NotificationEmail_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "NotificationEmail_status_nextAttemptAt_idx" ON "NotificationEmail"("status", "nextAttemptAt");
CREATE INDEX "NotificationEmail_sessionId_idx" ON "NotificationEmail"("sessionId");
