-- CG-FR68: Per-round position snapshots for re-entry lineage
CREATE TABLE "PositionSnapshot" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roundNumber" INTEGER NOT NULL,
    "positionText" TEXT NOT NULL,
    "snapshotAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PositionSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PositionSnapshot_sessionId_roundNumber_idx" ON "PositionSnapshot"("sessionId", "roundNumber");

-- CreateIndex
CREATE UNIQUE INDEX "PositionSnapshot_sessionId_userId_roundNumber_key" ON "PositionSnapshot"("sessionId", "userId", "roundNumber");

-- AddForeignKey
ALTER TABLE "PositionSnapshot" ADD CONSTRAINT "PositionSnapshot_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
