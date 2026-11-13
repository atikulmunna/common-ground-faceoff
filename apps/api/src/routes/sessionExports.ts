import { groundedPointSchema, participantValuesSchema, verificationSchema, type GroundedPoint } from "@common-ground/shared";
import { Router } from "express";
import PDFDocument from "pdfkit";
import { z } from "zod";

import { prisma } from "../lib/prisma.js";
import { createErrorResponse } from "../lib/response.js";
import { requirePermission } from "../middleware/authorization.js";
import { requireSessionAccess } from "../middleware/rbac.js";
import { uploadExport } from "../services/storageService.js";

export const sessionExportsRouter = Router();

const storedPointsSchema = z.array(groundedPointSchema);

/** Stored points, or null for results saved before points were kept (or if they do not parse). */
function pointsOrNull(value: unknown): GroundedPoint[] | null {
  const parsed = storedPointsSchema.safeParse(value);
  return parsed.success && parsed.data.length > 0 ? parsed.data : null;
}

function markdownPoints(points: GroundedPoint[] | null, fallback: string): string {
  if (!points) return `${fallback}\n\n`;
  return points
    .map((point) => [`- ${point.statement}`, ...point.evidence.map((item) => `  - ${item.label}: "${item.quote}"`)].join("\n"))
    .join("\n") + "\n\n";
}

function writePdfPoints(doc: PDFKit.PDFDocument, points: GroundedPoint[] | null, fallback: string): void {
  if (!points) {
    doc.fontSize(10).fillColor("#333").text(fallback);
    return;
  }
  for (const point of points) {
    doc.fontSize(10).fillColor("#000").text(`- ${point.statement}`);
    for (const item of point.evidence) {
      doc.fontSize(9).fillColor("#555").text(`${item.label}: "${item.quote}"`, { indent: 14 });
    }
    doc.moveDown(0.3);
  }
}

/* ------------------------------------------------------------------ */
/*  Export (CG-FR37, CG-FR40)                                          */
/* ------------------------------------------------------------------ */

sessionExportsRouter.get("/:id/export/:format", requireSessionAccess, requirePermission("export_session", { sessionScoped: true }), async (req, res) => {
  const format = req.params.format;
  if (!["json", "markdown", "md", "pdf"].includes(format)) {
    res.status(400).json(createErrorResponse("validation_error", "Supported export formats: json, markdown, pdf"));
    return;
  }

  const session = await prisma.session.findUnique({
    where: { id: req.params.id },
    include: {
      participants: {
        include: {
          user: { select: { displayName: true } }
        }
      }
    }
  });

  if (!session) {
    res.status(404).json(createErrorResponse("not_found", "Session not found"));
    return;
  }

  const analysis = await prisma.analysisResult.findFirst({
    where: { sessionId: req.params.id, status: "completed" },
    orderBy: [{ roundNumber: "desc" }, { createdAt: "desc" }]
  });

  if (!analysis) {
    res.status(422).json(createErrorResponse("async_state_error", "No completed analysis to export"));
    return;
  }

  const exportData = {
    session: {
      id: session.id,
      topic: session.topic,
      createdAt: session.createdAt,
      analyzedAt: session.analyzedAt,
      anonymousMode: session.anonymousMode,
    },
    participants: session.participants.map((p) => ({
      displayName: session.anonymousMode ? `Participant` : p.user.displayName,
      role: p.role,
    })),
    analysis: {
      version: analysis.analysisVersion,
      promptTemplateVersion: analysis.promptTemplateVersion,
      roundNumber: analysis.roundNumber,
      llmProvider: analysis.llmProvider,
      modelVersion: analysis.modelVersion,
      steelmans: analysis.steelmans,
      conflictMap: analysis.conflictMap,
      sharedFoundations: analysis.sharedFoundations,
      trueDisagreements: analysis.trueDisagreements,
      sharedFoundationPoints: analysis.sharedFoundationPoints,
      disagreementPoints: analysis.disagreementPoints,
      participantValues: analysis.participantValues,
      verification: analysis.verification,
      roundChanges: analysis.roundChanges,
      createdAt: analysis.createdAt,
    },
  };

  if (format === "json") {
    const jsonContent = JSON.stringify(exportData, null, 2);
    // Fire-and-forget R2 upload
    uploadExport({ sessionId: session.id, format: "json", content: jsonContent, contentType: "application/json" }).catch(() => {});
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="common-ground-${session.id}.json"`);
    res.send(jsonContent);
    return;
  }

  // Shared helpers for markdown and PDF
  const steelmans = (analysis.steelmans as Record<string, string>) ?? {};
  const conflicts = (analysis.conflictMap as Record<string, string[]>) ?? {};
  const verification = verificationSchema.safeParse(analysis.verification ?? null);
  const sharedCheck = verification.success
    ? `${verification.data.sharedVerified} of ${verification.data.sharedProposed} proposed common points held up against every restated view.`
    : null;
  const differenceCheck = verification.success
    ? `${verification.data.differencesVerified} of ${verification.data.differencesProposed} proposed differences held up against the restated views.`
    : null;
  // Each point with its quotes when the result has them; older results only have the joined text.
  const sharedPoints = pointsOrNull(analysis.sharedFoundationPoints);
  const disagreementPoints = pointsOrNull(analysis.disagreementPoints);
  const values = participantValuesSchema.safeParse(analysis.participantValues ?? null);
  const valuesFor = (label: string) => (values.success ? (values.data[label] ?? []).map((value) => value.name) : []);

  if (format === "pdf") {
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="common-ground-${session.id}.pdf"`);

    const doc = new PDFDocument({ margin: 50 });

    // Collect PDF buffer for R2 upload
    const pdfChunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => pdfChunks.push(chunk));
    doc.on("end", () => {
      const pdfBuffer = Buffer.concat(pdfChunks);
      uploadExport({ sessionId: session.id, format: "pdf", content: pdfBuffer, contentType: "application/pdf" }).catch(() => {});
    });

    doc.pipe(res);

    // Title
    doc.fontSize(20).text("Common Ground Map", { align: "center" });
    doc.moveDown(0.5);

    // Metadata (CG-FR40)
    doc.fontSize(10).fillColor("#666");
    doc.text(`Topic: ${session.topic}`);
    doc.text(`Date: ${session.createdAt.toISOString().split("T")[0]}`);
    doc.text(`Analysis Version: ${analysis.analysisVersion ?? "v1"}`);
    doc.text(`Model: ${analysis.llmProvider} / ${analysis.modelVersion}`);
    doc.text(`Participants: ${session.participants.map((p) => session.anonymousMode ? "Participant" : p.user.displayName).join(", ")}`);
    doc.moveDown(1);

    // Steelmanned Positions
    doc.fontSize(14).fillColor("#000").text("Steelmanned Positions", { underline: true });
    doc.moveDown(0.3);
    for (const [label, text] of Object.entries(steelmans)) {
      doc.fontSize(12).text(label, { underline: true });
      doc.fontSize(10).fillColor("#333").text(String(text));
      if (valuesFor(label).length > 0) doc.fontSize(9).fillColor("#555").text(`What matters to them: ${valuesFor(label).join(", ")}`);
      doc.fillColor("#000").moveDown(0.5);
    }

    // Shared Foundations
    doc.fontSize(14).fillColor("#000").text("Shared Foundations", { underline: true });
    if (sharedCheck) doc.fontSize(9).fillColor("#888").text(sharedCheck);
    writePdfPoints(doc, sharedPoints, analysis.sharedFoundations);
    doc.fillColor("#000").moveDown(0.5);

    // True Disagreements
    doc.fontSize(14).fillColor("#000").text("True Points of Disagreement", { underline: true });
    if (differenceCheck) doc.fontSize(9).fillColor("#888").text(differenceCheck);
    writePdfPoints(doc, disagreementPoints, analysis.trueDisagreements);
    doc.fillColor("#000").moveDown(0.5);

    // Conflict Classification
    if (Object.keys(conflicts).length > 0) {
      doc.fontSize(14).fillColor("#000").text("Conflict Classification", { underline: true });
      doc.moveDown(0.3);
      for (const [category, descriptions] of Object.entries(conflicts)) {
        doc.fontSize(11).text(category.charAt(0).toUpperCase() + category.slice(1));
        for (const desc of descriptions) {
          doc.fontSize(10).fillColor("#333").text(`  • ${desc}`);
        }
        doc.fillColor("#000").moveDown(0.3);
      }
    }

    doc.moveDown(1);
    doc.fontSize(8).fillColor("#999").text(
      `Exported from Common Ground on ${new Date().toISOString().split("T")[0]}`,
      { align: "center" }
    );

    doc.end();
    return;
  }

  // Markdown export

  let md = `# Common Ground Map\n\n`;
  md += `**Topic:** ${session.topic}\n`;
  md += `**Date:** ${session.createdAt.toISOString().split("T")[0]}\n`;
  md += `**Analysis Version:** ${analysis.analysisVersion ?? "v1"}\n`;
  md += `**Model:** ${analysis.llmProvider} / ${analysis.modelVersion}\n\n`;
  md += `---\n\n`;

  md += `## Steelmanned Positions\n\n`;
  for (const [label, text] of Object.entries(steelmans)) {
    md += `### ${label}\n\n${text}\n\n`;
    if (valuesFor(label).length > 0) md += `*What matters to them: ${valuesFor(label).join(", ")}*\n\n`;
  }

  md += `## Shared Foundations\n\n`;
  if (sharedCheck) md += `*${sharedCheck}*\n\n`;
  md += markdownPoints(sharedPoints, analysis.sharedFoundations);

  md += `## True Points of Disagreement\n\n`;
  if (differenceCheck) md += `*${differenceCheck}*\n\n`;
  md += markdownPoints(disagreementPoints, analysis.trueDisagreements);

  if (Object.keys(conflicts).length > 0) {
    md += `## Conflict Classification\n\n`;
    for (const [category, descriptions] of Object.entries(conflicts)) {
      md += `### ${category.charAt(0).toUpperCase() + category.slice(1)}\n\n`;
      for (const desc of descriptions) {
        md += `- ${desc}\n`;
      }
      md += `\n`;
    }
  }

  md += `---\n\n*Exported from Common Ground on ${new Date().toISOString().split("T")[0]}*\n`;

  // Fire-and-forget R2 upload
  uploadExport({ sessionId: session.id, format: "md", content: md, contentType: "text/markdown; charset=utf-8" }).catch(() => {});
  res.setHeader("Content-Type", "text/markdown; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="common-ground-${session.id}.md"`);
  res.send(md);
});
