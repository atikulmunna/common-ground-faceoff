-- Keep each shared foundation and disagreement with the quotes that support it.
-- Older results keep NULL here and are shown from their text fields.
ALTER TABLE "AnalysisResult" ADD COLUMN "sharedFoundationPoints" JSONB;
ALTER TABLE "AnalysisResult" ADD COLUMN "disagreementPoints" JSONB;
