import { describe, it, expect } from "vitest";
import { redactPII } from "../services/redactionService.js";

describe("PII redaction (CG-FR59)", () => {
  it("masks a social security number", () => {
    const result = redactPII("My SSN is 123-45-6789 and that is private.");
    expect(result.findings).toBe(1);
    expect(result.redactedText).toBe("My SSN is [REDACTED:SSN] and that is private.");
  });

  it("masks phone numbers", () => {
    const result = redactPII("Call me at (555) 123-4567 please.");
    expect(result.findings).toBe(1);
    expect(result.redactedText).toContain("[REDACTED:PHONE]");
    expect(result.redactedText).not.toContain("(555) 123-4567");
  });

  it("masks email addresses", () => {
    const result = redactPII("Contact john.doe@example.com for details.");
    expect(result.findings).toBe(1);
    expect(result.redactedText).toBe("Contact [REDACTED:EMAIL] for details.");
  });

  it("masks several kinds of value in the same text", () => {
    const result = redactPII("SSN: 111-22-3333, phone: 555-444-3333, email: test@test.com");
    expect(result.findings).toBe(3);
    expect(result.redactedText).toBe("SSN: [REDACTED:SSN], phone: [REDACTED:PHONE], email: [REDACTED:EMAIL]");
  });

  it("reports what it found and where, but never the values themselves", () => {
    const result = redactPII("Email jane@example.com or call 555-444-3333.");

    expect(result.detected).toEqual([
      { type: "email", position: 6 },
      { type: "phone", position: 31 },
    ]);
    expect(JSON.stringify(result.detected)).not.toContain("jane@example.com");
  });

  it("leaves text without structured personal data unchanged", () => {
    const text = "This is a perfectly normal debate position about economics.";
    expect(redactPII(text)).toEqual({ redactedText: text, findings: 0, detected: [] });
  });

  it("does not detect names or street addresses (a known limit, stated in the README)", () => {
    const text = "My neighbour John Smith at 42 Elm Street told me about it.";
    expect(redactPII(text).redactedText).toBe(text);
  });
});
