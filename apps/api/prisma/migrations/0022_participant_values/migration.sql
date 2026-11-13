-- Keep what matters to each participant, as found in stage 3 of the analysis.
-- Older results keep NULL.
ALTER TABLE "AnalysisResult" ADD COLUMN "participantValues" JSONB;
