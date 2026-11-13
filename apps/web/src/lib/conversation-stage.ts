/** How a conversation's status reads to people, and the ink it is marked with. */
export type StageTone = "draft" | "gathering" | "analyzing" | "ready" | "attention";

const STAGES: Record<string, { label: string; tone: StageTone }> = {
  draft: { label: "Not started", tone: "draft" },
  collecting_positions: { label: "Gathering perspectives", tone: "gathering" },
  queued: { label: "Finding common ground", tone: "analyzing" },
  running: { label: "Finding common ground", tone: "analyzing" },
  completed: { label: "Results ready", tone: "ready" },
  failed: { label: "Needs attention", tone: "attention" },
  needs_input: { label: "Paused", tone: "attention" },
};

export function stageLabel(status: string): { label: string; tone: StageTone } {
  return STAGES[status] ?? { label: "In progress", tone: "draft" };
}

/** Participant labels run A, B, C and so on; each letter has its own ink. */
export function labelLetter(label: string | null | undefined): string | null {
  const match = /Participant ([A-Z])$/.exec(label ?? "");
  return match ? match[1].toLowerCase() : null;
}
