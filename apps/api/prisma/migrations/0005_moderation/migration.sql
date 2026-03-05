-- CreateTable: ModerationFlag
CREATE TABLE "ModerationFlag" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "reportedBy" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "section" TEXT,
    "severity" "ModerationSeverity" NOT NULL DEFAULT 'medium',
    "autoDetected" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reviewedBy" TEXT,
    "reviewNotes" TEXT,
    "editedContent" TEXT,
    "appealText" TEXT,
    "appealStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "ModerationFlag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ModerationFlag_sessionId_idx" ON "ModerationFlag"("sessionId");
CREATE INDEX "ModerationFlag_status_idx" ON "ModerationFlag"("status");
