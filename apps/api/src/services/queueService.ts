import { completeQueuedAnalysis } from "./analysisService.js";

type QueueJob = {
  sessionId: string;
  pipelineRunId: string;
};

const queue: QueueJob[] = [];
let processing = false;

export function enqueueAnalysis(job: QueueJob): void {
  queue.push(job);
  if (!processing) {
    void processQueue();
  }
}

async function processQueue(): Promise<void> {
  processing = true;
  while (queue.length > 0) {
    const job = queue.shift();
    if (!job) continue;
    await new Promise((resolve) => setTimeout(resolve, 500));
    await completeQueuedAnalysis(job.sessionId, job.pipelineRunId);
  }
  processing = false;
}
