-- AlterTable: add profile fields to User
ALTER TABLE "User" ADD COLUMN "avatarUrl" TEXT;
ALTER TABLE "User" ADD COLUMN "notificationPrefs" JSONB;

-- CreateTable: SectionComment
CREATE TABLE "SectionComment" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SectionComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SectionComment_sessionId_idx" ON "SectionComment"("sessionId");
