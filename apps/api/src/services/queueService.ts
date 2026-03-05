import { Queue, Worker } from "bullmq";
import { completeQueuedAnalysis } from "./analysisService.js";

type QueueJob = {
  sessionId: string;
  pipelineRunId: string;
};

const REDIS_URL = process.env.REDIS_URL;

/* ------------------------------------------------------------------ */
/*  Redis-backed queue via BullMQ (used when REDIS_URL is set)         */
/* ------------------------------------------------------------------ */

let analysisQueue: Queue<QueueJob> | null = null;
let analysisWorker: Worker<QueueJob> | null = null;

function getRedisConnection() {
  if (!REDIS_URL) return null;
  // Parse redis://host:port or rediss://host:port
  const url = new URL(REDIS_URL);
  return {
    host: url.hostname,
    port: Number(url.port) || 6379,
    password: url.password || undefined,
    tls: url.protocol === "rediss:" ? {} : undefined,
  };
}

function ensureRedisQueue(): Queue<QueueJob> | null {
  if (analysisQueue) return analysisQueue;
  const connection = getRedisConnection();
  if (!connection) return null;

  analysisQueue = new Queue<QueueJob>("analysis", { connection });

  analysisWorker = new Worker<QueueJob>(
    "analysis",
    async (job) => {
      await completeQueuedAnalysis(job.data.sessionId, job.data.pipelineRunId);
    },
    {
      connection,
      concurrency: 2,
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
    }
  );

  analysisWorker.on("failed", (job, err) => {
    console.error(`[Queue] Job ${job?.id} failed:`, err.message);
  });

  return analysisQueue;
}

/* ------------------------------------------------------------------ */
/*  In-memory fallback (used when Redis is not configured)             */
/* ------------------------------------------------------------------ */

const memoryQueue: QueueJob[] = [];
let processing = false;

async function processMemoryQueue(): Promise<void> {
  processing = true;
  while (memoryQueue.length > 0) {
    const job = memoryQueue.shift();
    if (!job) continue;
    await new Promise((resolve) => setTimeout(resolve, 500));
    await completeQueuedAnalysis(job.sessionId, job.pipelineRunId);
  }
  processing = false;
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

export function enqueueAnalysis(job: QueueJob): void {
  const queue = ensureRedisQueue();
  if (queue) {
    void queue.add("analyze", job, {
      attempts: 3,
      backoff: { type: "exponential", delay: 2000 },
    });
  } else {
    // Fallback to in-memory queue
    memoryQueue.push(job);
    if (!processing) {
      void processMemoryQueue();
    }
  }
}

export async function shutdownQueue(): Promise<void> {
  if (analysisWorker) {
    await analysisWorker.close();
    analysisWorker = null;
  }
  if (analysisQueue) {
    await analysisQueue.close();
    analysisQueue = null;
  }
}
