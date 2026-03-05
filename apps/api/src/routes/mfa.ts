import { Router } from "express";
import * as OTPAuth from "otpauth";
import QRCode from "qrcode";
import { mfaSetupVerifySchema, mfaLoginVerifySchema } from "@common-ground/shared";

import { prisma } from "../lib/prisma.js";
import { createErrorResponse, createSuccessResponse } from "../lib/response.js";
import { signAccessToken, generateRefreshToken } from "../lib/auth.js";

export const mfaRouter = Router();

/* ------------------------------------------------------------------ */
/*  POST /mfa/setup — generate TOTP secret & QR (authenticated)        */
/* ------------------------------------------------------------------ */

mfaRouter.post("/setup", async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user) {
    res.status(404).json(createErrorResponse("not_found", "User not found"));
    return;
  }

  const secret = new OTPAuth.Secret({ size: 20 });
  const totp = new OTPAuth.TOTP({
    issuer: "CommonGround",
    label: user.email,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret,
  });

  // Store secret temporarily (user must verify before it's "enabled")
  await prisma.user.update({
    where: { id: user.id },
    data: { mfaSecret: secret.base32, mfaEnabled: false },
  });

  const otpauthUri = totp.toString();
  const qrDataUrl = await QRCode.toDataURL(otpauthUri);

  res.json(createSuccessResponse({
    secret: secret.base32,
    otpauthUri,
    qrCode: qrDataUrl,
  }));
});

/* ------------------------------------------------------------------ */
/*  POST /mfa/verify-setup — confirm TOTP works, enable MFA            */
/* ------------------------------------------------------------------ */

mfaRouter.post("/verify-setup", async (req, res) => {
  const parse = mfaSetupVerifySchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json(createErrorResponse("validation_error", "Invalid payload", parse.error.flatten()));
    return;
  }

  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user || !user.mfaSecret) {
    res.status(400).json(createErrorResponse("auth_error", "MFA setup not initiated"));
    return;
  }

  const totp = new OTPAuth.TOTP({
    issuer: "CommonGround",
    label: user.email,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(user.mfaSecret),
  });

  const delta = totp.validate({ token: parse.data.token, window: 1 });
  if (delta === null) {
    res.status(401).json(createErrorResponse("auth_error", "Invalid TOTP code"));
    return;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { mfaEnabled: true },
  });

  await prisma.auditLog.create({
    data: {
      eventType: "mfa_enabled",
      actorId: user.id,
      actorEmail: user.email,
      ip: req.ip,
    },
  });

  res.json(createSuccessResponse({ mfaEnabled: true }));
});

/* ------------------------------------------------------------------ */
/*  POST /mfa/disable — turn off MFA (authenticated)                   */
/* ------------------------------------------------------------------ */

mfaRouter.post("/disable", async (req, res) => {
  const parse = mfaSetupVerifySchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json(createErrorResponse("validation_error", "Invalid payload", parse.error.flatten()));
    return;
  }

  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user || !user.mfaSecret || !user.mfaEnabled) {
    res.status(400).json(createErrorResponse("auth_error", "MFA is not enabled"));
    return;
  }

  const totp = new OTPAuth.TOTP({
    issuer: "CommonGround",
    label: user.email,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(user.mfaSecret),
  });

  const delta = totp.validate({ token: parse.data.token, window: 1 });
  if (delta === null) {
    res.status(401).json(createErrorResponse("auth_error", "Invalid TOTP code"));
    return;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { mfaEnabled: false, mfaSecret: null },
  });

  await prisma.auditLog.create({
    data: {
      eventType: "mfa_disabled",
      actorId: user.id,
      actorEmail: user.email,
      ip: req.ip,
    },
  });

  res.json(createSuccessResponse({ mfaEnabled: false }));
});

/* ------------------------------------------------------------------ */
/*  POST /mfa/verify-login — verify TOTP during login (unauthenticated)*/
/* ------------------------------------------------------------------ */

mfaRouter.post("/verify-login", async (req, res) => {
  const parse = mfaLoginVerifySchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json(createErrorResponse("validation_error", "Invalid payload", parse.error.flatten()));
    return;
  }

  const user = await prisma.user.findUnique({ where: { email: parse.data.email } });
  if (!user || !user.mfaEnabled || !user.mfaSecret) {
    res.status(401).json(createErrorResponse("auth_error", "Invalid MFA request"));
    return;
  }

  // Verify the temp ticket matches user id (simple approach)
  if (parse.data.tempTicket !== user.id) {
    res.status(401).json(createErrorResponse("auth_error", "Invalid MFA ticket"));
    return;
  }

  const totp = new OTPAuth.TOTP({
    issuer: "CommonGround",
    label: user.email,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(user.mfaSecret),
  });

  const delta = totp.validate({ token: parse.data.token, window: 1 });
  if (delta === null) {
    res.status(401).json(createErrorResponse("auth_error", "Invalid TOTP code"));
    return;
  }

  // Issue tokens
  const accessToken = signAccessToken({ sub: user.id, email: user.email, role: user.role });
  const refresh = generateRefreshToken();

  await prisma.refreshToken.create({
    data: { token: refresh.token, userId: user.id, expiresAt: refresh.expiresAt },
  });

  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
  });

  await prisma.auditLog.create({
    data: {
      eventType: "mfa_login_success",
      actorId: user.id,
      actorEmail: user.email,
      ip: req.ip,
    },
  });

  res.json(createSuccessResponse({
    user: { id: user.id, email: user.email, displayName: user.displayName, role: user.role },
    accessToken,
    refreshToken: refresh.token,
  }));
});
