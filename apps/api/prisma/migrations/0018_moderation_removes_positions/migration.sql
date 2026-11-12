-- Let a moderator's "delete" remove the flagged position: flags record whose position they are
-- about, and a removed position is marked until its author rewrites it. Additive only.

ALTER TABLE "SessionParticipant" ADD COLUMN "positionRemovedAt" TIMESTAMP(3);

ALTER TABLE "ModerationFlag" ADD COLUMN "participantId" TEXT;
CREATE INDEX "ModerationFlag_participantId_idx" ON "ModerationFlag"("participantId");
ALTER TABLE "ModerationFlag" ADD CONSTRAINT "ModerationFlag_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "SessionParticipant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
