import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { hashPassword } from "../lib/auth.js";
import { prisma } from "../lib/prisma.js";

/**
 * First organization admin. Nothing in the app can make someone an admin, so while no admin
 * exists the API makes a one-time code at startup and writes it to its own log (CloudWatch on the
 * server), which only people with access to the server's logs can read. Whoever enters it, signed
 * in or not, gets an admin account with the email and password they give: a new account, or the
 * existing account with that email (its password is replaced). The code then stops working.
 * Reading the server's logs already means full control of the server, so the code is enough proof.
 */
let codeHash: Buffer | null = null;

const hashCode = (code: string) => createHash("sha256").update(code.trim().toUpperCase()).digest();

/** Picks the code out of whatever was pasted: the code alone, or with log text or "\n" around it. */
const CODE_PATTERN = /[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}/;
const extractCode = (input: string) => input.toUpperCase().match(CODE_PATTERN)?.[0] ?? input;

async function adminExists(): Promise<boolean> {
  const count = await prisma.user.count({ where: { role: "institutional_admin", accountDeletedAt: null } });
  return count > 0;
}

/** Called once when the API starts. Returns the code it logged, or null when an admin exists. */
export async function prepareAdminSetup(log: (message: string) => void = console.log): Promise<string | null> {
  if (await adminExists()) {
    codeHash = null;
    return null;
  }
  const raw = randomBytes(8).toString("hex").toUpperCase();
  const code = `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}`;
  codeHash = hashCode(code);
  log(`[admin-setup] No organization admin exists. Open Administration and enter this one-time code: ${code}`);
  return code;
}

export class AdminSetupError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export type AdminSetupClaim = {
  code: string;
  displayName: string;
  email: string;
  password: string;
  organizationName: string;
};

/** Gives the email an admin account in an organization (a new one unless the account already has one). */
export async function claimAdminSetup(claim: AdminSetupClaim): Promise<{ userId: string; organizationId: string; existing: boolean }> {
  if (!codeHash || (await adminExists())) {
    throw new AdminSetupError("Administration is already set up.", 409);
  }
  const given = hashCode(extractCode(claim.code));
  if (given.length !== codeHash.length || !timingSafeEqual(given, codeHash)) {
    throw new AdminSetupError("That code is not right. Check the server log and try again.", 403);
  }

  const existing = await prisma.user.findUnique({
    where: { email: claim.email },
    select: { id: true, organizationId: true, accountDeletedAt: true },
  });
  if (existing?.accountDeletedAt) {
    throw new AdminSetupError("The account with this email was deleted. Use a different email.", 409);
  }

  let organizationId = existing?.organizationId ?? null;
  if (!organizationId) {
    const base = claim.organizationName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "organization";
    const slug = `${base}-${randomBytes(3).toString("hex")}`;
    const organization = await prisma.organization.create({ data: { name: claim.organizationName, slug } });
    organizationId = organization.id;
  }

  const passwordHash = await hashPassword(claim.password);
  const account = { passwordHash, role: "institutional_admin" as const, organizationId, emailVerified: true, passwordChangeRequired: false };
  const user = await prisma.user.upsert({
    where: { email: claim.email },
    create: { email: claim.email, displayName: claim.displayName, ...account },
    update: account,
    select: { id: true },
  });
  codeHash = null;
  return { userId: user.id, organizationId, existing: Boolean(existing) };
}
