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

import { startAnalysisWorker, type AnalysisWorker } from "./services/analysisWorker.js";
import { processNotificationEmailOutbox } from "./services/emailOutbox.js";

const port = Number(process.env.PORT ?? 4100);
const host = process.env.HOST ?? "0.0.0.0";
const processRole = process.env.API_PROCESS_ROLE ?? "all";
const runsApi = processRole === "all" || processRole === "api";
const runsWorker = processRole === "all" || processRole === "worker";

if (runsApi) {
  const { getOAuthExchangeSecret } = await import("./lib/runtimeSecrets.js");
  getOAuthExchangeSecret();
}

const server = runsApi
  ? app.listen(port, host, () => {
      console.log(`API listening on http://${host}:${port} (role: ${processRole})`);
    })
  : null;

// While no organization admin exists, log a one-time code that makes the first one (see adminSetup.ts).
if (runsApi) {
  const { prepareAdminSetup } = await import("./services/adminSetup.js");
  void prepareAdminSetup().catch((err) => {
    console.error("[admin-setup] Could not check for an admin:", err instanceof Error ? err.message : err);
  });
}

// Analyses queue in Postgres. Run at least one process with API_PROCESS_ROLE "all" or "worker",
// or queued analyses never start.
let emailOutboxTimer: NodeJS.Timeout | null = null;
let analysisWorker: AnalysisWorker | null = null;
if (runsWorker) {
  analysisWorker = startAnalysisWorker();
  emailOutboxTimer = setInterval(() => {
    void processNotificationEmailOutbox(20).catch((err) => {
      console.error("[EmailOutbox] Polling failed:", err instanceof Error ? err.message : err);
    });
  }, 15_000);
  void processNotificationEmailOutbox(20).catch((err) => {
    console.error("[EmailOutbox] Initial flush failed:", err instanceof Error ? err.message : err);
  });
}

// Graceful shutdown. A run cut short by the container's stop timeout is requeued by
// the next worker once its estimated finish has long passed.
async function shutdown(): Promise<void> {
  if (emailOutboxTimer) clearInterval(emailOutboxTimer);
  server?.close();
  await analysisWorker?.stop();
}
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
