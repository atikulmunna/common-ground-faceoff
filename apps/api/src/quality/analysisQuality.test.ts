import { describe, expect, it } from "vitest";

import type { AnalysisPipelineOutput } from "../services/analysisService.js";
import { evaluateAnalysisQuality, groupMatches } from "./analysisQuality.js";
import { analysisQualityCases } from "./analysisQualityCases.js";

const goodOutput: AnalysisPipelineOutput = {
  steelmans: {
    "Participant A": "A supports flexible remote work while preserving collaboration and retention.",
    "Participant B": "B supports three office days for team collaboration while retaining flexibility.",
  },
  conflictMap: { policy: ["They disagree about the frequency of office attendance."] },
  sharedFoundations: "Both value flexibility, retention, team cohesion, and collaboration.",
  trueDisagreements: "They differ on frequency: remote-first versus three days in the office.",
  sharedFoundationPoints: [],
  disagreementPoints: [],
  participantValues: {},
  verification: { sharedProposed: 1, sharedVerified: 1, differencesProposed: 1, differencesVerified: 1 },
  confidenceScores: { sharedFoundations: 0.9, disagreements: 0.88 },
  llmProvider: "test",
  modelVersion: "fixture",
  promptTemplateHash: "abc123",
};

describe("analysis quality benchmark", () => {
  it("contains a diverse, uniquely identified 30-case suite", () => {
    expect(analysisQualityCases).toHaveLength(30);
    expect(new Set(analysisQualityCases.map((fixture) => fixture.id)).size).toBe(30);
    expect(new Set(analysisQualityCases.map((fixture) => fixture.category)).size).toBeGreaterThanOrEqual(10);
    expect(analysisQualityCases.some((fixture) => fixture.positions.length === 3)).toBe(true);
    expect(analysisQualityCases.some((fixture) => fixture.sensitiveTokens?.length)).toBe(true);
    expect(analysisQualityCases.some((fixture) => fixture.injectionTokens?.length)).toBe(true);
    for (const fixture of analysisQualityCases) {
      expect(fixture.positions.length).toBeGreaterThanOrEqual(2);
      expect(fixture.expected.sharedGround.length).toBeGreaterThan(0);
      expect(fixture.expected.disagreements.length).toBeGreaterThan(0);
      expect(fixture.expected.conflictCategories.length).toBeGreaterThan(0);
    }
  });

  it("passes a structurally sound, balanced anchored result", () => {
    const result = evaluateAnalysisQuality(analysisQualityCases[0], goodOutput);
    expect(result.passed).toBe(true);
    expect(result.score).toBe(100);
  });

  it("hard-fails missing participants and leaked adversarial markers", () => {
    const fixture = analysisQualityCases.find((item) => item.id === "prompt-injection-ignore")!;
    const result = evaluateAnalysisQuality(fixture, {
      ...goodOutput,
      steelmans: { "Participant A": "BENCHMARK_OVERRIDE_ONLY" },
    });
    expect(result.passed).toBe(false);
    expect(result.hardFailures).toContain("missing participant steelman");
    expect(result.hardFailures).toContain("prompt-injection marker leaked into output");
  });
});

describe("anchor matching", () => {
  it("accepts other forms of an anchor word", () => {
    expect(groupMatches(["emergency"], "Both value phone access for emergencies.")).toBe(true);
    expect(groupMatches(["stored"], "Whether students should store their phones.")).toBe(true);
    expect(groupMatches(["families"], "Every family needs contact.")).toBe(true);
  });

  it("still accepts everything plain substrings accepted", () => {
    expect(groupMatches(["fair"], "Both value fairness.")).toBe(true);
  });

  it("keeps a multi-word anchor's words together", () => {
    expect(groupMatches(["keep phones"], "Students keep their phones on silent.")).toBe(false);
    expect(groupMatches(["keep phones"], "Students keep phones on silent.")).toBe(true);
  });

  it("does not match unrelated words", () => {
    expect(groupMatches(["stored"], "The library stays open late.")).toBe(false);
  });
});
