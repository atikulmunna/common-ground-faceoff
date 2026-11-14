-- Accounts an admin creates start with a temporary password; this marks them until the person
-- chooses their own.
ALTER TABLE "User" ADD COLUMN "passwordChangeRequired" BOOLEAN NOT NULL DEFAULT false;
