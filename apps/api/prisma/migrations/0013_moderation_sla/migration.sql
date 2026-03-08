-- CG-FR65: Moderation SLA tracking
ALTER TABLE "ModerationFlag" ADD COLUMN "slaDueAt" TIMESTAMP(3);
ALTER TABLE "ModerationFlag" ADD COLUMN "slaBreachedAt" TIMESTAMP(3);
