import "dotenv/config";
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { parseEnv } from "@common-ground/config";

import { requireAuth } from "./middleware/auth.js";
import { authRouter } from "./routes/auth.js";
import { sessionsRouter } from "./routes/sessions.js";
import { shareLinksRouter } from "./routes/shareLinks.js";
import { createErrorResponse } from "./lib/response.js";

const app = express();
parseEnv(process.env);

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

// All routes below require a valid JWT
app.use(requireAuth);
app.use("/sessions", sessionsRouter);
app.use("/share-links", shareLinksRouter);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json(createErrorResponse("internal_error", "Internal server error"));
});

const port = Number(process.env.PORT ?? 4100);
app.listen(port, "127.0.0.1", () => {
  console.log(`API listening on http://localhost:${port}`);
});
