import { Router } from "express";
import { changePasswordSchema, updateProfileSchema } from "@common-ground/shared";

import { hashPassword, verifyPassword } from "../lib/auth.js";
import { prisma } from "../lib/prisma.js";
import { createErrorResponse, createSuccessResponse } from "../lib/response.js";

export const profileRouter = Router();

// GET /profile — fetch current user's profile
profileRouter.get("/", async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: {
      id: true,
      email: true,
      displayName: true,
      avatarUrl: true,
      notificationPrefs: true,
      tier: true,
      role: true,
      mfaEnabled: true,
      smsMfaEnabled: true,
      smsPhone: true,
      passwordChangeRequired: true,
      createdAt: true,
    },
  });

  if (!user) {
    res.status(404).json(createErrorResponse("not_found", "User not found"));
    return;
  }

  res.json(createSuccessResponse({ user }));
});

// PATCH /profile — update display name, avatar, or notification prefs
profileRouter.patch("/", async (req, res) => {
  const parse = updateProfileSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json(
      createErrorResponse("validation_error", "Invalid profile payload", parse.error.flatten())
    );
    return;
  }

  const data: Record<string, unknown> = {};
  if (parse.data.displayName !== undefined) data.displayName = parse.data.displayName;
  if (parse.data.avatarUrl !== undefined) data.avatarUrl = parse.data.avatarUrl;
  if (parse.data.notificationPreferences !== undefined)
    data.notificationPrefs = parse.data.notificationPreferences;

  if (Object.keys(data).length === 0) {
    res.status(400).json(createErrorResponse("validation_error", "No fields to update"));
    return;
  }

  const user = await prisma.user.update({
    where: { id: req.user.id },
    data,
    select: {
      id: true,
      email: true,
      displayName: true,
      avatarUrl: true,
      notificationPrefs: true,
      tier: true,
      role: true,
      mfaEnabled: true,
      smsMfaEnabled: true,
      smsPhone: true,
    },
  });

  res.json(createSuccessResponse({ user }));
});

// POST /profile/password: change your own password; clears the temporary-password flag.
profileRouter.post("/password", async (req, res) => {
  const parse = changePasswordSchema.safeParse(req.body);
  if (!parse.success) {
    const message = parse.error.flatten().fieldErrors.newPassword?.[0] ?? "Enter your current password and a new one";
    res.status(400).json(createErrorResponse("validation_error", message, parse.error.flatten()));
    return;
  }

  const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { passwordHash: true } });
  if (!user?.passwordHash || !(await verifyPassword(parse.data.currentPassword, user.passwordHash))) {
    res.status(400).json(createErrorResponse("validation_error", "Your current password is not right."));
    return;
  }
  if (parse.data.newPassword === parse.data.currentPassword) {
    res.status(400).json(createErrorResponse("validation_error", "Choose a password different from the current one."));
    return;
  }

  await prisma.user.update({
    where: { id: req.user.id },
    data: { passwordHash: await hashPassword(parse.data.newPassword), passwordChangeRequired: false },
  });
  await prisma.auditLog.create({ data: { eventType: "password_changed", actorId: req.user.id, ip: req.ip } });
  res.json(createSuccessResponse({ changed: true }));
});
