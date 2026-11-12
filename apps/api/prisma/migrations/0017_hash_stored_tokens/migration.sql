-- Store only SHA-256 hashes of refresh tokens and email verification tokens.
-- Existing tokens are hashed in place with the same algorithm the API uses
-- (hex-encoded SHA-256 of the UTF-8 token), so current sessions and pending
-- verification links keep working and nobody is signed out.

UPDATE "RefreshToken" SET "token" = encode(sha256(convert_to("token", 'UTF8')), 'hex');
ALTER TABLE "RefreshToken" RENAME COLUMN "token" TO "tokenHash";
-- Created inline as UNIQUE in 0002_auth; renaming the index also renames its constraint.
ALTER INDEX "RefreshToken_token_key" RENAME TO "RefreshToken_tokenHash_key";

UPDATE "EmailVerificationToken" SET "token" = encode(sha256(convert_to("token", 'UTF8')), 'hex');
ALTER TABLE "EmailVerificationToken" RENAME COLUMN "token" TO "tokenHash";
ALTER INDEX "EmailVerificationToken_token_key" RENAME TO "EmailVerificationToken_tokenHash_key";
