import type { AnalysisResult } from "../components/conversation/types";
import { getServerApiBaseUrl } from "./api-base";
import { summaryLine } from "./results-summary";

export type SharedSession = {
  id: string;
  topic: string;
  status: string;
  anonymousMode: boolean;
  createdAt: string;
  analyzedAt: string | null;
  participantCount: number;
  participants: Array<{ displayName: string; role: string }>;
};

export type SharedData = {
  session: SharedSession;
  analysis: (AnalysisResult & { roundNumber: number; createdAt: string }) | null;
};

export type SharedLookup = { data: SharedData; error: null } | { data: null; error: string };

/**
 * The public results behind a share link, fetched on the server. Next.js remembers identical
 * fetches during one render, so the page and its link preview tags share a single request.
 */
export async function fetchSharedResults(token: string | null): Promise<SharedLookup> {
  if (!token) return { data: null, error: "This link is incomplete. Ask the person who shared it for the full link." };
  try {
    const response = await fetch(`${getServerApiBaseUrl()}/share-links/view/${encodeURIComponent(token)}`, { cache: "no-store" });
    const json = (await response.json()) as { success?: boolean; data?: SharedData | null; error?: { message?: string } | null };
    if (!response.ok || !json.success || !json.data) {
      return { data: null, error: json.error?.message ?? "These results could not be loaded." };
    }
    return { data: json.data, error: null };
  } catch {
    return { data: null, error: "These results could not be loaded. Try the link again later." };
  }
}

/** The line under the question in a link preview: the summary when there are points to count. */
export function sharedSummary(data: SharedData): string {
  const { analysis } = data;
  if (!analysis) return "The results are not ready yet.";
  const shared = analysis.sharedFoundationPoints;
  const differences = analysis.disagreementPoints;
  if (Array.isArray(shared) && Array.isArray(differences)) return summaryLine(shared.length, differences.length, "They");
  return "See where they agree and where they differ.";
}
