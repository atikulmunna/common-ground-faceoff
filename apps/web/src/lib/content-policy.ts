"use client";

/**
 * Lightweight client-side content policy checker (CG-FR19).
 * Flags obvious hate speech, threats, slurs, and violent language
 * so users can revise before submission. This is a pre-submission
 * warning only — not a moderation system.
 */

interface PolicyWarning {
  category: string;
  message: string;
}

const THREAT_PATTERNS = [
  /\b(kill|murder|execute|assassinate|eliminate)\s+(you|them|him|her|everyone)\b/i,
  /\b(i('ll| will)|we('ll| will)|gonna)\s+(hurt|harm|attack|destroy|bomb|shoot)\b/i,
  /\bdeath\s+threat/i,
];

const HATE_PATTERNS = [
  /\b(all\s+)?(jews|muslims|christians|blacks|whites|asians|hispanics|gays|lesbians|trans\s*people)\s+(should|must|need\s+to)\s+(die|be\s+killed|be\s+eliminated|disappear)\b/i,
  /\b(ethnic|racial)\s+cleansing\b/i,
  /\bgenocide\s+(is\s+)?(good|needed|necessary)\b/i,
];

const PERSONAL_INFO_PATTERNS = [
  /\b\d{3}[-.]?\d{2}[-.]?\d{4}\b/, // SSN
  /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/, // Phone
];

function testPatterns(text: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(text));
}

export function checkContentPolicy(text: string): PolicyWarning[] {
  const warnings: PolicyWarning[] = [];

  if (testPatterns(text, THREAT_PATTERNS)) {
    warnings.push({
      category: "threats",
      message: "Your text may contain threatening language. Focus on your view rather than on threats.",
    });
  }

  if (testPatterns(text, HATE_PATTERNS)) {
    warnings.push({
      category: "hate_speech",
      message: "Your text may contain hate speech. Common Ground is for constructive discussion, so please reframe your argument.",
    });
  }

  if (testPatterns(text, PERSONAL_INFO_PATTERNS)) {
    warnings.push({
      category: "personal_info",
      message: "Your text seems to include personal information, such as a phone or social security number. Other participants may be able to read it.",
    });
  }

  if (text.length > 0) {
    const upper = text.replace(/[^A-Za-z]/g, "");
    const upperRatio = upper.length > 0
      ? (upper.replace(/[^A-Z]/g, "").length / upper.length)
      : 0;
    if (upperRatio > 0.7 && text.length > 50) {
      warnings.push({
        category: "tone",
        message: "Excessive use of capital letters can read as aggressive. Consider adjusting your tone for more productive dialogue.",
      });
    }
  }

  return warnings;
}
