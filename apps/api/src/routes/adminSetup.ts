import { adminSetupClaimSchema } from "@common-ground/shared";
import { Router } from "express";

import { prisma } from "../lib/prisma.js";
import { createErrorResponse, createSuccessResponse } from "../lib/response.js";
import { AdminSetupError, claimAdminSetup } from "../services/adminSetup.js";

/** POST /admin-setup/claim: the first organization admin, with the code from the API's log. */
export const adminSetupRouter = Router();

adminSetupRouter.post("/claim", async (req, res) => {
  const parse = adminSetupClaimSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json(createErrorResponse("validation_error", "Enter the setup code", parse.error.flatten()));
    return;
  }

  try {
    const { organizationId } = await claimAdminSetup(req.user.id, parse.data.code, parse.data.organizationName);
    await prisma.auditLog.create({
      data: { eventType: "admin_setup_claimed", actorId: req.user.id, ip: req.ip, detail: `organization:${organizationId}` },
    });
    res.json(createSuccessResponse({ organizationId }));
  } catch (error) {
    if (error instanceof AdminSetupError) {
      await prisma.auditLog.create({
        data: { eventType: "admin_setup_refused", actorId: req.user.id, ip: req.ip, detail: String(error.status) },
      });
      res.status(error.status).json(createErrorResponse("authz_error", error.message));
      return;
    }
    throw error;
  }
});
