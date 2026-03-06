const piiPatterns = [
  { name: "ssn", pattern: /\b\d{3}-\d{2}-\d{4}\b/g },
  { name: "phone", pattern: /\b(?:\+?\d{1,2}\s?)?(?:\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})\b/g },
  { name: "email", pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
  { name: "credit_card", pattern: /\b(?:\d{4}[- ]?){3}\d{4}\b/g },
  { name: "ip_address", pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g },
  { name: "date_of_birth", pattern: /\b(?:0[1-9]|1[0-2])\/(?:0[1-9]|[12]\d|3[01])\/(?:19|20)\d{2}\b/g },
];

// Configurable confidence threshold (CG-FR60)
const CONFIDENCE_THRESHOLD = Number(process.env.PII_CONFIDENCE_THRESHOLD ?? "0.85");

export interface RedactionFinding {
  type: string;
  original: string;
  position: number;
}

export interface RedactionStageResult {
  stage: "detect" | "mask" | "validate" | "uncertainty_check";
  findingsCount: number;
  confidence: number;
  blocked: boolean;
  findings?: RedactionFinding[];
}

export interface RedactionResult {
  redactedText: string;
  confidence: number;
  blocked: boolean;
  findings: number;
  stages: RedactionStageResult[];
}

/* ------------------------------------------------------------------ */
/*  Stage 1: Detect — identify PII patterns                            */
/* ------------------------------------------------------------------ */

function detectStage(input: string): { findings: RedactionFinding[]; confidence: number } {
  const findings: RedactionFinding[] = [];

  for (const { name, pattern } of piiPatterns) {
    // Reset regex state
    const regex = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(input)) !== null) {
      findings.push({
        type: name,
        original: match[0],
        position: match.index,
      });
    }
  }

  // Higher confidence when patterns are clearly identifiable
  const confidence = findings.length > 0 ? 0.99 : 0.96;
  return { findings, confidence };
}

/* ------------------------------------------------------------------ */
/*  Stage 2: Mask — replace detected PII with placeholders             */
/* ------------------------------------------------------------------ */

function maskStage(input: string, findings: RedactionFinding[]): string {
  let result = input;
  // Sort findings by position descending so replacements don't shift positions
  const sorted = [...findings].sort((a, b) => b.position - a.position);

  for (const finding of sorted) {
    const before = result.slice(0, finding.position);
    const after = result.slice(finding.position + finding.original.length);
    result = `${before}[REDACTED:${finding.type.toUpperCase()}]${after}`;
  }

  return result;
}

/* ------------------------------------------------------------------ */
/*  Stage 3: Validate — re-scan masked text for residual PII           */
/* ------------------------------------------------------------------ */

function validateStage(maskedText: string): { residualFindings: number; confidence: number } {
  let residualFindings = 0;

  for (const { pattern } of piiPatterns) {
    const regex = new RegExp(pattern.source, pattern.flags);
    const matches = maskedText.match(regex);
    if (matches) {
      // Filter out our own redaction markers
      const real = matches.filter((m) => !m.includes("[REDACTED:"));
      residualFindings += real.length;
    }
  }

  const confidence = residualFindings === 0 ? 0.99 : 0.7;
  return { residualFindings, confidence };
}

/* ------------------------------------------------------------------ */
/*  Stage 4: Uncertainty check — block if confidence below threshold   */
/*  (CG-FR60)                                                         */
/* ------------------------------------------------------------------ */

function uncertaintyCheckStage(
  detectConfidence: number,
  validateConfidence: number,
  findingsCount: number
): { finalConfidence: number; blocked: boolean } {
  // Combined confidence is the minimum of detect and validate stages
  const finalConfidence = Math.min(detectConfidence, validateConfidence);
  
  // Block if confidence is below threshold OR if there are residual findings
  const blocked = finalConfidence < CONFIDENCE_THRESHOLD;

  return { finalConfidence, blocked };
}

/* ------------------------------------------------------------------ */
/*  Main pipeline (CG-FR59)                                            */
/* ------------------------------------------------------------------ */

export function redactPII(input: string): RedactionResult {
  const stages: RedactionStageResult[] = [];

  // Stage 1: Detect
  const detect = detectStage(input);
  stages.push({
    stage: "detect",
    findingsCount: detect.findings.length,
    confidence: detect.confidence,
    blocked: false,
    findings: detect.findings,
  });

  // Stage 2: Mask
  const maskedText = maskStage(input, detect.findings);
  stages.push({
    stage: "mask",
    findingsCount: detect.findings.length,
    confidence: detect.confidence,
    blocked: false,
  });

  // Stage 3: Validate
  const validate = validateStage(maskedText);
  stages.push({
    stage: "validate",
    findingsCount: validate.residualFindings,
    confidence: validate.confidence,
    blocked: false,
  });

  // Stage 4: Uncertainty check
  const uncertainty = uncertaintyCheckStage(detect.confidence, validate.confidence, detect.findings.length);
  stages.push({
    stage: "uncertainty_check",
    findingsCount: 0,
    confidence: uncertainty.finalConfidence,
    blocked: uncertainty.blocked,
  });

  return {
    redactedText: maskedText,
    confidence: uncertainty.finalConfidence,
    blocked: uncertainty.blocked,
    findings: detect.findings.length,
    stages,
  };
}
