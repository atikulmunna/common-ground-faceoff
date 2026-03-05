-- Initial schema for Common Ground MVP
CREATE TYPE "SessionStatus" AS ENUM ('draft', 'collecting_positions', 'queued', 'running', 'completed', 'failed', 'needs_input');
CREATE TYPE "ParticipantRole" AS ENUM ('session_creator', 'session_participant', 'observer');
CREATE TYPE "UserTier" AS ENUM ('free', 'pro', 'enterprise');

CREATE TABLE "User" (
  "id" TEXT PRIMARY KEY,
  "email" TEXT NOT NULL UNIQUE,
  "displayName" TEXT NOT NULL,
  "tier" "UserTier" NOT NULL DEFAULT 'free',
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastLoginAt" TIMESTAMP
);

CREATE TABLE "Session" (
  "id" TEXT PRIMARY KEY,
  "topic" TEXT NOT NULL,
  "status" "SessionStatus" NOT NULL DEFAULT 'draft',
  "creatorUserId" TEXT NOT NULL,
  "anonymousMode" BOOLEAN NOT NULL DEFAULT false,
  "deadline" TIMESTAMP,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "analyzedAt" TIMESTAMP,
  CONSTRAINT "Session_creatorUserId_fkey" FOREIGN KEY ("creatorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "SessionParticipant" (
  "id" TEXT PRIMARY KEY,
  "sessionId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" "ParticipantRole" NOT NULL DEFAULT 'session_participant',
  "canExport" BOOLEAN NOT NULL DEFAULT false,
  "positionText" TEXT,
  "positionSubmittedAt" TIMESTAMP,
  CONSTRAINT "SessionParticipant_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SessionParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SessionParticipant_sessionId_userId_key" UNIQUE ("sessionId", "userId")
);

CREATE TABLE "AnalysisResult" (
  "id" TEXT PRIMARY KEY,
  "sessionId" TEXT NOT NULL,
  "roundNumber" INTEGER NOT NULL DEFAULT 1,
  "parentSessionOrRoundId" TEXT,
  "pipelineRunId" TEXT NOT NULL,
  "analysisVersion" TEXT NOT NULL,
  "promptTemplateVersion" TEXT NOT NULL,
  "inputHash" TEXT NOT NULL,
  "steelmans" JSONB NOT NULL,
  "conflictMap" JSONB NOT NULL,
  "sharedFoundations" TEXT NOT NULL,
  "trueDisagreements" TEXT NOT NULL,
  "confidenceScores" JSONB NOT NULL,
  "llmProvider" TEXT NOT NULL,
  "modelVersion" TEXT NOT NULL,
  "status" "SessionStatus" NOT NULL,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AnalysisResult_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "AnalysisEvent" (
  "id" TEXT PRIMARY KEY,
  "sessionId" TEXT NOT NULL,
  "pipelineRunId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "fromState" TEXT,
  "toState" TEXT,
  "reasonCode" TEXT,
  "actorType" TEXT NOT NULL,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AnalysisEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "ShareLink" (
  "id" TEXT PRIMARY KEY,
  "sessionId" TEXT NOT NULL,
  "token" TEXT NOT NULL UNIQUE,
  "scope" TEXT NOT NULL DEFAULT 'read_only',
  "createdByUserId" TEXT NOT NULL,
  "revoked" BOOLEAN NOT NULL DEFAULT false,
  "revocationReason" TEXT,
  "expiresAt" TIMESTAMP,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ShareLink_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "FeedbackRating" (
  "id" TEXT PRIMARY KEY,
  "sessionId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "faithfulness" INTEGER NOT NULL,
  "neutrality" INTEGER NOT NULL,
  "comment" TEXT,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FeedbackRating_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "AnalysisResult_sessionId_roundNumber_idx" ON "AnalysisResult"("sessionId", "roundNumber");
CREATE INDEX "FeedbackRating_sessionId_idx" ON "FeedbackRating"("sessionId");
