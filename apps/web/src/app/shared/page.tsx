"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CommonGroundMap } from "../../components/common-ground-map";

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

type SharedAnalysis = {
  roundNumber: number;
  steelmans: Record<string, string>;
  conflictMap: Record<string, string[]>;
  sharedFoundations: string;
  trueDisagreements: string;
  confidenceScores?: { sharedFoundations: number; disagreements: number };
  llmProvider: string;
  modelVersion: string;
  createdAt: string;
} | null;

type SharedViewResponse = {
  success: boolean;
  data: {
    session: SharedSession;
    analysis: SharedAnalysis;
  } | null;
  error?: { code: string; message: string } | null;
};

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4100";

export default function SharedViewPage() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [session, setSession] = useState<SharedSession | null>(null);
  const [analysis, setAnalysis] = useState<SharedAnalysis>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchSharedView = useCallback(async () => {
    if (!token) {
      setError("No share token provided");
      setLoading(false);
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/share-links/view/${encodeURIComponent(token)}`);
      const json: SharedViewResponse = await res.json();

      if (!res.ok || !json.success) {
        setError(json.error?.message ?? "Failed to load shared session");
        return;
      }

      setSession(json.data?.session ?? null);
      setAnalysis(json.data?.analysis ?? null);
    } catch {
      setError("Failed to load shared session");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void fetchSharedView();
  }, [fetchSharedView]);

  if (loading) {
    return (
      <section className="grid">
        <article className="card"><p>Loading shared session...</p></article>
      </section>
    );
  }

  if (error) {
    return (
      <section className="grid">
        <article className="card">
          <h1>Shared Session</h1>
          <p style={{ color: "#ef4444" }}>{error}</p>
        </article>
      </section>
    );
  }

  if (!session) {
    return (
      <section className="grid">
        <article className="card"><p>Session not found.</p></article>
      </section>
    );
  }

  return (
    <section className="grid">
      <article className="card">
        <h1>Shared Session: {session.topic}</h1>
        <p style={{ color: "#666", fontSize: "0.875rem" }}>
          Read-only view &middot; {session.participantCount} participants &middot; Created{" "}
          {new Date(session.createdAt).toLocaleDateString()}
        </p>
        <p>
          <strong>Status:</strong> {session.status}
          {session.anonymousMode && " · Anonymous Mode"}
        </p>
      </article>

      {analysis ? (
        <article className="card">
          <CommonGroundMap
            result={{
              steelmans: analysis.steelmans,
              conflictMap: analysis.conflictMap,
              sharedFoundations: analysis.sharedFoundations,
              trueDisagreements: analysis.trueDisagreements,
              confidenceScores: analysis.confidenceScores,
            }}
          />
          <p style={{ fontSize: "0.75rem", color: "#999", marginTop: "1rem" }}>
            Round {analysis.roundNumber} · {analysis.llmProvider}/{analysis.modelVersion} ·
            Analyzed {new Date(analysis.createdAt).toLocaleDateString()}
          </p>
        </article>
      ) : (
        <article className="card">
          <p>Analysis has not been completed yet for this session.</p>
        </article>
      )}
    </section>
  );
}
