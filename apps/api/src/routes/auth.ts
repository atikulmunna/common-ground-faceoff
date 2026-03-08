import { Router } from "express";
import { randomBytes } from "node:crypto";
import { registerSchema, loginSchema, refreshTokenSchema, oauthExchangeSchema } from "@common-ground/shared";

import { prisma } from "../lib/prisma.js";
import { createErrorResponse, createSuccessResponse } from "../lib/response.js";
import { sendEmailVerification } from "../services/emailService.js";
import { sendSms } from "../services/smsService.js";
import { generateSmsCode, hashSmsCode, SMS_CODE_TTL_MS } from "../lib/mfaSms.js";
import {
  hashPassword,
  verifyPassword,
  signAccessToken,
  generateRefreshToken
} from "../lib/auth.js";

export const authRouter = Router();

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes
const EMAIL_VERIFY_TTL_MS = 24 * 60 * 60 * 1000; // 24h

// POST /auth/register
authRouter.post("/register", async (req, res) => {
  const parse = registerSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json(
      createErrorResponse("validation_error", "Invalid registration payload", parse.error.flatten())
    );
    return;
  }

  const existing = await prisma.user.findUnique({ where: { email: parse.data.email } });
  if (existing) {
    res.status(409).json(createErrorResponse("auth_error", "User already exists, please sign in"));
    return;
  }

  const passwordHash = await hashPassword(parse.data.password);

  const user = await prisma.user.create({
    data: {
      email: parse.data.email,
      displayName: parse.data.displayName,
      passwordHash,
      emailVerified: false,
      role: "individual_user"
    }
  });

  const verifyToken = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + EMAIL_VERIFY_TTL_MS);

  await prisma.emailVerificationToken.create({
    data: {
      token: verifyToken,
      userId: user.id,
      expiresAt,
    }
  });

  const apiBase = process.env.API_BASE_URL ?? "http://localhost:4100";
  const verifyUrl = `${apiBase}/auth/verify-email?token=${encodeURIComponent(verifyToken)}`;
  void sendEmailVerification({
    recipientEmail: user.email,
    displayName: user.displayName,
    verifyUrl,
  });

  // CG-NFR14: Log registration event
  await prisma.auditLog.create({
    data: {
      eventType: "register",
      actorId: user.id,
      actorEmail: user.email,
      ip: req.ip,
    },
  });

  res.status(201).json(
    createSuccessResponse({
      message: "Registration successful. Please verify your email before signing in.",
      requiresEmailVerification: true,
    })
  );
});

// POST /auth/login
authRouter.post("/login", async (req, res) => {
  const parse = loginSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json(
      createErrorResponse("validation_error", "Invalid login payload", parse.error.flatten())
    );
    return;
  }

  const user = await prisma.user.findUnique({ where: { email: parse.data.email } });
  if (!user || !user.passwordHash) {
    res.status(401).json(createErrorResponse("auth_error", "Invalid email or password"));
    return;
  }
  if (!user.emailVerified) {
    res.status(403).json(createErrorResponse("auth_error", "Please verify your email before signing in"));
    return;
  }

  // Check account lockout
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    res.status(423).json(createErrorResponse("auth_error", "Account temporarily locked. Try again later."));
    return;
  }

  const valid = await verifyPassword(parse.data.password, user.passwordHash);
  if (!valid) {
    const newCount = user.failedLoginCount + 1;
    const lockout = newCount >= MAX_FAILED_ATTEMPTS
      ? new Date(Date.now() + LOCKOUT_DURATION_MS)
      : null;

    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: newCount,
        lockedUntil: lockout
      }
    });

    // Log failed auth event (CG-NFR14)
    await prisma.auditLog.create({
      data: {
        eventType: "login_failed",
        actorId: user.id,
        actorEmail: user.email,
        ip: req.ip,
        detail: `failed_attempt_${newCount}`
      }
    });

    res.status(401).json(createErrorResponse("auth_error", "Invalid email or password"));
    return;
  }

  // Reset failed attempts on success
  await prisma.user.update({
    where: { id: user.id },
    data: {
      failedLoginCount: 0,
      lockedUntil: null,
      lastLoginAt: new Date()
    }
  });

  // CG-FR06: If SMS MFA is enabled, send OTP and require verification.
  if (user.smsMfaEnabled) {
    if (!user.smsPhone) {
      res.status(500).json(createErrorResponse("auth_error", "SMS MFA is enabled but phone is not configured"));
      return;
    }

    const code = generateSmsCode();
    const smsSent = await sendSms({
      to: user.smsPhone,
      body: `Your Common Ground verification code is ${code}. It expires in 10 minutes.`,
    });
    if (!smsSent) {
      res.status(503).json(createErrorResponse("provider_error", "Could not send SMS verification code"));
      return;
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        smsCodeHash: hashSmsCode(code),
        smsCodeExpiresAt: new Date(Date.now() + SMS_CODE_TTL_MS),
        smsCodePurpose: "login",
      },
    });

    await prisma.auditLog.create({
      data: {
        eventType: "mfa_challenge_issued",
        actorId: user.id,
        actorEmail: user.email,
        ip: req.ip,
        detail: "type:sms",
      },
    });

    res.json(
      createSuccessResponse({
        mfaRequired: true,
        mfaType: "sms",
        tempTicket: user.id,
        email: user.email,
      })
    );
    return;
  }

  // CG-FR06: If TOTP MFA is enabled, require second factor before issuing tokens
  if (user.mfaEnabled) {
    await prisma.auditLog.create({
      data: {
        eventType: "mfa_challenge_issued",
        actorId: user.id,
        actorEmail: user.email,
        ip: req.ip,
        detail: "type:totp",
      },
    });

    res.json(
      createSuccessResponse({
        mfaRequired: true,
        mfaType: "totp",
        tempTicket: user.id,
        email: user.email,
      })
    );
    return;
  }

  const accessToken = signAccessToken({ sub: user.id, email: user.email, role: user.role });
  const refresh = generateRefreshToken();

  await prisma.refreshToken.create({
    data: {
      token: refresh.token,
      userId: user.id,
      expiresAt: refresh.expiresAt
    }
  });

  // CG-NFR14: Log successful login event
  await prisma.auditLog.create({
    data: {
      eventType: "login_success",
      actorId: user.id,
      actorEmail: user.email,
      ip: req.ip,
    },
  });

  res.json(
    createSuccessResponse({
      user: { id: user.id, email: user.email, displayName: user.displayName, role: user.role },
      accessToken,
      refreshToken: refresh.token
    })
  );
});

// POST /auth/refresh
authRouter.post("/refresh", async (req, res) => {
  const parse = refreshTokenSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json(
      createErrorResponse("validation_error", "Invalid refresh payload", parse.error.flatten())
    );
    return;
  }

  const stored = await prisma.refreshToken.findUnique({
    where: { token: parse.data.refreshToken },
    include: { user: true }
  });

  if (!stored || stored.expiresAt < new Date()) {
    if (stored) {
      await prisma.refreshToken.delete({ where: { id: stored.id } });
    }
    res.status(401).json(createErrorResponse("auth_error", "Invalid or expired refresh token"));
    return;
  }

  // Rotate refresh token
  await prisma.refreshToken.delete({ where: { id: stored.id } });

  const accessToken = signAccessToken({
    sub: stored.user.id,
    email: stored.user.email,
    role: stored.user.role
  });
  const newRefresh = generateRefreshToken();

  // CG-NFR14: Log token refresh event
  await prisma.auditLog.create({
    data: {
      eventType: "token_refresh",
      actorId: stored.user.id,
      actorEmail: stored.user.email,
      ip: req.ip,
    },
  });

  await prisma.refreshToken.create({
    data: {
      token: newRefresh.token,
      userId: stored.user.id,
      expiresAt: newRefresh.expiresAt
    }
  });

  res.json(
    createSuccessResponse({
      accessToken,
      refreshToken: newRefresh.token
    })
  );
});

// POST /auth/oauth-exchange — exchange OAuth profile for API tokens
authRouter.post("/oauth-exchange", async (req, res) => {
  const parse = oauthExchangeSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json(
      createErrorResponse("validation_error", "Invalid OAuth payload", parse.error.flatten())
    );
    return;
  }

  const { email, displayName, provider } = parse.data;

  // Upsert user: create without password if new, or return existing user
  let user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    user = await prisma.user.create({
      data: {
        email,
        displayName,
        // No passwordHash for OAuth-only users
        role: "individual_user"
      }
    });
  }

  // Update lastLoginAt
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() }
  });

  const accessToken = signAccessToken({ sub: user.id, email: user.email, role: user.role });
  const refresh = generateRefreshToken();

  await prisma.refreshToken.create({
    data: {
      token: refresh.token,
      userId: user.id,
      expiresAt: refresh.expiresAt
    }
  });

  // Audit log
  await prisma.auditLog.create({
    data: {
      eventType: "oauth_login",
      actorId: user.id,
      actorEmail: user.email,
      ip: req.ip,
      detail: `provider:${provider}`
    }
  });

  res.json(
    createSuccessResponse({
      user: { id: user.id, email: user.email, displayName: user.displayName, role: user.role },
      accessToken,
      refreshToken: refresh.token
    })
  );
});

// POST /auth/logout
authRouter.post("/logout", async (req, res) => {
  const parse = refreshTokenSchema.safeParse(req.body);
  if (!parse.success) {
    res.json(createSuccessResponse({ message: "Logged out" }));
    return;
  }

  const storedToken = await prisma.refreshToken.findUnique({
    where: { token: parse.data.refreshToken },
    select: { userId: true, user: { select: { email: true } } },
  });

  await prisma.refreshToken.deleteMany({
    where: { token: parse.data.refreshToken }
  });

  // CG-NFR14: Log logout event
  if (storedToken) {
    await prisma.auditLog.create({
      data: {
        eventType: "logout",
        actorId: storedToken.userId,
        actorEmail: storedToken.user.email,
        ip: req.ip,
      },
    });
  }

  res.json(createSuccessResponse({ message: "Logged out" }));
});

async function verifyEmailToken(token: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const record = await prisma.emailVerificationToken.findUnique({
    where: { token },
    include: { user: true },
  });
  if (!record) return { ok: false, message: "Invalid verification token" };
  if (record.expiresAt < new Date()) {
    await prisma.emailVerificationToken.delete({ where: { id: record.id } }).catch(() => {});
    return { ok: false, message: "Verification token expired" };
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: { emailVerified: true },
    }),
    prisma.emailVerificationToken.deleteMany({
      where: { userId: record.userId },
    }),
    prisma.auditLog.create({
      data: {
        eventType: "email_verified",
        actorId: record.userId,
        actorEmail: record.user.email,
      },
    }),
  ]);

  return { ok: true };
}

// POST /auth/verify-email
authRouter.post("/verify-email", async (req, res) => {
  const token = typeof req.body?.token === "string" ? req.body.token : "";
  if (!token) {
    res.status(400).json(createErrorResponse("validation_error", "Missing verification token"));
    return;
  }

  const result = await verifyEmailToken(token);
  if (!result.ok) {
    res.status(400).json(createErrorResponse("auth_error", result.message));
    return;
  }

  res.json(createSuccessResponse({ verified: true }));
});

// GET /auth/verify-email?token=...
authRouter.get("/verify-email", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  if (!token) {
    res.status(400).json(createErrorResponse("validation_error", "Missing verification token"));
    return;
  }

  const result = await verifyEmailToken(token);
  const webBase = process.env.WEB_BASE_URL ?? process.env.NEXTAUTH_URL ?? "http://localhost:3000";

  if (!result.ok) {
    res.redirect(`${webBase}/sign-in?verified=0&reason=${encodeURIComponent(result.message)}`);
    return;
  }

  res.redirect(`${webBase}/sign-in?verified=1`);
});
