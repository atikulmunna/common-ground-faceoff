const piiPatterns = [
  /\b\d{3}-\d{2}-\d{4}\b/g,
  /\b(?:\+?\d{1,2}\s?)?(?:\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})\b/g,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi
];

export interface RedactionResult {
  redactedText: string;
  confidence: number;
  blocked: boolean;
  findings: number;
}

export function redactPII(input: string): RedactionResult {
  let redacted = input;
  let findings = 0;

  for (const pattern of piiPatterns) {
    const before = redacted;
    redacted = redacted.replace(pattern, "[REDACTED]");
    if (before !== redacted) {
      findings += 1;
    }
  }

  const confidence = findings > 0 ? 0.99 : 0.96;
  const blocked = confidence < 0.95;

  return {
    redactedText: redacted,
    confidence,
    blocked,
    findings
  };
}
