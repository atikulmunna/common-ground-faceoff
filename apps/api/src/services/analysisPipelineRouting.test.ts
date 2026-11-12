import { describe, expect, it, vi } from "vitest";

const callLlm = vi.hoisted(() => vi.fn());

vi.mock("./llmProvider.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./llmProvider.js")>()),
  callLlm,
}));

import { runAnalysisPipelineForQuality } from "./analysisService.js";

const STAGE_OUTPUT: Array<[marker: string, model: string, content: unknown]> = [
  ["# Stage 1", "openai/model-a", {
    positions: [
      { label: "Participant A", normalized: "Office days help new hires learn quickly." },
      { label: "Participant B", normalized: "Remote days protect time for focused work." },
    ],
  }],
  ["# Stage 2", "openai/model-a", {
    steelmans: [
      { label: "Participant A", steelman: "Office days help new hires learn quickly." },
      { label: "Participant B", steelman: "Remote days protect time for focused work." },
    ],
  }],
  ["# Stage 3", "openai/model-a", {
    participants: [
      { label: "Participant A", values: [{ name: "growth", description: "New hires should learn quickly." }] },
      { label: "Participant B", values: [{ name: "focus", description: "Deep work needs quiet time." }] },
    ],
  }],
  ["# Stage 4", "google/model-b", { conflicts: [] }],
  ["# Stage 5", "google/model-b", {
    sharedFoundations: [],
    trueDisagreements: [],
    confidenceScores: { sharedFoundations: 0.5, disagreements: 0.5 },
  }],
];

describe("analysis pipeline routing", () => {
  it("routes every stage of a run under one session and records each model that answered", async () => {
    callLlm.mockImplementation(async (_system: string, user: string, validate?: (content: string) => void) => {
      const stage = STAGE_OUTPUT.find(([marker]) => user.includes(marker));
      if (!stage) throw new Error("Unexpected prompt");
      const content = JSON.stringify(stage[2]);
      validate?.(content);
      return { content, provider: "openrouter", model: stage[1], promptTokens: 1, completionTokens: 1 };
    });

    const output = await runAnalysisPipelineForQuality("How many office days should we keep?", [
      { participantLabel: "Participant A", positionText: "Office days help new hires learn quickly." },
      { participantLabel: "Participant B", positionText: "Remote days protect time for focused work." },
    ]);

    expect(output.llmProvider).toBe("openrouter");
    expect(output.modelVersion).toBe("openai/model-a, google/model-b");

    const sessionIds = callLlm.mock.calls.map((call) => (call[3] as { sessionId?: string } | undefined)?.sessionId);
    expect(sessionIds).toHaveLength(5);
    expect(new Set(sessionIds).size).toBe(1);
    expect(sessionIds[0]).toEqual(expect.any(String));
  });
});
