import { randomUUID, createHash } from "node:crypto";

import { prisma } from "../lib/prisma.js";
import { redactPII } from "./redactionService.js";
import { callLlm, parseJsonResponse, type LlmResponse } from "./llmProvider.js";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface BuildAnalysisInput {
  sessionId: string;
  analysisVersion: string;
  promptTemplateVersion: string;
}

interface ParticipantPosition {
  participantLabel: string;
  positionText: string;
}

interface NormalizationResult {
  positions: { label: string; normalized: string }[];
}

interface SteelmanResult {
  steelmans: { label: string; steelman: string }[];
}

interface ValueExtractionResult {
  participants: {
    label: string;
    values: { name: string; description: string }[];
  }[];
}

interface ConflictClassificationResult {
  conflicts: {
    category: "empirical" | "value" | "semantic" | "procedural";
    description: string;
    participants: string[];
  }[];
}

interface SynthesisResult {
  sharedFoundations: string;
  trueDisagreements: string;
  confidenceScores: {
    sharedFoundations: number;
    disagreements: number;
  };
}

/* ------------------------------------------------------------------ */
/*  Prompt templates  (SRS §4.3 – five-stage analysis pipeline)        */
/* ------------------------------------------------------------------ */

const SYSTEM_PROMPT = `You are the Common Ground Analysis Engine — a neutral, expert mediator AI. Your job is to analyze multiple perspectives on a topic and find common ground. Always respond with valid JSON matching the requested schema. Be fair, balanced, and charitable to every position.`;

function normalizationPrompt(topic: string, positions: ParticipantPosition[]): string {
  const block = positions
    .map((p) => `### ${p.participantLabel}\n${p.positionText}`)
    .join("\n\n");
  return `# Stage 1 — Normalization

Topic: "${topic}"

Below are the raw participant positions. Rewrite each for clarity, fixing grammar and removing rhetorical excess, WITHOUT changing meaning. Return JSON:

\`\`\`json
{
  "positions": [
    { "label": "<participant label>", "normalized": "<clear rewrite>" }
  ]
}
\`\`\`

Positions:
${block}`;
}

function steelmanPrompt(topic: string, normalized: NormalizationResult): string {
  const block = normalized.positions
    .map((p) => `### ${p.label}\n${p.normalized}`)
    .join("\n\n");
  return `# Stage 2 — Steelman

Topic: "${topic}"

Construct the strongest, most charitable version of each position below. Strengthen weak arguments while preserving the core claim. Return JSON:

\`\`\`json
{
  "steelmans": [
    { "label": "<participant label>", "steelman": "<strongest version>" }
  ]
}
\`\`\`

Normalized positions:
${block}`;
}

function valueExtractionPrompt(topic: string, steelmans: SteelmanResult): string {
  const block = steelmans.steelmans
    .map((s) => `### ${s.label}\n${s.steelman}`)
    .join("\n\n");
  return `# Stage 3 — Value Extraction

Topic: "${topic}"

For each steelmanned position, extract the underlying values and principles (e.g., fairness, freedom, efficiency, safety). Return JSON:

\`\`\`json
{
  "participants": [
    {
      "label": "<participant label>",
      "values": [
        { "name": "<value name>", "description": "<why this value matters to them>" }
      ]
    }
  ]
}
\`\`\`

Steelmanned positions:
${block}`;
}

function conflictClassificationPrompt(
  topic: string,
  steelmans: SteelmanResult,
  values: ValueExtractionResult
): string {
  const stBlock = steelmans.steelmans
    .map((s) => `### ${s.label}\n${s.steelman}`)
    .join("\n\n");
  const valBlock = values.participants
    .map(
      (p) =>
        `### ${p.label}\n${p.values.map((v) => `- ${v.name}: ${v.description}`).join("\n")}`
    )
    .join("\n\n");
  return `# Stage 4 — Conflict Classification

Topic: "${topic}"

Classify each disagreement into one of these categories:
- **empirical**: disagreement about facts or predictions
- **value**: disagreement about priorities or moral weight
- **semantic**: disagreement arising from different definitions
- **procedural**: disagreement about process, not outcome

Return JSON:
\`\`\`json
{
  "conflicts": [
    {
      "category": "empirical|value|semantic|procedural",
      "description": "<what the disagreement is>",
      "participants": ["<labels involved>"]
    }
  ]
}
\`\`\`

Steelmanned positions:
${stBlock}

Extracted values:
${valBlock}`;
}

function synthesisPrompt(
  topic: string,
  steelmans: SteelmanResult,
  values: ValueExtractionResult,
  conflicts: ConflictClassificationResult
): string {
  const stBlock = steelmans.steelmans
    .map((s) => `### ${s.label}\n${s.steelman}`)
    .join("\n\n");
  const valBlock = values.participants
    .map(
      (p) =>
        `### ${p.label}\n${p.values.map((v) => `- ${v.name}: ${v.description}`).join("\n")}`
    )
    .join("\n\n");
  const confBlock = conflicts.conflicts
    .map(
      (c) =>
        `- [${c.category}] ${c.description} (${c.participants.join(", ")})`
    )
    .join("\n");
  return `# Stage 5 — Synthesis

Topic: "${topic}"

Given the steelmanned positions, extracted values, and classified conflicts below, produce:
1. **Shared Foundations** — beliefs, values, or goals all participants genuinely share.
2. **True Disagreements** — irreducible differences that remain after removing misunderstandings and semantic confusion.
3. **Confidence Scores** — your confidence (0-1) in the accuracy of the shared foundations and disagreements.

Return JSON:
\`\`\`json
{
  "sharedFoundations": "<paragraph>",
  "trueDisagreements": "<paragraph>",
  "confidenceScores": {
    "sharedFoundations": 0.0,
    "disagreements": 0.0
  }
}
\`\`\`

Steelmanned positions:
${stBlock}

Extracted values:
${valBlock}

Classified conflicts:
${confBlock}`;
}

/* ------------------------------------------------------------------ */
/*  Pipeline runner                                                    */
/* ------------------------------------------------------------------ */

/** CG-NFR40: Hash all prompt templates for reproducibility tracking */
function computePromptTemplateHash(): string {
  const templates = [
    SYSTEM_PROMPT,
    normalizationPrompt.toString(),
    steelmanPrompt.toString(),
    valueExtractionPrompt.toString(),
    conflictClassificationPrompt.toString(),
    synthesisPrompt.toString(),
  ].join("||");
  return createHash("sha256").update(templates).digest("hex").slice(0, 16);
}

/** CG-FR30: Log each LLM call with PII-stripped prompts and responses */
async function logPrompt(
  sessionId: string,
  pipelineRunId: string,
  stage: string,
  userPrompt: string,
  res: LlmResponse,
  durationMs: number
): Promise<void> {
  try {
    await prisma.promptLog.create({
      data: {
        sessionId,
        pipelineRunId,
        stage,
        provider: res.provider,
        model: res.model,
        systemPrompt: SYSTEM_PROMPT,
        userPrompt,       // already PII-stripped before pipeline
        responseText: res.content,
        promptTokens: res.promptTokens,
        completionTokens: res.completionTokens,
        durationMs,
      },
    });
  } catch {
    // Fire-and-forget: logging failure must not break the pipeline
  }
}

async function runPipeline(
  topic: string,
  positions: ParticipantPosition[],
  sessionId: string,
  pipelineRunId: string
): Promise<{
  steelmans: Record<string, string>;
  conflictMap: Record<string, string[]>;
  sharedFoundations: string;
  trueDisagreements: string;
  confidenceScores: { sharedFoundations: number; disagreements: number };
  llmProvider: string;
  modelVersion: string;
  promptTemplateHash: string;
}> {
  // Stage 1 – Normalization
  const normPrompt = normalizationPrompt(topic, positions);
  const normStart = Date.now();
  const normRes = await callLlm(SYSTEM_PROMPT, normPrompt);
  await logPrompt(sessionId, pipelineRunId, "normalization", normPrompt, normRes, Date.now() - normStart);
  const normData = parseJsonResponse<NormalizationResult>(normRes.content);

  // Stage 2 – Steelman
  const steelPrompt_ = steelmanPrompt(topic, normData);
  const steelStart = Date.now();
  const steelRes = await callLlm(SYSTEM_PROMPT, steelPrompt_);
  await logPrompt(sessionId, pipelineRunId, "steelman", steelPrompt_, steelRes, Date.now() - steelStart);
  const steelData = parseJsonResponse<SteelmanResult>(steelRes.content);

  // Stage 3 – Value Extraction
  const valPrompt = valueExtractionPrompt(topic, steelData);
  const valStart = Date.now();
  const valRes = await callLlm(SYSTEM_PROMPT, valPrompt);
  await logPrompt(sessionId, pipelineRunId, "value_extraction", valPrompt, valRes, Date.now() - valStart);
  const valData = parseJsonResponse<ValueExtractionResult>(valRes.content);

  // Stage 4 – Conflict Classification
  const confPrompt = conflictClassificationPrompt(topic, steelData, valData);
  const confStart = Date.now();
  const confRes = await callLlm(SYSTEM_PROMPT, confPrompt);
  await logPrompt(sessionId, pipelineRunId, "conflict_classification", confPrompt, confRes, Date.now() - confStart);
  const confData = parseJsonResponse<ConflictClassificationResult>(confRes.content);

  // Stage 5 – Synthesis
  const synthPrompt = synthesisPrompt(topic, steelData, valData, confData);
  const synthStart = Date.now();
  const synthRes = await callLlm(SYSTEM_PROMPT, synthPrompt);
  await logPrompt(sessionId, pipelineRunId, "synthesis", synthPrompt, synthRes, Date.now() - synthStart);
  const synthData = parseJsonResponse<SynthesisResult>(synthRes.content);

  // Build steelmans map keyed by label
  const steelmansMap: Record<string, string> = {};
  for (const s of steelData.steelmans) {
    steelmansMap[s.label] = s.steelman;
  }

  const conflictMap: Record<string, string[]> = {};
  for (const c of confData.conflicts) {
    if (!conflictMap[c.category]) conflictMap[c.category] = [];
    conflictMap[c.category].push(c.description);
  }

  return {
    steelmans: steelmansMap,
    conflictMap,
    sharedFoundations: synthData.sharedFoundations,
    trueDisagreements: synthData.trueDisagreements,
    confidenceScores: synthData.confidenceScores,
    llmProvider: synthRes.provider,
    modelVersion: synthRes.model,
    promptTemplateHash: computePromptTemplateHash(),
  };
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

function estimateStatus(totalChars: number): "queued" | "running" {
  return totalChars > 4000 ? "queued" : "running";
}

/** CG-FR57: estimate completion time based on character count & mode */
export function estimateCompletionSeconds(totalChars: number): number {
  if (totalChars <= 4000) return 60; // sync: ≤60s per SRS
  // Async: linear estimate ~1s per 100 chars with 30s base
  return Math.min(600, 30 + Math.ceil(totalChars / 100));
}

export async function runAnalysis(input: BuildAnalysisInput) {
  const session = await prisma.session.findUniqueOrThrow({
    where: { id: input.sessionId },
  });

  const participants = await prisma.sessionParticipant.findMany({
    where: { sessionId: input.sessionId },
    include: { user: { select: { displayName: true } } },
  });

  const positions: ParticipantPosition[] = participants
    .filter((p) => p.positionText)
    .map((p, idx) => ({
      participantLabel: `Participant ${String.fromCharCode(65 + idx)}`,
      positionText: p.positionText!,
    }));

  if (positions.length < 2) {
    throw new Error("At least 2 participant positions are required for analysis");
  }

  const combined = positions.map((p) => p.positionText).join("\n\n");
  const totalChars = combined.length;

  if (totalChars > 30000) {
    throw new Error("Combined payload exceeds asynchronous max threshold");
  }

  // PII redaction (CG-FR59: 4-stage pipeline with audit logging)
  const redaction = redactPII(combined);

  // Log each redaction stage to RedactionLog
  for (const stage of redaction.stages) {
    await prisma.redactionLog.create({
      data: {
        sessionId: input.sessionId,
        participantId: "combined",
        stage: stage.stage,
        findingsCount: stage.findingsCount,
        confidence: stage.confidence,
        blocked: stage.blocked,
        metadata: stage.findings ? { findings: stage.findings.map(f => ({ type: f.type, position: f.position })) } : undefined,
      },
    });
  }

  if (redaction.blocked) {
    await prisma.session.update({
      where: { id: input.sessionId },
      data: { status: "needs_input" },
    });

    await prisma.analysisEvent.create({
      data: {
        sessionId: input.sessionId,
        pipelineRunId: "redaction",
        eventType: "redaction_blocked",
        fromState: "collecting_positions",
        toState: "needs_input",
        reasonCode: "low_redaction_confidence",
        actorType: "system",
      },
    });

    return { status: "needs_input" as const, pipelineRunId: "redaction" };
  }

  // Apply redaction to position texts
  const redactedPositions = positions.map((p) => ({
    ...p,
    positionText: redactPII(p.positionText).redactedText,
  }));

  const pipelineRunId = randomUUID();
  const targetStatus = estimateStatus(totalChars);
  const etaSeconds = estimateCompletionSeconds(totalChars);
  const estimatedCompletionAt = new Date(Date.now() + etaSeconds * 1000);

  await prisma.session.update({
    where: { id: input.sessionId },
    data: { status: targetStatus, estimatedCompletionAt },
  });

  await prisma.analysisEvent.create({
    data: {
      sessionId: input.sessionId,
      pipelineRunId,
      eventType: "analysis_started",
      fromState: "collecting_positions",
      toState: targetStatus,
      actorType: "system",
    },
  });

  if (targetStatus === "queued") {
    return { status: "queued" as const, pipelineRunId };
  }

  // CG-FR68: Snapshot per-round positions before running analysis
  const currentRound = await prisma.analysisResult.findFirst({
    where: { sessionId: input.sessionId, status: "completed" },
    orderBy: { roundNumber: "desc" },
    select: { roundNumber: true },
  });
  const snapshotRound = (currentRound?.roundNumber ?? 0) + 1;
  for (const p of participants) {
    if (p.positionText) {
      await prisma.positionSnapshot.upsert({
        where: {
          sessionId_userId_roundNumber: {
            sessionId: input.sessionId,
            userId: p.userId,
            roundNumber: snapshotRound,
          },
        },
        update: { positionText: p.positionText },
        create: {
          sessionId: input.sessionId,
          userId: p.userId,
          roundNumber: snapshotRound,
          positionText: p.positionText,
        },
      });
    }
  }

  // Run the real LLM pipeline
  const inputHash = createHash("sha256").update(redaction.redactedText).digest("hex");

  let pipelineOutput;
  try {
    pipelineOutput = await runPipeline(session.topic, redactedPositions, input.sessionId, pipelineRunId);
  } catch (err) {
    await prisma.session.update({
      where: { id: input.sessionId },
      data: { status: "failed" },
    });
    await prisma.analysisEvent.create({
      data: {
        sessionId: input.sessionId,
        pipelineRunId,
        eventType: "analysis_failed",
        fromState: "running",
        toState: "failed",
        reasonCode: err instanceof Error ? err.message.slice(0, 200) : "unknown",
        actorType: "system",
      },
    });
    throw err;
  }

  // Determine round number and lineage (CG-FR68)
  const previousRound = await prisma.analysisResult.findFirst({
    where: { sessionId: input.sessionId, status: "completed" },
    orderBy: { roundNumber: "desc" },
    select: { id: true, roundNumber: true },
  });
  const roundNumber = (previousRound?.roundNumber ?? 0) + 1;

  const result = await prisma.analysisResult.create({
    data: {
      sessionId: input.sessionId,
      roundNumber,
      parentSessionOrRoundId: previousRound?.id ?? null,
      pipelineRunId,
      analysisVersion: input.analysisVersion,
      promptTemplateVersion: input.promptTemplateVersion,
      promptTemplateHash: pipelineOutput.promptTemplateHash,
      inputHash,
      steelmans: pipelineOutput.steelmans,
      conflictMap: pipelineOutput.conflictMap,
      sharedFoundations: pipelineOutput.sharedFoundations,
      trueDisagreements: pipelineOutput.trueDisagreements,
      confidenceScores: pipelineOutput.confidenceScores,
      llmProvider: pipelineOutput.llmProvider,
      modelVersion: pipelineOutput.modelVersion,
      status: "completed",
    },
  });

  await prisma.session.update({
    where: { id: input.sessionId },
    data: { status: "completed", analyzedAt: new Date() },
  });

  await prisma.analysisEvent.create({
    data: {
      sessionId: input.sessionId,
      pipelineRunId,
      eventType: "analysis_completed",
      fromState: "running",
      toState: "completed",
      actorType: "system",
    },
  });

  return {
    status: "completed" as const,
    pipelineRunId,
    result,
  };
}

export async function completeQueuedAnalysis(
  sessionId: string,
  pipelineRunId: string
): Promise<void> {
  const session = await prisma.session.findUniqueOrThrow({
    where: { id: sessionId },
  });

  const participants = await prisma.sessionParticipant.findMany({
    where: { sessionId },
    include: { user: { select: { displayName: true } } },
  });

  const positions: ParticipantPosition[] = participants
    .filter((p) => p.positionText)
    .map((p, idx) => ({
      participantLabel: `Participant ${String.fromCharCode(65 + idx)}`,
      positionText: redactPII(p.positionText!).redactedText,
    }));

  const combined = positions.map((p) => p.positionText).join("\n\n");
  const inputHash = createHash("sha256").update(combined).digest("hex");

  // CG-FR68: Snapshot per-round positions for queued analysis
  const prevRoundForSnapshot = await prisma.analysisResult.findFirst({
    where: { sessionId, status: "completed" },
    orderBy: { roundNumber: "desc" },
    select: { roundNumber: true },
  });
  const queuedSnapshotRound = (prevRoundForSnapshot?.roundNumber ?? 0) + 1;
  for (const p of participants) {
    if (p.positionText) {
      await prisma.positionSnapshot.upsert({
        where: {
          sessionId_userId_roundNumber: {
            sessionId,
            userId: p.userId,
            roundNumber: queuedSnapshotRound,
          },
        },
        update: { positionText: p.positionText },
        create: {
          sessionId,
          userId: p.userId,
          roundNumber: queuedSnapshotRound,
          positionText: p.positionText,
        },
      });
    }
  }

  await prisma.session.update({ where: { id: sessionId }, data: { status: "running" } });

  let pipelineOutput;
  try {
    pipelineOutput = await runPipeline(session.topic, positions, sessionId, pipelineRunId);
  } catch (err) {
    await prisma.session.update({ where: { id: sessionId }, data: { status: "failed" } });
    await prisma.analysisEvent.create({
      data: {
        sessionId,
        pipelineRunId,
        eventType: "analysis_failed",
        fromState: "running",
        toState: "failed",
        reasonCode: err instanceof Error ? err.message.slice(0, 200) : "unknown",
        actorType: "worker",
      },
    });
    return;
  }

  // Determine round number and lineage (CG-FR68)
  const previousRound = await prisma.analysisResult.findFirst({
    where: { sessionId, status: "completed" },
    orderBy: { roundNumber: "desc" },
    select: { id: true, roundNumber: true },
  });
  const roundNumber = (previousRound?.roundNumber ?? 0) + 1;

  await prisma.analysisResult.create({
    data: {
      sessionId,
      roundNumber,
      parentSessionOrRoundId: previousRound?.id ?? null,
      pipelineRunId,
      analysisVersion: "v1",
      promptTemplateVersion: "tpl-v1",
      promptTemplateHash: pipelineOutput.promptTemplateHash,
      inputHash,
      steelmans: pipelineOutput.steelmans,
      conflictMap: pipelineOutput.conflictMap,
      sharedFoundations: pipelineOutput.sharedFoundations,
      trueDisagreements: pipelineOutput.trueDisagreements,
      confidenceScores: pipelineOutput.confidenceScores,
      llmProvider: pipelineOutput.llmProvider,
      modelVersion: pipelineOutput.modelVersion,
      status: "completed",
    },
  });

  await prisma.session.update({
    where: { id: sessionId },
    data: { status: "completed", analyzedAt: new Date() },
  });

  await prisma.analysisEvent.create({
    data: {
      sessionId,
      pipelineRunId,
      eventType: "analysis_completed",
      fromState: "queued",
      toState: "completed",
      actorType: "worker",
    },
  });
}
