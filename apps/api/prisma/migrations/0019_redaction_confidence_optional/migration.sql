-- Redaction no longer reports a confidence value: the old numbers were fixed placeholders, not
-- measurements. Existing rows keep theirs; new rows leave the column empty.
ALTER TABLE "RedactionLog" ALTER COLUMN "confidence" DROP NOT NULL;
