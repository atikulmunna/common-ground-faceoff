/**
 * Replaces structured personal data with placeholders before text is sent to a model (CG-FR59).
 *
 * This is pattern matching, not language understanding: it catches email addresses, phone
 * numbers, US social security numbers, payment card numbers, IP addresses and dates of birth.
 * Names, street addresses and other free-text details are not detected.
 */
const piiPatterns = [
  { name: "ssn", pattern: /\b\d{3}-\d{2}-\d{4}\b/g },
  { name: "phone", pattern: /\b(?:\+?\d{1,2}\s?)?(?:\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})\b/g },
  { name: "email", pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
  { name: "credit_card", pattern: /\b(?:\d{4}[- ]?){3}\d{4}\b/g },
  { name: "ip_address", pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g },
  { name: "date_of_birth", pattern: /\b(?:0[1-9]|1[0-2])\/(?:0[1-9]|[12]\d|3[01])\/(?:19|20)\d{2}\b/g },
];

export interface RedactionResult {
  redactedText: string;
  /** Number of values replaced. */
  findings: number;
  /** The kind and position of each replaced value; never the value itself. */
  detected: { type: string; position: number }[];
}

interface Match {
  type: string;
  start: number;
  end: number;
}

export function redactPII(input: string): RedactionResult {
  const matches: Match[] = [];
  for (const { name, pattern } of piiPatterns) {
    for (const match of input.matchAll(new RegExp(pattern.source, pattern.flags))) {
      matches.push({ type: name, start: match.index, end: match.index + match[0].length });
    }
  }

  // Keep the earliest (then longest) match wherever two overlap, so masking never splices text.
  matches.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: Match[] = [];
  for (const match of matches) {
    if (kept.length === 0 || match.start >= kept[kept.length - 1].end) kept.push(match);
  }

  let redactedText = input;
  for (const match of [...kept].reverse()) {
    redactedText =
      redactedText.slice(0, match.start) + `[REDACTED:${match.type.toUpperCase()}]` + redactedText.slice(match.end);
  }

  return {
    redactedText,
    findings: kept.length,
    detected: kept.map((match) => ({ type: match.type, position: match.start })),
  };
}
