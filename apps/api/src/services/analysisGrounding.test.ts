import { describe, expect, it } from "vitest";

import { groundSynthesisResult } from "./analysisService.js";

describe("analysis synthesis grounding", () => {
  const steelmans = {
    "Participant A": "Support a pilot and publish monthly reliability data before expanding it.",
    "Participant B": "Run a six-month pilot, publish reliability data, and expand only after improvement.",
  };

  it("keeps shared foundations supported by exact evidence from every participant", () => {
    const result = groundSynthesisResult({
      sharedFoundations: [{
        statement: "Both support a measured pilot.",
        evidence: [
          { label: "Participant A", quote: "Support a pilot" },
          { label: "Participant B", quote: "Run a six-month pilot" },
        ],
      }],
      trueDisagreements: [],
      confidenceScores: { sharedFoundations: 0.9, disagreements: 0.8 },
    }, steelmans);

    expect(result.sharedFoundations).toBe("Both support a measured pilot.");
  });

  it("keeps each verified point with one supported quote per participant", () => {
    const result = groundSynthesisResult({
      sharedFoundations: [{
        statement: "  Both support a measured pilot. ",
        evidence: [
          { label: "Participant A", quote: "Support a pilot " },
          { label: "Participant A", quote: "publish monthly reliability data" },
          { label: "Participant B", quote: "a made-up quote about budgets" },
          { label: "Participant B", quote: "Run a six-month pilot" },
        ],
      }],
      trueDisagreements: [{
        statement: "They differ on when to expand.",
        evidence: [
          { label: "Participant A", quote: "before expanding it" },
          { label: "Participant B", quote: "expand only after improvement" },
          { label: "Participant C", quote: "nobody called Participant C took part" },
        ],
      }],
      confidenceScores: { sharedFoundations: 0.9, disagreements: 0.8 },
    }, steelmans);

    expect(result.sharedFoundationPoints).toEqual([{
      statement: "Both support a measured pilot.",
      evidence: [
        { label: "Participant A", quote: "Support a pilot" },
        { label: "Participant B", quote: "Run a six-month pilot" },
      ],
    }]);
    expect(result.disagreementPoints).toEqual([{
      statement: "They differ on when to expand.",
      evidence: [
        { label: "Participant A", quote: "before expanding it" },
        { label: "Participant B", quote: "expand only after improvement" },
      ],
    }]);
    // The joined text is still saved for exports and older views.
    expect(result.sharedFoundations).toBe("Both support a measured pilot.");
  });

  it("keeps no points when nothing is supported", () => {
    const result = groundSynthesisResult({
      sharedFoundations: [],
      trueDisagreements: [],
      confidenceScores: { sharedFoundations: 0.9, disagreements: 0.8 },
    }, steelmans);

    expect(result.sharedFoundationPoints).toEqual([]);
    expect(result.disagreementPoints).toEqual([]);
  });

  it("rejects shared claims based on silence or fabricated evidence", () => {
    const result = groundSynthesisResult({
      sharedFoundations: [{
        statement: "Both support a permanent rollout.",
        evidence: [
          { label: "Participant A", quote: "Support a pilot" },
          { label: "Participant B", quote: "supports a permanent rollout" },
        ],
      }],
      trueDisagreements: [],
      confidenceScores: { sharedFoundations: 0.9, disagreements: 0.8 },
    }, steelmans);

    expect(result.sharedFoundations).toBe("No explicit shared foundation was identified.");
  });

  it("requires grounded evidence from at least two participants for a disagreement", () => {
    const result = groundSynthesisResult({
      sharedFoundations: [],
      trueDisagreements: [{
        statement: "They disagree on rollout timing.",
        evidence: [{ label: "Participant B", quote: "expand only after improvement" }],
      }],
      confidenceScores: { sharedFoundations: 0.9, disagreements: 0.8 },
    }, steelmans);

    expect(result.trueDisagreements).toBe("No explicit disagreement was identified.");
  });

  it("does not turn one participant's silence into disagreement", () => {
    const result = groundSynthesisResult({
      sharedFoundations: [],
      trueDisagreements: [{
        statement: "Participant A supports a pilot while Participant B does not mention a pilot.",
        evidence: [
          { label: "Participant A", quote: "Support a pilot" },
          { label: "Participant B", quote: "publish reliability data" },
        ],
      }],
      confidenceScores: { sharedFoundations: 0.9, disagreements: 0.8 },
    }, steelmans);

    expect(result.trueDisagreements).toBe("No explicit disagreement was identified.");
  });
});
