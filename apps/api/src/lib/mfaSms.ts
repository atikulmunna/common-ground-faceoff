import { createHash, randomInt } from "node:crypto";
import { getSmsMfaSecret } from "./runtimeSecrets.js";

export const SMS_CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export function generateSmsCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function hashSmsCode(code: string): string {
  return createHash("sha256").update(`${code}:${getSmsMfaSecret()}`).digest("hex");
}

export function normalizePhone(phone: string): string | null {
  const cleaned = phone.trim().replace(/[^\d+]/g, "");
  if (!/^\+?\d{8,15}$/.test(cleaned)) return null;
  return cleaned.startsWith("+") ? cleaned : `+${cleaned}`;
}
