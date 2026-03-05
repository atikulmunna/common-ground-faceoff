import { Router } from "express";
import { updateProfileSchema } from "@common-ground/shared";

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
    },
  });

  res.json(createSuccessResponse({ user }));
});
