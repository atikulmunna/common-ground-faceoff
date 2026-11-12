import { beforeEach, describe, expect, it, vi } from "vitest";

const callLlm = vi.hoisted(() => vi.fn());

vi.mock("./llmProvider.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./llmProvider.js")>()),
  callLlm,
}));

import { runAnalysisPipelineForQuality } from "./analysisService.js";

const OFFICE = "Office days help new hires learn quickly.";
const REMOTE = "Remote days protect time for focused work.";

const POSITIONS = [
  { participantLabel: "Participant A", positionText: OFFICE },
  { participantLabel: "Participant B", positionText: REMOTE },
];

function stageOutput(stage: number): unknown {
  switch (stage) {
    case 1:
      return { positions: [{ label: "Participant A", normalized: OFFICE }, { label: "Participant B", normalized: REMOTE }] };
    case 2:
      return { steelmans: [{ label: "Participant A", steelman: OFFICE }, { label: "Participant B", steelman: REMOTE }] };
    case 3:
      return { participants: [
        { label: "Participant A", values: [{ name: "growth", description: "New hires should learn quickly." }] },
        { label: "Participant B", values: [{ name: "focus", description: "Deep work needs quiet time." }] },
      ] };
    case 4:
      return { conflicts: [] };
    default:
      return { sharedFoundations: [], trueDisagreements: [], confidenceScores: { sharedFoundations: 0.5, disagreements: 0.5 } };
  }
}

/**
 * Stands in for callLlm, including its retry: each stage's answers are tried in order until
 * `validate` accepts one, as callLlm does with fresh completions.
 */
function answerStages(overrides: Record<number, unknown[]>) {
  const rejected: Array<{ stage: number; error: string }> = [];
  callLlm.mockImplementation(async (_system: string, user: string, validate?: (content: string) => void) => {
    const stage = Number(/# Stage (\d)/.exec(user)?.[1]);
    const answers = overrides[stage] ?? [stageOutput(stage)];
    for (const answer of answers) {
      const content = JSON.stringify(answer);
      try {
        validate?.(content);
        return { content, provider: "openrouter", model: "test-model", promptTokens: 1, completionTokens: 1 };
      } catch (err) {
        rejected.push({ stage, error: err instanceof Error ? err.message : String(err) });
      }
    }
    throw new Error(`Stage ${stage} produced no valid answer`);
  });
  return rejected;
}

describe("participant labels in the pipeline", () => {
  beforeEach(() => {
    callLlm.mockReset();
  });

  it("keeps each restated view with its author when the model returns them in a different order", async () => {
    answerStages({
      1: [{ positions: [{ label: "Participant B", normalized: REMOTE }, { label: "Participant A", normalized: OFFICE }] }],
      2: [{ steelmans: [{ label: "Participant B", steelman: REMOTE }, { label: "Participant A", steelman: OFFICE }] }],
    });

    const output = await runAnalysisPipelineForQuality("How many office days?", POSITIONS);

    expect(output.steelmans).toEqual({ "Participant A": OFFICE, "Participant B": REMOTE });
  });

  it("asks again when the model renames or drops a participant", async () => {
    const rejected = answerStages({
      2: [
        { steelmans: [{ label: "Participant A", steelman: OFFICE }, { label: "Participant C", steelman: REMOTE }] },
        { steelmans: [{ label: "Participant A", steelman: OFFICE }] },
        stageOutput(2),
      ],
    });

    const output = await runAnalysisPipelineForQuality("How many office days?", POSITIONS);

    expect(rejected.map((entry) => entry.stage)).toEqual([2, 2]);
    expect(rejected[0].error).toMatch(/Participant C/);
    expect(output.steelmans).toEqual({ "Participant A": OFFICE, "Participant B": REMOTE });
  });

  it("asks again when the values stage leaves someone out", async () => {
    const rejected = answerStages({
      3: [
        { participants: [{ label: "Participant A", values: [{ name: "growth", description: "Learning." }] }] },
        stageOutput(3),
      ],
    });

    await runAnalysisPipelineForQuality("How many office days?", POSITIONS);

    expect(rejected.map((entry) => entry.stage)).toEqual([3]);
  });
});
