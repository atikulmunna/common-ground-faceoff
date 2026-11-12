import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const steps = vi.hoisted(() => ({
  claimNextQueuedAnalysis: vi.fn(),
  requeueStaleAnalyses: vi.fn(),
  runClaimedAnalysis: vi.fn(),
}));

vi.mock("./analysisService.js", () => steps);

import { startAnalysisWorker, wakeAnalysisWorker } from "./analysisWorker.js";

describe("analysis worker loop", () => {
  let worker: { stop(): Promise<void> } | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    steps.claimNextQueuedAnalysis.mockReset().mockResolvedValue(null);
    steps.requeueStaleAnalyses.mockReset().mockResolvedValue(0);
    steps.runClaimedAnalysis.mockReset().mockResolvedValue(undefined);
  });

  afterEach(async () => {
    const stopping = worker?.stop();
    await vi.runAllTimersAsync();
    await stopping;
    worker = null;
    vi.useRealTimers();
  });

  it("runs queued analyses one after another, then waits", async () => {
    steps.claimNextQueuedAnalysis
      .mockResolvedValueOnce("session-1")
      .mockResolvedValueOnce("session-2")
      .mockResolvedValue(null);

    worker = startAnalysisWorker({ concurrency: 1, idlePollMs: 2_000 });
    await vi.advanceTimersByTimeAsync(0);

    expect(steps.runClaimedAnalysis.mock.calls.map(([id]) => id)).toEqual(["session-1", "session-2"]);
    const claimsWhileIdle = steps.claimNextQueuedAnalysis.mock.calls.length;

    await vi.advanceTimersByTimeAsync(1_999);
    expect(steps.claimNextQueuedAnalysis.mock.calls.length).toBe(claimsWhileIdle);
    await vi.advanceTimersByTimeAsync(1);
    expect(steps.claimNextQueuedAnalysis.mock.calls.length).toBe(claimsWhileIdle + 1);
  });

  it("looks for work immediately when woken", async () => {
    worker = startAnalysisWorker({ concurrency: 1, idlePollMs: 60_000 });
    await vi.advanceTimersByTimeAsync(0);
    const before = steps.claimNextQueuedAnalysis.mock.calls.length;

    steps.claimNextQueuedAnalysis.mockResolvedValueOnce("session-1");
    wakeAnalysisWorker();
    await vi.advanceTimersByTimeAsync(0);

    expect(steps.claimNextQueuedAnalysis.mock.calls.length).toBeGreaterThan(before);
    expect(steps.runClaimedAnalysis).toHaveBeenCalledWith("session-1");
  });

  it("recovers abandoned runs before claiming work", async () => {
    worker = startAnalysisWorker({ concurrency: 1 });
    await vi.advanceTimersByTimeAsync(0);

    expect(steps.requeueStaleAnalyses).toHaveBeenCalled();
    expect(steps.requeueStaleAnalyses.mock.invocationCallOrder[0])
      .toBeLessThan(steps.claimNextQueuedAnalysis.mock.invocationCallOrder[0]);
  });

  it("keeps going after an unexpected error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    steps.claimNextQueuedAnalysis
      .mockRejectedValueOnce(new Error("database restarting"))
      .mockResolvedValueOnce("session-1")
      .mockResolvedValue(null);

    worker = startAnalysisWorker({ concurrency: 1, idlePollMs: 2_000 });
    await vi.advanceTimersByTimeAsync(2_000);

    expect(steps.runClaimedAnalysis).toHaveBeenCalledWith("session-1");
  });

  it("stops polling once stopped", async () => {
    worker = startAnalysisWorker({ concurrency: 2, idlePollMs: 2_000 });
    await vi.advanceTimersByTimeAsync(0);

    const stopping = worker.stop();
    await vi.runAllTimersAsync();
    await stopping;
    worker = null;
    const calls = steps.claimNextQueuedAnalysis.mock.calls.length;

    await vi.advanceTimersByTimeAsync(10_000);
    expect(steps.claimNextQueuedAnalysis.mock.calls.length).toBe(calls);
  });
});
