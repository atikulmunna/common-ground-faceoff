"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { ReadabilityMeter } from "./readability-meter";
import { apiGet, apiPost } from "../lib-api";

type SessionResponse = {
  success: boolean;
  data: {
    session: SessionData;
  } | null;
};
type SessionData = {
  id: string;
  topic: string;
  status: string;
  participants: Array<{
    id: string;
    userId: string;
    role: string;
    positionText: string | null;
  }>;
};

type AnalysisResponse = {
  success: boolean;
  data: {
    status: "queued" | "running" | "completed" | "failed" | "needs_input";
    result: {
      sharedFoundations: string;
      trueDisagreements: string;
      steelmans: Record<string, string>;
      conflictMap: Record<string, unknown>;
    } | null;
  } | null;
};

export function SessionView({ sessionId }: { sessionId: string }) {
  const [positionText, setPositionText] = useState("");
  const [session, setSession] = useState<SessionData | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResponse["data"] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedbackSaved, setFeedbackSaved] = useState(false);

  const refreshSession = useCallback(async () => {
    try {
      const response = await apiGet<SessionResponse>(`/sessions/${sessionId}`);
      setSession(response.data?.session ?? null);
      const self = response.data?.session.participants.find((participant) => participant.positionText !== null);
      if (self?.positionText) {
        setPositionText(self.positionText);
      }
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Failed to load session");
    }
  }, [sessionId]);

  const refreshAnalysis = useCallback(async () => {
    try {
      const response = await apiGet<AnalysisResponse>(`/sessions/${sessionId}/analysis`);
      setAnalysis(response.data ?? null);
    } catch {
      // Polling should not spam visible errors.
    }
  }, [sessionId]);

  useEffect(() => {
    void refreshSession();
    const timer = setInterval(() => {
      void refreshAnalysis();
    }, 3000);
    return () => clearInterval(timer);
  }, [refreshAnalysis, refreshSession]);

  async function submitPosition() {
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/sessions/${sessionId}/positions`, {
        positionText,
        roundNumber: 1
      });
      await refreshSession();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to submit position");
    } finally {
      setBusy(false);
    }
  }

  async function triggerAnalysis() {
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/sessions/${sessionId}/analyze`, {
        analysisVersion: "v1",
        promptTemplateVersion: "tpl-v1"
      });
      await refreshAnalysis();
    } catch (analyzeError) {
      setError(analyzeError instanceof Error ? analyzeError.message : "Failed to analyze");
    } finally {
      setBusy(false);
    }
  }

  async function submitFeedback() {
    await apiPost(`/sessions/${sessionId}/feedback`, {
      faithfulness: 4,
      neutrality: 4,
      comment: "MVP feedback placeholder"
    });
    setFeedbackSaved(true);
  }

  const status = useMemo(() => analysis?.status ?? session?.status ?? "draft", [analysis?.status, session?.status]);

  return (
    <section className="grid">
      <article className="card">
        <h1>{session?.topic ?? "Session"}</h1>
        <p>Status: <strong>{status}</strong></p>
      </article>

      <article className="card grid">
        <h2>Your Position</h2>
        <textarea
          rows={8}
          minLength={100}
          maxLength={5000}
          placeholder="Submit your position in 100-5000 characters"
          value={positionText}
          onChange={(event) => setPositionText(event.target.value)}
        />
        <ReadabilityMeter text={positionText} />
        <div style={{ display: "flex", gap: "0.8rem" }}>
          <button onClick={submitPosition} disabled={busy || positionText.length < 100}>
            {busy ? "Working..." : "Submit Position"}
          </button>
          <button className="secondary" onClick={triggerAnalysis} disabled={busy}>
            Trigger Analysis
          </button>
        </div>
      </article>

      <article className="card grid">
        <h2>Common Ground Map</h2>
        {analysis?.result ? (
          <>
            <div className="grid two">
              <div className="card">
                <h3>Shared Foundations</h3>
                <p>{analysis.result.sharedFoundations}</p>
              </div>
              <div className="card">
                <h3>True Disagreements</h3>
                <p>{analysis.result.trueDisagreements}</p>
              </div>
            </div>
            <pre className="card" style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(analysis.result.conflictMap, null, 2)}</pre>
            <button onClick={submitFeedback} disabled={feedbackSaved}>{feedbackSaved ? "Feedback saved" : "Submit 4/5 MVP feedback"}</button>
          </>
        ) : (
          <p>Analysis not ready yet. Current state: {status}</p>
        )}
      </article>

      {error ? <p style={{ color: "#b91c1c" }}>{error}</p> : null}
    </section>
  );
}
