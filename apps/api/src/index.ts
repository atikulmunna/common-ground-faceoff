import "dotenv/config";

// --- Datadog APM (must init before other imports) ---
if (process.env.DD_API_KEY) {
  const { default: tracer } = await import("dd-trace");
  tracer.init({
    service: "common-ground-api",
    env: process.env.NODE_ENV ?? "development",
    logInjection: true,
    runtimeMetrics: true,
    profiling: process.env.NODE_ENV === "production",
  });
}

import * as Sentry from "@sentry/node";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { parseEnv } from "@common-ground/config";

import { requireAuth } from "./middleware/auth.js";
import { authRouter } from "./routes/auth.js";
import { sessionsRouter } from "./routes/sessions.js";
import { shareLinksRouter } from "./routes/shareLinks.js";
import { profileRouter } from "./routes/profile.js";
import { mfaRouter } from "./routes/mfa.js";
import { moderationRouter } from "./routes/moderation.js";
import { samlRouter } from "./routes/saml.js";
import { adminRouter } from "./routes/admin.js";
import { billingRouter } from "./routes/billing.js";
import { privacyRouter } from "./routes/privacy.js";
import { createErrorResponse } from "./lib/response.js";
import { processNotificationEmailOutbox } from "./services/emailOutbox.js";

// --- Sentry initialization (CG-NFR12: error tracking) ---
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV ?? "development",
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.2 : 1.0,
  });
}

const app = express();
parseEnv(process.env);

// --- Security headers (CG-NFR09, CG-NFR12) ---
app.use(helmet({
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
}));

const allowedOrigins = process.env.CORS_ORIGIN?.split(",") ?? ["http://localhost:3000"];
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json({ limit: "256kb" }));

// CG-NFR15: rate limiting — 100 requests/minute per IP
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, data: null, error: { code: "rate_limited", message: "Too many requests" } }
});
app.use(apiLimiter);

app.get("/health", (_req, res) => {
  res.json({ success: true, data: { status: "ok" }, error: null });
});

// Auth routes are public (no JWT required)
app.use("/auth", authRouter);
// MFA verify-login is public; setup/disable need auth (handled below)
app.post("/mfa/verify-login", mfaRouter);
// SAML SSO routes are public (CG-FR03)
app.use("/saml", samlRouter);
// Shared link public read-only view (CG-FR38)
app.get("/share-links/view/:token", shareLinksRouter);
// Stripe webhook (public, uses signature verification — CG-FR67)
app.post("/billing/webhook", billingRouter);
// CG-NFR33: Public subprocessor inventory
app.get("/privacy/subprocessors", privacyRouter);

// All routes below require a valid JWT
app.use(requireAuth);
app.use("/sessions", sessionsRouter);
app.use("/share-links", shareLinksRouter);
app.use("/profile", profileRouter);
app.use("/mfa", mfaRouter);
app.use("/moderation", moderationRouter);
app.use("/admin", adminRouter);
app.use("/billing", billingRouter);
app.use("/privacy", privacyRouter);

// Sentry error handler (must be after routes, before custom error handler)
Sentry.setupExpressErrorHandler(app);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json(createErrorResponse("internal_error", "Internal server error"));
});

import { shutdownQueue } from "./services/queueService.js";

const port = Number(process.env.PORT ?? 4100);
const server = app.listen(port, "127.0.0.1", () => {
  console.log(`API listening on http://localhost:${port}`);
});

const emailOutboxTimer = setInterval(() => {
  void processNotificationEmailOutbox(20).catch((err) => {
    console.error("[EmailOutbox] Polling failed:", err instanceof Error ? err.message : err);
  });
}, 15_000);
void processNotificationEmailOutbox(20).catch((err) => {
  console.error("[EmailOutbox] Initial flush failed:", err instanceof Error ? err.message : err);
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  clearInterval(emailOutboxTimer);
  await shutdownQueue();
  server.close();
});
process.on("SIGINT", async () => {
  clearInterval(emailOutboxTimer);
  await shutdownQueue();
  server.close();
});
