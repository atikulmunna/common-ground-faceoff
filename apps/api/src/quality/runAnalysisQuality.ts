import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";

import { blankHumanReview, evaluateAnalysisQuality, type AutomatedQualityResult } from "./analysisQuality.js";
import { analysisQualityCases, type AnalysisQualityCase } from "./analysisQualityCases.js";

interface CaseRun {
  caseId: string;
  category: string;
  topic: string;
  durationMs?: number;
  provider?: string;
  model?: string;
  inputPositions: { participantLabel: string; positionText: string }[];
  automated?: AutomatedQualityResult;
  output?: {
    steelmans: Record<string, string>;
    conflictMap: Record<string, string[]>;
    sharedFoundations: string;
    trueDisagreements: string;
    confidenceScores: { sharedFoundations: number; disagreements: number };
    promptTemplateHash?: string;
  };
  error?: string;
  humanReview: ReturnType<typeof blankHumanReview>;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../..");
dotenv.config({ path: path.join(repoRoot, "apps/api/.env") });

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function selectCases(): { live: boolean; fixtures: AnalysisQualityCase[] } {
  const live = process.argv.includes("--live");
  const caseId = readArg("--case");
  const limitValue = readArg("--limit");
  const limit = limitValue === undefined ? undefined : Number.parseInt(limitValue, 10);
  if (limitValue !== undefined && (!Number.isInteger(limit) || (limit ?? 0) < 1)) {
    throw new Error("--limit must be a positive integer");
  }

  let fixtures = analysisQualityCases;
  if (caseId) {
    fixtures = fixtures.filter((fixture) => fixture.id === caseId);
    if (fixtures.length === 0) throw new Error(`Unknown quality case: ${caseId}`);
  }
  if (limit !== undefined) fixtures = fixtures.slice(0, limit);
  if (live && !caseId && limit === undefined) {
    throw new Error("Live runs require --case <id> or --limit <n> to make provider usage explicit");
  }
  return { live, fixtures };
}

function scrubSensitive<T>(value: T, fixture: AnalysisQualityCase): T {
  let serialized = JSON.stringify(value);
  for (const token of fixture.sensitiveTokens ?? []) {
    serialized = serialized.replaceAll(token, "[LEAK_REMOVED]");
  }
  return JSON.parse(serialized) as T;
}

function safeFixturePositions(fixture: AnalysisQualityCase): CaseRun["inputPositions"] {
  return scrubSensitive(fixture.positions, fixture);
}

async function runLiveCase(fixture: AnalysisQualityCase): Promise<CaseRun> {
  const { redactPII } = await import("../services/redactionService.js");
  const { runAnalysisPipelineForQuality } = await import("../services/analysisService.js");
  // The pipeline redacts the topic and positions itself; this copy is what the report shows as input.
  const positions = fixture.positions.map((position) => ({
    ...position,
    positionText: redactPII(position.positionText).redactedText,
  }));
  const startedAt = Date.now();
  const output = await runAnalysisPipelineForQuality(fixture.topic, positions);
  const automated = evaluateAnalysisQuality(fixture, output);
  return scrubSensitive({
    caseId: fixture.id,
    category: fixture.category,
    topic: fixture.topic,
    durationMs: Date.now() - startedAt,
    provider: output.llmProvider,
    model: output.modelVersion,
    inputPositions: positions,
    automated,
    output: {
      steelmans: output.steelmans,
      conflictMap: output.conflictMap,
      sharedFoundations: output.sharedFoundations,
      trueDisagreements: output.trueDisagreements,
      confidenceScores: output.confidenceScores,
      promptTemplateHash: output.promptTemplateHash,
    },
    humanReview: blankHumanReview(fixture),
  }, fixture);
}

/**
 * Scores a saved live run again with the current scorer, without calling any model. Use it after a
 * scoring change to compare like with like.
 */
async function rescore(reportPath: string): Promise<CaseRun[]> {
  const saved = JSON.parse(await readFile(reportPath, "utf8")) as { runs: CaseRun[] };
  return saved.runs.map((run) => {
    const fixture = analysisQualityCases.find((candidate) => candidate.id === run.caseId);
    if (!fixture || !run.output) return run;
    const automated = evaluateAnalysisQuality(fixture, {
      ...run.output,
      sharedFoundationPoints: [],
      disagreementPoints: [],
      participantValues: {},
      verification: { sharedProposed: 0, sharedVerified: 0, differencesProposed: 0, differencesVerified: 0 },
      llmProvider: run.provider ?? "",
      modelVersion: run.model ?? "",
      // Reports from before the hash was saved still came from a real run.
      promptTemplateHash: run.output.promptTemplateHash ?? "from-saved-report",
    });
    return { ...run, automated };
  });
}

function markdownReport(mode: string, generatedAt: string, runs: CaseRun[]): string {
  const completed = runs.filter((run) => run.automated);
  const passed = completed.filter((run) => run.automated?.passed).length;
  const meanScore = completed.length
    ? Math.round(completed.reduce((sum, run) => sum + (run.automated?.score ?? 0), 0) / completed.length)
    : 0;
  const sections = runs.map((run) => {
    const metric = run.automated;
    const status = run.error ? `ERROR: ${run.error}` : metric ? `${metric.passed ? "PASS" : "FAIL"} (${metric.score}/100)` : "PENDING LIVE RUN";
    const output = run.output;
    const inputs = run.inputPositions
      .map((position) => `#### ${position.participantLabel}\n\n${position.positionText}`)
      .join("\n\n");
    const steelmans = output
      ? Object.entries(output.steelmans)
        .map(([label, steelman]) => `#### ${label}\n\n${steelman}`)
        .join("\n\n")
      : "";
    return [
      `## ${run.caseId}`,
      "",
      `- Category: ${run.category}`,
      `- Status: ${status}`,
      `- Provider/model: ${run.provider ?? "n/a"} / ${run.model ?? "n/a"}`,
      `- Duration: ${run.durationMs ?? "n/a"} ms`,
      `- Hard failures: ${metric?.hardFailures.join(", ") || "none"}`,
      "",
      `### Sanitized source positions\n\n${inputs}`,
      output ? `### Steelmans\n\n${steelmans}\n\n### Shared foundations\n\n${output.sharedFoundations}\n\n### True disagreements\n\n${output.trueDisagreements}` : "",
      "",
      "### Human review (1 to 5)",
      "",
      "Faithfulness per participant: ___ · Neutrality: ___ · Charitable steelmans: ___ · Shared-ground accuracy: ___ · Disagreement accuracy: ___ · Usefulness: ___ · Safety: ___",
      "",
      "Reviewer / date / comments: ___",
    ].filter(Boolean).join("\n");
  });
  return [
    "# Analysis Quality Report",
    "",
    `Generated: ${generatedAt}`,
    `Mode: ${mode}`,
    `Cases: ${runs.length}`,
    `Automated passes: ${passed}/${completed.length}`,
    `Mean automated score: ${meanScore}/100`,
    "",
    "> Automated anchor scores are regression proxies, not a substitute for human semantic review.",
    "",
    ...sections,
    "",
  ].join("\n");
}

async function writeReportFiles(
  base: string,
  mode: string,
  generatedAt: string,
  runs: CaseRun[],
): Promise<void> {
  const report = { generatedAt, mode, caseCount: runs.length, runs };
  await writeFile(`${base}.json`, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(`${base}.md`, markdownReport(mode, generatedAt, runs), "utf8");
}

async function main(): Promise<void> {
  const generatedAt = new Date().toISOString();
  const outputDir = path.join(repoRoot, ".codex-local/quality");
  await mkdir(outputDir, { recursive: true });
  const stamp = generatedAt.replaceAll(":", "-").replace(".", "-");

  const rescorePath = readArg("--rescore");
  if (rescorePath) {
    const rescored = await rescore(rescorePath);
    for (const run of rescored) {
      process.stdout.write(`${run.caseId}: ${run.automated ? `${run.automated.passed ? "PASS" : "FAIL"} (${run.automated.score}/100)` : "not scored"}\n`);
    }
    const base = path.join(outputDir, `analysis-quality-rescored-${stamp}`);
    await writeReportFiles(base, `rescored from ${path.basename(rescorePath)}`, generatedAt, rescored);
    process.stdout.write(`Report: ${base}.md\n`);
    if (rescored.some((run) => run.error || !run.automated?.passed)) process.exitCode = 1;
    return;
  }

  const { live, fixtures } = selectCases();
  const runs: CaseRun[] = [];
  const checkpointBase = path.join(outputDir, "analysis-quality-in-progress");

  if (live) {
    for (const fixture of fixtures) {
      process.stdout.write(`Running ${fixture.id}... `);
      try {
        const run = await runLiveCase(fixture);
        runs.push(run);
        process.stdout.write(`${run.automated?.passed ? "PASS" : "FAIL"} (${run.automated?.score}/100)\n`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        runs.push({
          caseId: fixture.id,
          category: fixture.category,
          topic: fixture.topic,
          inputPositions: safeFixturePositions(fixture),
          error: message,
          humanReview: blankHumanReview(fixture),
        });
        process.stdout.write(`ERROR (${message})\n`);
      }
      await writeReportFiles(checkpointBase, "live-in-progress", generatedAt, runs);
    }
  } else {
    runs.push(...fixtures.map((fixture) => ({
      caseId: fixture.id,
      category: fixture.category,
      topic: fixture.topic,
      inputPositions: safeFixturePositions(fixture),
      humanReview: blankHumanReview(fixture),
    })));
  }

  const base = path.join(outputDir, `analysis-quality-${stamp}`);
  const mode = live ? "live" : "validation";
  await writeReportFiles(base, mode, generatedAt, runs);
  process.stdout.write(`Report: ${base}.md\n`);

  if (live && runs.some((run) => run.error || !run.automated?.passed)) process.exitCode = 1;
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
