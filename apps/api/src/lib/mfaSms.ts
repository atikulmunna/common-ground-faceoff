import { createHash, randomInt } from "node:crypto";

export const SMS_CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export function generateSmsCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function hashSmsCode(code: string): string {
  const secret = process.env.SMS_MFA_SECRET ?? process.env.NEXTAUTH_SECRET ?? "dev-secret-change-me";
  return createHash("sha256").update(`${code}:${secret}`).digest("hex");
}

export function normalizePhone(phone: string): string | null {
  const cleaned = phone.trim().replace(/[^\d+]/g, "");
  if (!/^\+?\d{8,15}$/.test(cleaned)) return null;
  return cleaned.startsWith("+") ? cleaned : `+${cleaned}`;
}
