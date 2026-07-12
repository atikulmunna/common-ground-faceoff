import "dotenv/config";
import { featureEnabled } from "@common-ground/config";

// --- Datadog APM (must init before other imports) ---
if (featureEnabled(process.env.ENABLE_DATADOG) && process.env.DD_API_KEY) {
  const { default: tracer } = await import("dd-trace");
  tracer.init({
    service: "common-ground-api",
    env: process.env.NODE_ENV ?? "development",
    logInjection: true,
    runtimeMetrics: true,
    profiling: process.env.NODE_ENV === "production",
  });
}

const { createApp } = await import("./app.js");
const app = createApp();

import { shutdownQueue, startAnalysisWorker } from "./services/queueService.js";
import { processNotificationEmailOutbox } from "./services/emailOutbox.js";

const port = Number(process.env.PORT ?? 4100);
const host = process.env.HOST ?? "0.0.0.0";
const processRole = process.env.API_PROCESS_ROLE ?? "all";
const runsApi = processRole === "all" || processRole === "api";
const runsWorker = processRole === "all" || processRole === "worker";

const server = runsApi
  ? app.listen(port, host, () => {
      console.log(`API listening on http://${host}:${port} (role: ${processRole})`);
    })
  : null;

let emailOutboxTimer: NodeJS.Timeout | null = null;
if (runsWorker) {
  startAnalysisWorker({ requireRedis: processRole === "worker" });
  emailOutboxTimer = setInterval(() => {
    void processNotificationEmailOutbox(20).catch((err) => {
      console.error("[EmailOutbox] Polling failed:", err instanceof Error ? err.message : err);
    });
  }, 15_000);
  void processNotificationEmailOutbox(20).catch((err) => {
    console.error("[EmailOutbox] Initial flush failed:", err instanceof Error ? err.message : err);
  });
}

// Graceful shutdown
process.on("SIGTERM", async () => {
  if (emailOutboxTimer) clearInterval(emailOutboxTimer);
  await shutdownQueue();
  server?.close();
});
process.on("SIGINT", async () => {
  if (emailOutboxTimer) clearInterval(emailOutboxTimer);
  await shutdownQueue();
  server?.close();
});
