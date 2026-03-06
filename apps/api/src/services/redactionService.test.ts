import { describe, it, expect } from "vitest";
import { redactPII } from "../services/redactionService.js";

describe("PII redaction pipeline (CG-FR59, CG-FR60)", () => {
  it("detects and masks SSN", () => {
    const result = redactPII("My SSN is 123-45-6789 and that is private.");
    expect(result.findings).toBe(1);
    expect(result.redactedText).toContain("[REDACTED:SSN]");
    expect(result.redactedText).not.toContain("123-45-6789");
    expect(result.stages).toHaveLength(4);
  });

  it("detects and masks phone numbers", () => {
    const result = redactPII("Call me at (555) 123-4567 please.");
    expect(result.findings).toBe(1);
    expect(result.redactedText).toContain("[REDACTED:PHONE]");
    expect(result.redactedText).not.toContain("(555) 123-4567");
  });

  it("detects and masks email addresses", () => {
    const result = redactPII("Contact john.doe@example.com for details.");
    expect(result.findings).toBe(1);
    expect(result.redactedText).toContain("[REDACTED:EMAIL]");
    expect(result.redactedText).not.toContain("john.doe@example.com");
  });

  it("returns 4 pipeline stages", () => {
    const result = redactPII("Clean text with no PII");
    expect(result.stages).toHaveLength(4);
    expect(result.stages[0].stage).toBe("detect");
    expect(result.stages[1].stage).toBe("mask");
    expect(result.stages[2].stage).toBe("validate");
    expect(result.stages[3].stage).toBe("uncertainty_check");
  });

  it("does not block clean text", () => {
    const result = redactPII("This is a perfectly normal debate position about economics.");
    expect(result.blocked).toBe(false);
    expect(result.findings).toBe(0);
    expect(result.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it("handles multiple PII types in same text", () => {
    const result = redactPII("SSN: 111-22-3333, phone: 555-444-3333, email: test@test.com");
    expect(result.findings).toBe(3);
    expect(result.redactedText).toContain("[REDACTED:SSN]");
    expect(result.redactedText).toContain("[REDACTED:PHONE]");
    expect(result.redactedText).toContain("[REDACTED:EMAIL]");
  });

  it("validate stage has 0 residual findings after masking", () => {
    const result = redactPII("My SSN is 123-45-6789.");
    const validateStage = result.stages.find((s) => s.stage === "validate");
    expect(validateStage?.findingsCount).toBe(0);
    expect(validateStage?.confidence).toBe(0.99);
  });

  it("uncertainty check uses minimum confidence from detect + validate", () => {
    const result = redactPII("Normal text without PII.");
    const uncertaintyStage = result.stages.find((s) => s.stage === "uncertainty_check");
    expect(uncertaintyStage?.blocked).toBe(false);
    expect(uncertaintyStage?.confidence).toBeGreaterThanOrEqual(0.85);
  });
});
