import { describe, it, expect } from "vitest";
import { estimateCompletionSeconds } from "../services/analysisService.js";

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
