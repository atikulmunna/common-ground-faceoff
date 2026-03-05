-- CreateTable
CREATE TABLE "SectionReaction" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "reaction" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SectionReaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SectionReaction_sessionId_idx" ON "SectionReaction"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "SectionReaction_sessionId_userId_section_key" ON "SectionReaction"("sessionId", "userId", "section");
