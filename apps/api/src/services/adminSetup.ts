import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { prisma } from "../lib/prisma.js";

/**
 * First organization admin. Nothing in the app can make someone an admin, so while no admin
 * exists the API makes a one-time code at startup and writes it to its own log (CloudWatch on the
 * server), which only people with access to the server's logs can read. A signed-in person who
 * enters it becomes the admin of a new organization; the code then stops working.
 */
let codeHash: Buffer | null = null;

const hashCode = (code: string) => createHash("sha256").update(code.trim().toUpperCase()).digest();

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
  log(`[admin-setup] No organization admin exists. Sign in, open Administration, and enter this one-time code: ${code}`);
  return code;
}

export class AdminSetupError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** Makes the user the admin of an organization (a new one unless they already belong to one). */
export async function claimAdminSetup(userId: string, code: string, organizationName: string): Promise<{ organizationId: string }> {
  if (!codeHash || (await adminExists())) {
    throw new AdminSetupError("Administration is already set up.", 409);
  }
  const given = hashCode(code);
  if (given.length !== codeHash.length || !timingSafeEqual(given, codeHash)) {
    throw new AdminSetupError("That code is not right. Check the server log and try again.", 403);
  }

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { organizationId: true } });
  let organizationId = user?.organizationId ?? null;
  if (!organizationId) {
    const base = organizationName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "organization";
    const slug = `${base}-${randomBytes(3).toString("hex")}`;
    const organization = await prisma.organization.create({ data: { name: organizationName, slug } });
    organizationId = organization.id;
  }
  await prisma.user.update({ where: { id: userId }, data: { role: "institutional_admin", organizationId } });
  codeHash = null;
  return { organizationId };
}
