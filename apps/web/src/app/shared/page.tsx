"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

import { ResultsView } from "../../components/conversation/results-view";
import type { AnalysisResult } from "../../components/conversation/types";
import { getPublicApiBaseUrl } from "../../lib/api-base";
import { stageLabel } from "../../lib/conversation-stage";

type SharedSession = {
  id: string;
  topic: string;
  status: string;
  anonymousMode: boolean;
  createdAt: string;
  analyzedAt: string | null;
  participantCount: number;
  participants: Array<{ displayName: string; role: string }>;
};

type SharedViewResponse = {
  success: boolean;
  data: { session: SharedSession; analysis: (AnalysisResult & { roundNumber: number; createdAt: string }) | null } | null;
  error?: { code: string; message: string } | null;
};

export default function SharedViewPage() {
  return (
    <Suspense fallback={<p className="quiet-status" role="status">Loading the shared results</p>}>
      <SharedViewPageContent />
    </Suspense>
  );
}

function SharedViewPageContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [data, setData] = useState<SharedViewResponse["data"]>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchSharedView = useCallback(async () => {
    if (!token) {
      setError("This link is incomplete. Ask the person who shared it for the full link.");
      setLoading(false);
      return;
    }
    try {
      const response = await fetch(`${getPublicApiBaseUrl()}/share-links/view/${encodeURIComponent(token)}`);
      const json: SharedViewResponse = await response.json();
      if (!response.ok || !json.success) {
        setError(json.error?.message ?? "These results could not be loaded.");
        return;
      }
      setData(json.data);
    } catch {
      setError("These results could not be loaded. Check your connection and reload the page.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void fetchSharedView();
  }, [fetchSharedView]);

  if (loading) return <p className="quiet-status" role="status">Loading the shared results</p>;

  if (error || !data) {
    return (
      <section className="narrow-page">
        <h1>These results are not available</h1>
        <p className="notice notice--error" role="alert">{error ?? "Nothing was found for this link."}</p>
        <Link href="/" className="button-link">Go to Common Ground</Link>
      </section>
    );
  }

  const { session, analysis } = data;
  const day = (value: string) => new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });

  return (
    <div className="conversation shared">
      <header className="conversation-header">
        <h1>{session.topic}</h1>
        <div className="conversation-header__meta">
          <span>Shared results, read only</span>
          <span>{session.participantCount} {session.participantCount === 1 ? "person" : "people"} took part</span>
          {analysis
            ? <span>Round {analysis.roundNumber}, {day(analysis.createdAt)}</span>
            : <span>{stageLabel(session.status).label}</span>}
        </div>
      </header>

      {analysis ? (
        <ResultsView result={analysis} />
      ) : (
        <p className="notice notice--warn">The results for this conversation are not ready yet. Try this link again later.</p>
      )}

      <section className="shared__invite" aria-labelledby="own-heading">
        <h2 id="own-heading">Have a disagreement of your own?</h2>
        <p>Common Ground restates each view fairly and shows the ground you share.</p>
        <Link href="/sign-in" className="button-link">Start your own conversation</Link>
      </section>
    </div>
  );
}
