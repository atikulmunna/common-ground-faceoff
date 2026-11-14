import { adminSetupClaimSchema } from "@common-ground/shared";
import { Router } from "express";

import { prisma } from "../lib/prisma.js";
import { createErrorResponse, createSuccessResponse } from "../lib/response.js";
import { AdminSetupError, claimAdminSetup } from "../services/adminSetup.js";

/**
 * POST /admin-setup/claim: the first organization admin, with the code from the API's log.
 * Public: the code stands in for signing in, so it works for someone without an account.
 */
export const adminSetupRouter = Router();

adminSetupRouter.post("/claim", async (req, res) => {
  const parse = adminSetupClaimSchema.safeParse(req.body);
  if (!parse.success) {
    const fields = parse.error.flatten().fieldErrors;
    const message = fields.password?.[0] ?? (fields.email ? "Enter a valid email address." : "Fill in every field.");
    res.status(400).json(createErrorResponse("validation_error", message, parse.error.flatten()));
    return;
  }

  try {
    const { userId, organizationId, existing } = await claimAdminSetup(parse.data);
    await prisma.auditLog.create({
      data: {
        eventType: "admin_setup_claimed",
        actorId: userId,
        actorEmail: parse.data.email,
        ip: req.ip,
        detail: `organization:${organizationId}${existing ? " existing-account" : " new-account"}`,
      },
    });
    res.json(createSuccessResponse({ organizationId }));
  } catch (error) {
    if (error instanceof AdminSetupError) {
      await prisma.auditLog.create({
        data: { eventType: "admin_setup_refused", actorEmail: parse.data.email, ip: req.ip, detail: String(error.status) },
      });
      res.status(error.status).json(createErrorResponse("authz_error", error.message));
      return;
    }
    throw error;
  }
});
