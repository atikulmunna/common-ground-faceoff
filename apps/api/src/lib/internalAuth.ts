import { timingSafeEqual } from "node:crypto";

import { getOAuthExchangeSecret } from "./runtimeSecrets.js";

export const OAUTH_EXCHANGE_SECRET_HEADER = "x-common-ground-internal-secret";

export function verifyOAuthExchangeSecret(provided: string | undefined): boolean {
  if (!provided) return false;

  const expectedBuffer = Buffer.from(getOAuthExchangeSecret(), "utf8");
  const providedBuffer = Buffer.from(provided, "utf8");
  if (providedBuffer.length !== expectedBuffer.length) return false;

  return timingSafeEqual(providedBuffer, expectedBuffer);
}
