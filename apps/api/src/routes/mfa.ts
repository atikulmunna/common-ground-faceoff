import { Router } from "express";
import * as OTPAuth from "otpauth";
import QRCode from "qrcode";
import { mfaSetupVerifySchema, mfaLoginVerifySchema, smsMfaSetupSchema, smsMfaCodeSchema } from "@common-ground/shared";

import { prisma } from "../lib/prisma.js";
import { createErrorResponse, createSuccessResponse } from "../lib/response.js";
import { signAccessToken, generateRefreshToken } from "../lib/auth.js";
import { generateSmsCode, hashSmsCode, normalizePhone, SMS_CODE_TTL_MS } from "../lib/mfaSms.js";
import { sendSms } from "../services/smsService.js";

export const mfaRouter = Router();

async function sendSmsChallenge(userId: string, phone: string, purpose: "setup" | "login" | "disable"): Promise<boolean> {
  const code = generateSmsCode();
  const sent = await sendSms({
    to: phone,
    body: `Your Common Ground verification code is ${code}. It expires in 10 minutes.`,
  });
  if (!sent) return false;

  await prisma.user.update({
    where: { id: userId },
    data: {
      smsCodeHash: hashSmsCode(code),
      smsCodeExpiresAt: new Date(Date.now() + SMS_CODE_TTL_MS),
      smsCodePurpose: purpose,
    },
  });

  return true;
}

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
  if (!user) {
    res.status(401).json(createErrorResponse("auth_error", "Invalid MFA request"));
    return;
  }

  // Verify the temp ticket matches user id (simple approach)
  if (parse.data.tempTicket !== user.id) {
    res.status(401).json(createErrorResponse("auth_error", "Invalid MFA ticket"));
    return;
  }

  if (parse.data.mfaType === "sms") {
    if (!user.smsMfaEnabled || !user.smsCodeHash || !user.smsCodeExpiresAt || user.smsCodePurpose !== "login") {
      res.status(401).json(createErrorResponse("auth_error", "Invalid SMS MFA request"));
      return;
    }
    if (new Date(user.smsCodeExpiresAt) < new Date()) {
      res.status(401).json(createErrorResponse("auth_error", "SMS code expired"));
      return;
    }
    if (hashSmsCode(parse.data.token) !== user.smsCodeHash) {
      res.status(401).json(createErrorResponse("auth_error", "Invalid SMS code"));
      return;
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { smsCodeHash: null, smsCodeExpiresAt: null, smsCodePurpose: null },
    });
  } else {
    if (!user.mfaEnabled || !user.mfaSecret) {
      res.status(401).json(createErrorResponse("auth_error", "Invalid MFA request"));
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
      detail: `type:${parse.data.mfaType}`,
    },
  });

  res.json(createSuccessResponse({
    user: { id: user.id, email: user.email, displayName: user.displayName, role: user.role },
    accessToken,
    refreshToken: refresh.token,
  }));
});

/* ------------------------------------------------------------------ */
/*  SMS MFA setup / disable (CG-FR06)                                  */
/* ------------------------------------------------------------------ */

mfaRouter.post("/sms/setup", async (req, res) => {
  const parse = smsMfaSetupSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json(createErrorResponse("validation_error", "Invalid payload", parse.error.flatten()));
    return;
  }

  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user) {
    res.status(404).json(createErrorResponse("not_found", "User not found"));
    return;
  }

  const normalized = normalizePhone(parse.data.phone);
  if (!normalized) {
    res.status(400).json(createErrorResponse("validation_error", "Invalid phone number"));
    return;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { smsPhone: normalized, smsMfaEnabled: false },
  });

  const sent = await sendSmsChallenge(user.id, normalized, "setup");
  if (!sent) {
    res.status(503).json(createErrorResponse("provider_error", "Could not send SMS verification code"));
    return;
  }

  await prisma.auditLog.create({
    data: {
      eventType: "sms_mfa_setup_code_sent",
      actorId: user.id,
      actorEmail: user.email,
      ip: req.ip,
    },
  });

  res.json(createSuccessResponse({ sent: true }));
});

mfaRouter.post("/sms/verify-setup", async (req, res) => {
  const parse = smsMfaCodeSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json(createErrorResponse("validation_error", "Invalid payload", parse.error.flatten()));
    return;
  }

  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user || !user.smsPhone || !user.smsCodeHash || !user.smsCodeExpiresAt || user.smsCodePurpose !== "setup") {
    res.status(400).json(createErrorResponse("auth_error", "SMS MFA setup not initiated"));
    return;
  }
  if (new Date(user.smsCodeExpiresAt) < new Date()) {
    res.status(401).json(createErrorResponse("auth_error", "SMS code expired"));
    return;
  }
  if (hashSmsCode(parse.data.code) !== user.smsCodeHash) {
    res.status(401).json(createErrorResponse("auth_error", "Invalid SMS code"));
    return;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      smsMfaEnabled: true,
      smsCodeHash: null,
      smsCodeExpiresAt: null,
      smsCodePurpose: null,
    },
  });

  await prisma.auditLog.create({
    data: {
      eventType: "sms_mfa_enabled",
      actorId: user.id,
      actorEmail: user.email,
      ip: req.ip,
    },
  });

  res.json(createSuccessResponse({ smsMfaEnabled: true }));
});

mfaRouter.post("/sms/send-disable-code", async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user || !user.smsMfaEnabled || !user.smsPhone) {
    res.status(400).json(createErrorResponse("auth_error", "SMS MFA is not enabled"));
    return;
  }

  const sent = await sendSmsChallenge(user.id, user.smsPhone, "disable");
  if (!sent) {
    res.status(503).json(createErrorResponse("provider_error", "Could not send SMS verification code"));
    return;
  }

  res.json(createSuccessResponse({ sent: true }));
});

mfaRouter.post("/sms/disable", async (req, res) => {
  const parse = smsMfaCodeSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json(createErrorResponse("validation_error", "Invalid payload", parse.error.flatten()));
    return;
  }

  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user || !user.smsMfaEnabled || !user.smsCodeHash || !user.smsCodeExpiresAt || user.smsCodePurpose !== "disable") {
    res.status(400).json(createErrorResponse("auth_error", "Disable flow not initiated"));
    return;
  }
  if (new Date(user.smsCodeExpiresAt) < new Date()) {
    res.status(401).json(createErrorResponse("auth_error", "SMS code expired"));
    return;
  }
  if (hashSmsCode(parse.data.code) !== user.smsCodeHash) {
    res.status(401).json(createErrorResponse("auth_error", "Invalid SMS code"));
    return;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      smsMfaEnabled: false,
      smsCodeHash: null,
      smsCodeExpiresAt: null,
      smsCodePurpose: null,
    },
  });

  await prisma.auditLog.create({
    data: {
      eventType: "sms_mfa_disabled",
      actorId: user.id,
      actorEmail: user.email,
      ip: req.ip,
    },
  });

  res.json(createSuccessResponse({ smsMfaEnabled: false }));
});
