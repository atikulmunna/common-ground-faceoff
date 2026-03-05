import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";

const SALT_ROUNDS = 12;
const JWT_SECRET = process.env.NEXTAUTH_SECRET ?? "dev-secret-change-me";
const ACCESS_TOKEN_EXPIRY = "30m"; // CG-FR07: 30-minute session
const REFRESH_TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

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
  return jwt.sign(payload, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY });
}

export function verifyAccessToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET) as JwtPayload;
}

export function generateRefreshToken(): { token: string; expiresAt: Date } {
  return {
    token: randomUUID(),
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS)
  };
}
