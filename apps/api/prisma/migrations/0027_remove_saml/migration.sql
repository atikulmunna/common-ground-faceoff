-- D3 (decided 2026-11-14): the experimental SAML sign-in is removed. It never verified the
-- identity provider's signature, so it could not be made safe by configuration. Its settings go too.
ALTER TABLE "User" DROP COLUMN "samlNameId";
ALTER TABLE "Organization" DROP COLUMN "samlEntryPoint";
ALTER TABLE "Organization" DROP COLUMN "samlCert";
ALTER TABLE "Organization" DROP COLUMN "samlIssuer";
