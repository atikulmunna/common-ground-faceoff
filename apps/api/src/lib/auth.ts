import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { getJwtSecret } from "./runtimeSecrets.js";

const SALT_ROUNDS = 12;
const ACCESS_TOKEN_EXPIRY = "30m"; // CG-FR07: 30-minute session
const REFRESH_TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MFA_TICKET_TTL_MS = 5 * 60 * 1000;

/** Wrong passwords and wrong MFA codes share one counter, so the second factor cannot be guessed freely. */
export const MAX_FAILED_LOGIN_ATTEMPTS = 5;
export const LOGIN_LOCKOUT_DURATION_MS = 15 * 60 * 1000;

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  iat?: number;
  exp?: number;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function signAccessToken(payload: { sub: string; email: string; role: string }): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: ACCESS_TOKEN_EXPIRY });
}

export function verifyAccessToken(token: string): JwtPayload {
  return jwt.verify(token, getJwtSecret()) as JwtPayload;
}

export function hashMfaTicket(ticket: string): string {
  return createHash("sha256").update(ticket).digest("hex");
}

/** One-time proof that the password step passed. The caller stores only `ticketHash`. */
export function generateMfaTicket(): { ticket: string; ticketHash: string; expiresAt: Date } {
  const ticket = randomBytes(32).toString("base64url");
  return {
    ticket,
    ticketHash: hashMfaTicket(ticket),
    expiresAt: new Date(Date.now() + MFA_TICKET_TTL_MS),
  };
}

export function generateRefreshToken(): { token: string; expiresAt: Date } {
  return {
    token: randomUUID(),
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS)
  };
}
