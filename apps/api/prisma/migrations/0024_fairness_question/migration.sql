-- One question replaces the two star ratings: "Did this feel fair to you?" (yes, somewhat, no).
-- Older ratings keep their stars and have no answer here; new answers have no stars.
ALTER TABLE "FeedbackRating" ADD COLUMN "fairness" TEXT;
ALTER TABLE "FeedbackRating" ALTER COLUMN "faithfulness" DROP NOT NULL;
ALTER TABLE "FeedbackRating" ALTER COLUMN "neutrality" DROP NOT NULL;
