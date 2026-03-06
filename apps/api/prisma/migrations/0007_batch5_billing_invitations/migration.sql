-- Migration: 0007_batch5_billing_invitations
-- Batch 5: Stripe billing, email invitations, async ETA, mutual acknowledgment

-- Subscription model for Stripe billing
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stripeCustomerId" TEXT NOT NULL,
    "stripeSubscriptionId" TEXT NOT NULL UNIQUE,
    "stripePriceId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "currentPeriodStart" TIMESTAMP(3) NOT NULL,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Subscription_userId_key" ON "Subscription"("userId");
CREATE UNIQUE INDEX "Subscription_stripeCustomerId_key" ON "Subscription"("stripeCustomerId");
CREATE INDEX "Subscription_status_idx" ON "Subscription"("status");

ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Email invitation tracking
CREATE TABLE "EmailInvitation" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "invitedById" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "sentAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailInvitation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EmailInvitation_sessionId_idx" ON "EmailInvitation"("sessionId");
CREATE INDEX "EmailInvitation_email_idx" ON "EmailInvitation"("email");
CREATE UNIQUE INDEX "EmailInvitation_sessionId_email_key" ON "EmailInvitation"("sessionId", "email");

ALTER TABLE "EmailInvitation" ADD CONSTRAINT "EmailInvitation_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EmailInvitation" ADD CONSTRAINT "EmailInvitation_invitedById_fkey"
    FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Add Stripe customer ID to User
ALTER TABLE "User" ADD COLUMN "stripeCustomerId" TEXT;
CREATE UNIQUE INDEX "User_stripeCustomerId_key" ON "User"("stripeCustomerId");

-- Add estimatedCompletionAt to Session for async ETA (CG-FR57)
ALTER TABLE "Session" ADD COLUMN "estimatedCompletionAt" TIMESTAMP(3);

-- Add round column to SessionParticipant for multi-round tracking
ALTER TABLE "SessionParticipant" ADD COLUMN IF NOT EXISTS "round" INTEGER NOT NULL DEFAULT 1;

-- Webhook event idempotency (CG-FR67: replay protection)
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WebhookEvent_provider_eventId_key" ON "WebhookEvent"("provider", "eventId");
