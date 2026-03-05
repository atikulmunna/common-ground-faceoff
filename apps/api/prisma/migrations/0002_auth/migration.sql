-- Add authentication fields to User
ALTER TABLE "User" ADD COLUMN "passwordHash" TEXT;
ALTER TABLE "User" ADD COLUMN "emailVerified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'individual_user';
ALTER TABLE "User" ADD COLUMN "mfaEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "mfaSecret" TEXT;
ALTER TABLE "User" ADD COLUMN "failedLoginCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "lockedUntil" TIMESTAMP;

-- Create RefreshToken table
CREATE TABLE "RefreshToken" (
  "id" TEXT PRIMARY KEY,
  "token" TEXT NOT NULL UNIQUE,
  "userId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP NOT NULL,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- Create AuditLog table for auth/security events (CG-NFR14)
CREATE TABLE "AuditLog" (
  "id" TEXT PRIMARY KEY,
  "eventType" TEXT NOT NULL,
  "actorId" TEXT,
  "actorEmail" TEXT,
  "ip" TEXT,
  "detail" TEXT,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "AuditLog_eventType_idx" ON "AuditLog"("eventType");
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");

-- Add ModerationSeverity enum (already declared in Prisma but missing from 0001)
DO $$ BEGIN
  CREATE TYPE "ModerationSeverity" AS ENUM ('low', 'medium', 'high', 'critical');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
