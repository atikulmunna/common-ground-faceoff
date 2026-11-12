import { describe, it, expect } from "vitest";
import {
  computePromptTemplateHash,
  estimateCompletionSeconds,
  PROMPT_TEMPLATE_HASH,
} from "../services/analysisService.js";

describe("estimateCompletionSeconds (CG-FR57)", () => {
  it("returns 60s for short (sync) positions ≤ 4000 chars", () => {
    expect(estimateCompletionSeconds(100)).toBe(60);
    expect(estimateCompletionSeconds(4000)).toBe(60);
  });

  it("returns >60s for async positions > 4000 chars", () => {
    expect(estimateCompletionSeconds(5000)).toBeGreaterThan(60);
  });

  it("uses linear formula: 30 + ceil(totalChars / 100)", () => {
    // 10000 chars → 30 + 100 = 130
    expect(estimateCompletionSeconds(10000)).toBe(130);
  });

  it("caps at 600 seconds", () => {
    // 100000 chars → 30 + 1000 = 1030 → capped at 600
    expect(estimateCompletionSeconds(100000)).toBe(600);
  });

  it("handles boundary at 4001 chars", () => {
    // 4001 → async → 30 + ceil(4001/100) = 30 + 41 = 71
    expect(estimateCompletionSeconds(4001)).toBe(71);
  });
});

describe("prompt template version (CG-NFR40)", () => {
  it("records a hash of the prompts as sent, matching the hash stored next to the version", () => {
    // If this fails, a prompt changed. Bump PROMPT_TEMPLATE_VERSION in analysisService.ts and set
    // PROMPT_TEMPLATE_HASH there to the new value, so results record which prompts produced them.
    expect(computePromptTemplateHash()).toBe(PROMPT_TEMPLATE_HASH);
  });

  it("is a short hex digest that does not depend on how the code was compiled", () => {
    expect(PROMPT_TEMPLATE_HASH).toMatch(/^[0-9a-f]{16}$/);
  });
});
