"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { ReadabilityMeter } from "./readability-meter";
import { CommonGroundMap } from "./common-ground-map";
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
      conflictMap: Record<string, string[]>;
      confidenceScores?: {
        sharedFoundations: number;
        disagreements: number;
      };
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

  async function submitFeedback(faithfulness: number, neutrality: number, comment: string) {
    await apiPost(`/sessions/${sessionId}/feedback`, {
      faithfulness,
      neutrality,
      comment: comment || undefined,
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
        {analysis?.result ? (
          <>
            <CommonGroundMap result={analysis.result} />
            <FeedbackPanel
              onSubmit={submitFeedback}
              saved={feedbackSaved}
            />
          </>
        ) : (
          <AnalysisStatus status={status} />
        )}
      </article>

      {error ? <p style={{ color: "#b91c1c" }}>{error}</p> : null}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

const STATUS_MESSAGES: Record<string, { label: string; description: string }> = {
  draft: { label: "Draft", description: "Waiting for participants to submit positions." },
  collecting_positions: { label: "Collecting", description: "Participants are submitting their positions." },
  queued: { label: "Queued", description: "Analysis is queued and will begin shortly." },
  running: { label: "Analyzing", description: "AI analysis is in progress\u2026" },
  failed: { label: "Failed", description: "Analysis encountered an error. Please try again." },
  needs_input: { label: "Needs Input", description: "Additional input is required before analysis can complete." },
};

function AnalysisStatus({ status }: { status: string }) {
  const info = STATUS_MESSAGES[status] ?? { label: status, description: "" };
  const isActive = status === "queued" || status === "running";

  return (
    <div className="cgm-status">
      <div className="cgm-status__icon">{isActive ? "⏳" : "📋"}</div>
      <h2 className="cgm-status__label">{info.label}</h2>
      <p className="cgm-status__desc">{info.description}</p>
      {isActive && <div className="cgm-status__pulse" />}
    </div>
  );
}

function FeedbackPanel({
  onSubmit,
  saved,
}: {
  onSubmit: (faithfulness: number, neutrality: number, comment: string) => void;
  saved: boolean;
}) {
  const [faithfulness, setFaithfulness] = useState(0);
  const [neutrality, setNeutrality] = useState(0);
  const [comment, setComment] = useState("");

  if (saved) {
    return (
      <div className="cgm-feedback cgm-feedback--saved">
        <span>✓ Feedback submitted. Thank you!</span>
      </div>
    );
  }

  return (
    <div className="cgm-feedback">
      <h3>Rate this analysis</h3>
      <div className="cgm-feedback__row">
        <RatingRow label="Steelman Faithfulness" value={faithfulness} onChange={setFaithfulness} />
        <RatingRow label="Neutrality" value={neutrality} onChange={setNeutrality} />
      </div>
      <textarea
        className="cgm-feedback__comment"
        placeholder="Optional comment…"
        rows={2}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
      />
      <button
        onClick={() => onSubmit(faithfulness, neutrality, comment)}
        disabled={faithfulness === 0 || neutrality === 0}
      >
        Submit Feedback
      </button>
    </div>
  );
}

function RatingRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="cgm-rating">
      <span className="cgm-rating__label">{label}</span>
      <div className="cgm-rating__stars">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            className={`cgm-rating__star ${n <= value ? "cgm-rating__star--active" : ""}`}
            onClick={() => onChange(n)}
            aria-label={`${n} out of 5`}
          >
            ★
          </button>
        ))}
      </div>
    </div>
  );
}
