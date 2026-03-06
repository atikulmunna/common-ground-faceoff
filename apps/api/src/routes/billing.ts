import { Router, raw } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";

import { billingCheckoutSchema, billingPortalSchema } from "@common-ground/shared";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { createErrorResponse, createSuccessResponse } from "../lib/response.js";
import { requireAuth } from "../middleware/auth.js";

export const billingRouter = Router();

const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const STRIPE_API = "https://api.stripe.com/v1";

/* ------------------------------------------------------------------ */
/*  Stripe API helpers                                                 */
/* ------------------------------------------------------------------ */

async function stripeRequest(
  method: string,
  path: string,
  body?: Record<string, string>
): Promise<Record<string, unknown>> {
  if (!STRIPE_SECRET) throw new Error("Stripe not configured");

  const headers: Record<string, string> = {
    Authorization: `Bearer ${STRIPE_SECRET}`,
    "Content-Type": "application/x-www-form-urlencoded",
  };

  const response = await fetch(`${STRIPE_API}${path}`, {
    method,
    headers,
    body: body ? new URLSearchParams(body).toString() : undefined,
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error((err as { error?: { message?: string } }).error?.message ?? "Stripe API error");
  }

  return response.json() as Promise<Record<string, unknown>>;
}

async function getOrCreateStripeCustomer(userId: string, email: string): Promise<string> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.stripeCustomerId) return user.stripeCustomerId;

  const customer = await stripeRequest("POST", "/customers", {
    email,
    metadata: JSON.stringify({ userId }),
  });

  const customerId = customer.id as string;
  await prisma.user.update({
    where: { id: userId },
    data: { stripeCustomerId: customerId },
  });

  return customerId;
}

/* ------------------------------------------------------------------ */
/*  POST /billing/checkout — Create Stripe Checkout Session            */
/* ------------------------------------------------------------------ */

billingRouter.post("/checkout", requireAuth, async (req, res) => {
  const parse = billingCheckoutSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json(createErrorResponse("validation_error", "Invalid checkout payload", parse.error.flatten()));
    return;
  }

  if (!STRIPE_SECRET) {
    res.status(503).json(createErrorResponse("internal_error", "Billing not configured"));
    return;
  }

  const customerId = await getOrCreateStripeCustomer(req.user.id, req.user.email);

  const session = await stripeRequest("POST", "/checkout/sessions", {
    customer: customerId,
    "line_items[0][price]": parse.data.priceId,
    "line_items[0][quantity]": "1",
    mode: "subscription",
    success_url: parse.data.successUrl,
    cancel_url: parse.data.cancelUrl,
    "metadata[userId]": req.user.id,
  });

  res.json(createSuccessResponse({ checkoutUrl: session.url }));
});

/* ------------------------------------------------------------------ */
/*  POST /billing/portal — Create Stripe Customer Portal Session       */
/* ------------------------------------------------------------------ */

billingRouter.post("/portal", requireAuth, async (req, res) => {
  const parse = billingPortalSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json(createErrorResponse("validation_error", "Invalid portal payload", parse.error.flatten()));
    return;
  }

  if (!STRIPE_SECRET) {
    res.status(503).json(createErrorResponse("internal_error", "Billing not configured"));
    return;
  }

  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user.id } });
  if (!user.stripeCustomerId) {
    res.status(404).json(createErrorResponse("not_found", "No billing account found"));
    return;
  }

  const portalSession = await stripeRequest("POST", "/billing_portal/sessions", {
    customer: user.stripeCustomerId,
    return_url: parse.data.returnUrl,
  });

  res.json(createSuccessResponse({ portalUrl: portalSession.url }));
});

/* ------------------------------------------------------------------ */
/*  GET /billing/subscription — Get current subscription status        */
/* ------------------------------------------------------------------ */

billingRouter.get("/subscription", requireAuth, async (req, res) => {
  const subscription = await prisma.subscription.findUnique({
    where: { userId: req.user.id },
  });

  if (!subscription) {
    res.json(createSuccessResponse({ subscription: null, tier: "free" }));
    return;
  }

  res.json(createSuccessResponse({ subscription, tier: subscription.status === "active" ? "pro" : "free" }));
});

/* ------------------------------------------------------------------ */
/*  POST /billing/webhook — Stripe webhook handler (CG-FR67)           */
/*  Unauthenticated — uses Stripe signature verification               */
/* ------------------------------------------------------------------ */

billingRouter.post("/webhook", raw({ type: "application/json" }), async (req, res) => {
  if (!STRIPE_WEBHOOK_SECRET) {
    res.status(503).json(createErrorResponse("internal_error", "Webhook not configured"));
    return;
  }

  // CG-FR67: Verify webhook signature
  const signature = req.headers["stripe-signature"] as string | undefined;
  if (!signature) {
    res.status(400).json(createErrorResponse("auth_error", "Missing signature"));
    return;
  }

  const payload = typeof req.body === "string" ? req.body : req.body.toString("utf8");

  if (!verifyStripeSignature(payload, signature, STRIPE_WEBHOOK_SECRET)) {
    res.status(400).json(createErrorResponse("auth_error", "Invalid signature"));
    return;
  }

  const event = JSON.parse(payload) as {
    id: string;
    type: string;
    data: { object: Record<string, unknown> };
  };

  // CG-FR67: Idempotency — skip processed events
  const existing = await prisma.webhookEvent.findUnique({
    where: { provider_eventId: { provider: "stripe", eventId: event.id } },
  });
  if (existing?.processed) {
    res.json({ received: true });
    return;
  }

  await prisma.webhookEvent.upsert({
    where: { provider_eventId: { provider: "stripe", eventId: event.id } },
    update: {},
    create: {
      provider: "stripe",
      eventId: event.id,
      eventType: event.type,
      payload: event.data.object as Prisma.InputJsonValue,
    },
  });

  try {
    await handleStripeEvent(event);
    await prisma.webhookEvent.update({
      where: { provider_eventId: { provider: "stripe", eventId: event.id } },
      data: { processed: true },
    });
  } catch (err) {
    console.error("[Billing] Webhook processing error:", err);
  }

  res.json({ received: true });
});

/* ------------------------------------------------------------------ */
/*  Stripe event handlers                                              */
/* ------------------------------------------------------------------ */

async function handleStripeEvent(event: {
  type: string;
  data: { object: Record<string, unknown> };
}): Promise<void> {
  const obj = event.data.object;

  switch (event.type) {
    case "checkout.session.completed": {
      const customerId = obj.customer as string;
      const subscriptionId = obj.subscription as string;
      if (!customerId || !subscriptionId) break;

      // Fetch the subscription details from the event
      const user = await prisma.user.findFirst({ where: { stripeCustomerId: customerId } });
      if (!user) break;

      await prisma.subscription.upsert({
        where: { userId: user.id },
        update: {
          stripeSubscriptionId: subscriptionId,
          status: "active",
        },
        create: {
          userId: user.id,
          stripeCustomerId: customerId,
          stripeSubscriptionId: subscriptionId,
          stripePriceId: (obj.line_items as string) ?? "",
          status: "active",
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      });

      // Upgrade user tier
      await prisma.user.update({
        where: { id: user.id },
        data: { tier: "pro" },
      });
      break;
    }

    case "customer.subscription.updated": {
      const subscriptionId = obj.id as string;
      const status = obj.status as string;
      const cancelAtPeriodEnd = obj.cancel_at_period_end as boolean;
      const currentPeriodEnd = obj.current_period_end as number;

      const sub = await prisma.subscription.findUnique({
        where: { stripeSubscriptionId: subscriptionId },
      });
      if (!sub) break;

      await prisma.subscription.update({
        where: { stripeSubscriptionId: subscriptionId },
        data: {
          status,
          cancelAtPeriodEnd: cancelAtPeriodEnd ?? false,
          currentPeriodEnd: currentPeriodEnd
            ? new Date(currentPeriodEnd * 1000)
            : sub.currentPeriodEnd,
        },
      });

      // Downgrade if subscription canceled/expired
      if (status === "canceled" || status === "unpaid") {
        await prisma.user.update({
          where: { id: sub.userId },
          data: { tier: "free" },
        });
      }
      break;
    }

    case "customer.subscription.deleted": {
      const subscriptionId = obj.id as string;
      const sub = await prisma.subscription.findUnique({
        where: { stripeSubscriptionId: subscriptionId },
      });
      if (!sub) break;

      await prisma.subscription.update({
        where: { stripeSubscriptionId: subscriptionId },
        data: { status: "canceled" },
      });

      await prisma.user.update({
        where: { id: sub.userId },
        data: { tier: "free" },
      });
      break;
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Signature verification (CG-FR67)                                   */
/* ------------------------------------------------------------------ */

export function verifyStripeSignature(
  payload: string,
  header: string,
  secret: string
): boolean {
  const parts = header.split(",");
  const tPart = parts.find((p) => p.startsWith("t="));
  const v1Part = parts.find((p) => p.startsWith("v1="));

  if (!tPart || !v1Part) return false;

  const timestamp = tPart.slice(2);
  const expectedSig = v1Part.slice(3);

  // Replay protection: reject events older than 5 minutes
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (age > 300) return false;

  const signedPayload = `${timestamp}.${payload}`;
  const hmac = createHmac("sha256", secret).update(signedPayload).digest("hex");

  try {
    return timingSafeEqual(Buffer.from(hmac, "hex"), Buffer.from(expectedSig, "hex"));
  } catch {
    return false;
  }
}
