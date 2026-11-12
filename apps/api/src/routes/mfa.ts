import { Router } from "express";
import * as OTPAuth from "otpauth";
import QRCode from "qrcode";
import { mfaSetupVerifySchema, mfaLoginVerifySchema, smsMfaSetupSchema, smsMfaCodeSchema } from "@common-ground/shared";

import { prisma } from "../lib/prisma.js";
import { createErrorResponse, createSuccessResponse } from "../lib/response.js";
import {
  signAccessToken,
  generateRefreshToken,
  hashToken,
  LOGIN_LOCKOUT_DURATION_MS,
  MAX_FAILED_LOGIN_ATTEMPTS,
} from "../lib/auth.js";
import { generateSmsCode, hashSmsCode, normalizePhone, SMS_CODE_TTL_MS } from "../lib/mfaSms.js";
import { sendSms } from "../services/smsService.js";
import { featureEnabled } from "@common-ground/config";

export const mfaRouter = Router();
export const publicMfaRouter = Router();

mfaRouter.use("/sms", (_req, res, next) => {
  if (!featureEnabled(process.env.ENABLE_SMS_MFA)) {
    res.status(404).json(createErrorResponse("not_found", "SMS MFA is not enabled"));
    return;
  }
  next();
});

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
/*  POST /mfa/verify-login: second login step (unauthenticated)        */
/* ------------------------------------------------------------------ */

const MFA_TICKET_EXPIRED = "Your sign-in attempt has expired. Please sign in again.";

/** Counts a wrong code toward the shared login lockout. Returns true when the account is now locked. */
async function recordFailedMfaCode(user: { id: string; email: string }, ip: string | undefined): Promise<boolean> {
  const { failedLoginCount } = await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginCount: { increment: 1 } },
    select: { failedLoginCount: true },
  });

  const locked = failedLoginCount >= MAX_FAILED_LOGIN_ATTEMPTS;
  if (locked) {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        lockedUntil: new Date(Date.now() + LOGIN_LOCKOUT_DURATION_MS),
        mfaTicketHash: null,
        mfaTicketExpiresAt: null,
      },
    });
  }

  await prisma.auditLog.create({
    data: {
      eventType: "mfa_login_failed",
      actorId: user.id,
      actorEmail: user.email,
      ip,
      detail: `failed_attempt_${failedLoginCount}`,
    },
  });

  return locked;
}

publicMfaRouter.post("/verify-login", async (req, res) => {
  const parse = mfaLoginVerifySchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json(createErrorResponse("validation_error", "Invalid payload", parse.error.flatten()));
    return;
  }

  const ticketHash = hashToken(parse.data.mfaTicket);
  const user = await prisma.user.findUnique({ where: { mfaTicketHash: ticketHash } });
  if (!user || !user.mfaTicketExpiresAt || user.mfaTicketExpiresAt < new Date()) {
    res.status(401).json(createErrorResponse("auth_error", MFA_TICKET_EXPIRED));
    return;
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    res.status(423).json(createErrorResponse("auth_error", "Account temporarily locked. Try again later."));
    return;
  }

  let codeValid: boolean;
  if (parse.data.mfaType === "sms") {
    if (!featureEnabled(process.env.ENABLE_SMS_MFA)) {
      res.status(404).json(createErrorResponse("not_found", "SMS MFA is not enabled"));
      return;
    }
    if (!user.smsMfaEnabled || !user.smsCodeHash || !user.smsCodeExpiresAt || user.smsCodePurpose !== "login") {
      res.status(401).json(createErrorResponse("auth_error", "Invalid SMS MFA request"));
      return;
    }
    if (new Date(user.smsCodeExpiresAt) < new Date()) {
      res.status(401).json(createErrorResponse("auth_error", "SMS code expired. Please sign in again."));
      return;
    }
    codeValid = hashSmsCode(parse.data.token) === user.smsCodeHash;
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
    codeValid = totp.validate({ token: parse.data.token, window: 1 }) !== null;
  }

  if (!codeValid) {
    if (await recordFailedMfaCode(user, req.ip)) {
      const minutes = Math.round(LOGIN_LOCKOUT_DURATION_MS / 60_000);
      res.status(423).json(createErrorResponse("auth_error", `Too many incorrect codes. Try again in ${minutes} minutes.`));
      return;
    }
    res.status(401).json(createErrorResponse("auth_error", "Incorrect verification code"));
    return;
  }

  // Consume the ticket atomically, so one ticket and code can sign in only once.
  const consumed = await prisma.user.updateMany({
    where: { id: user.id, mfaTicketHash: ticketHash },
    data: {
      mfaTicketHash: null,
      mfaTicketExpiresAt: null,
      failedLoginCount: 0,
      lockedUntil: null,
      lastLoginAt: new Date(),
      ...(parse.data.mfaType === "sms"
        ? { smsCodeHash: null, smsCodeExpiresAt: null, smsCodePurpose: null }
        : {}),
    },
  });
  if (consumed.count !== 1) {
    res.status(401).json(createErrorResponse("auth_error", MFA_TICKET_EXPIRED));
    return;
  }

  const accessToken = signAccessToken({ sub: user.id, email: user.email, role: user.role });
  const refresh = generateRefreshToken();

  await prisma.refreshToken.create({
    data: { tokenHash: hashToken(refresh.token), userId: user.id, expiresAt: refresh.expiresAt },
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
