-- 0006_institutional_saml_pii
-- Batch 4: SAML SSO, Institutional Admin, PII redaction pipeline, session timeout, share link enhancements

-- CreateEnum: RedactionStage
CREATE TYPE "RedactionStage" AS ENUM ('detect', 'mask', 'validate', 'uncertainty_check');

-- CreateTable: Organization (institutional admin cohort management)
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "samlEntryPoint" TEXT,
    "samlCert" TEXT,
    "samlIssuer" TEXT,
    "forceAnonymous" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateTable: Cohort (user groups within an organization)
CREATE TABLE "Cohort" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Cohort_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Cohort_orgId_idx" ON "Cohort"("orgId");

-- CreateTable: CohortMembership
CREATE TABLE "CohortMembership" (
    "id" TEXT NOT NULL,
    "cohortId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CohortMembership_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CohortMembership_cohortId_userId_key" ON "CohortMembership"("cohortId", "userId");

-- CreateTable: RedactionLog (PII pipeline audit trail)
CREATE TABLE "RedactionLog" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "stage" "RedactionStage" NOT NULL,
    "findingsCount" INT NOT NULL DEFAULT 0,
    "confidence" DOUBLE PRECISION NOT NULL,
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RedactionLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RedactionLog_sessionId_idx" ON "RedactionLog"("sessionId");

-- Add organizationId and samlNameId to User
ALTER TABLE "User" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "User" ADD COLUMN "samlNameId" TEXT;

-- Add lastActivityAt to Session (for CG-FR07 timeout)
ALTER TABLE "Session" ADD COLUMN "lastActivityAt" TIMESTAMP(3);

-- Add maxParticipants to Session (tier-based, pre-assigned support)
ALTER TABLE "Session" ADD COLUMN "maxParticipants" INT NOT NULL DEFAULT 6;
