type ModerationSeverity = "low" | "medium" | "high" | "critical";

const SLA_MINUTES_BY_SEVERITY: Record<ModerationSeverity, number> = {
  low: 72 * 60,
  medium: 24 * 60,
  high: 2 * 60,
  critical: 15,
};

export function computeModerationSlaDueAt(severity: ModerationSeverity, from = new Date()): Date {
  const minutes = SLA_MINUTES_BY_SEVERITY[severity];
  return new Date(from.getTime() + minutes * 60 * 1000);
}

export function getModerationSlaTargetMinutes(severity: ModerationSeverity): number {
  return SLA_MINUTES_BY_SEVERITY[severity];
}
