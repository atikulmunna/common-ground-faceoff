import { claimNextQueuedAnalysis, requeueStaleAnalyses, runClaimedAnalysis } from "./analysisService.js";

/** How long an idle loop waits before looking for queued analyses again. */
const IDLE_POLL_MS = 2_000;

export interface AnalysisWorker {
  /** Stops looking for work and resolves once in-flight analyses have finished. */
  stop(): Promise<void>;
}

let wakeWorker: (() => void) | null = null;

/** Tells the worker in this process (if any) to look for queued analyses now instead of at its next poll. */
export function wakeAnalysisWorker(): void {
  wakeWorker?.();
}

/**
 * Processes queued analyses, with Postgres as the queue. Each loop recovers abandoned runs, claims the
 * next queued conversation with a conditional update (so several loops or processes never take the
 * same one), runs it, and otherwise sleeps until the next poll or a wake-up.
 */
export function startAnalysisWorker(options: { concurrency?: number; idlePollMs?: number } = {}): AnalysisWorker {
  const concurrency = options.concurrency ?? 2;
  const idlePollMs = options.idlePollMs ?? IDLE_POLL_MS;
  const sleepers = new Set<() => void>();
  let stopped = false;

  const sleep = () =>
    new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        sleepers.delete(done);
        resolve();
      };
      const timer = setTimeout(done, idlePollMs);
      sleepers.add(done);
    });

  const wake = () => {
    for (const done of [...sleepers]) done();
  };
  wakeWorker = wake;

  async function loop(): Promise<void> {
    while (!stopped) {
      try {
        await requeueStaleAnalyses();
        const sessionId = await claimNextQueuedAnalysis();
        if (sessionId) {
          await runClaimedAnalysis(sessionId);
          continue;
        }
      } catch (err) {
        console.error("[AnalysisWorker] Polling failed:", err instanceof Error ? err.message : err);
      }
      if (!stopped) await sleep();
    }
  }

  const loops = Array.from({ length: concurrency }, () => loop());

  return {
    async stop() {
      stopped = true;
      wake();
      await Promise.all(loops);
      if (wakeWorker === wake) wakeWorker = null;
    },
  };
}
