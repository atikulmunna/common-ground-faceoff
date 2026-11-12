-- One-time ticket issued after the password step of an MFA login. Only its SHA-256 hash is stored.
ALTER TABLE "User" ADD COLUMN "mfaTicketHash" TEXT;
ALTER TABLE "User" ADD COLUMN "mfaTicketExpiresAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "User_mfaTicketHash_key" ON "User"("mfaTicketHash");
