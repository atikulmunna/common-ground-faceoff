-- How many proposed points held up when checked against the restated views.
-- Older results keep NULL.
ALTER TABLE "AnalysisResult" ADD COLUMN "verification" JSONB;
