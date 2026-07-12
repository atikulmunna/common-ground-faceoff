import { Router } from "express";

import { prisma } from "../lib/prisma.js";
import { createErrorResponse, createSuccessResponse } from "../lib/response.js";
import { requireSessionAccess } from "../middleware/rbac.js";

const SESSION_TIMEOUT_MS = 30 * 60 * 1000;

export const sessionHeartbeatRouter = Router();

sessionHeartbeatRouter.post("/:id/heartbeat", requireSessionAccess, async (req, res) => {
  const session = await prisma.session.findUnique({ where: { id: req.params.id } });
  if (!session) {
    res.status(404).json(createErrorResponse("not_found", "Session not found"));
    return;
  }

  if (session.lastActivityAt) {
    const elapsed = Date.now() - session.lastActivityAt.getTime();
    if (elapsed >= SESSION_TIMEOUT_MS && session.status === "collecting_positions") {
      await prisma.session.update({
        where: { id: req.params.id },
        data: { status: "needs_input" },
      });
      res.json(createSuccessResponse({
        status: "expired",
        message: "Session expired due to inactivity",
      }));
      return;
    }
  }

  const lastActivityAt = new Date();
  await prisma.session.update({
    where: { id: req.params.id },
    data: { lastActivityAt },
  });

  res.json(createSuccessResponse({
    status: "active",
    lastActivityAt: lastActivityAt.toISOString(),
  }));
});
