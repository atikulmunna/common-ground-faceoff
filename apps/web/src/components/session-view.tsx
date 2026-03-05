"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { ReadabilityMeter } from "./readability-meter";
import { CommonGroundMap } from "./common-ground-map";
import { apiGet, apiPost } from "../lib-api";
import { checkContentPolicy } from "../lib/content-policy";

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
  const [editing, setEditing] = useState(false);
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [myReactions, setMyReactions] = useState<Record<string, "represents" | "misrepresents" | "neutral">>({});
  const [mutualAcks, setMutualAcks] = useState<Record<string, boolean>>({});

  const refreshSession = useCallback(async () => {
    try {
      const response = await apiGet<SessionResponse>(`/sessions/${sessionId}`);
      setSession(response.data?.session ?? null);
      const self = response.data?.session.participants.find((participant) => participant.positionText !== null);
      if (self?.positionText) {
        setPositionText(self.positionText);
        setHasSubmitted(true);
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

  const refreshReactions = useCallback(async () => {
    try {
      const res = await apiGet<{
        success: boolean;
        data: {
          reactions: Array<{ userId: string; section: string; reaction: "represents" | "misrepresents" | "neutral" }>;
          mutualAcknowledgments: Record<string, boolean>;
        } | null;
      }>(`/sessions/${sessionId}/reactions`);
      if (res.data) {
        const mine: Record<string, "represents" | "misrepresents" | "neutral"> = {};
        const selfId = session?.participants.find((p) => p.positionText !== null)?.userId;
        for (const r of res.data.reactions) {
          if (r.userId === selfId) mine[r.section] = r.reaction;
        }
        setMyReactions(mine);
        setMutualAcks(res.data.mutualAcknowledgments);
      }
    } catch {
      // silent
    }
  }, [sessionId, session]);

  async function handleReact(section: string, reaction: "represents" | "misrepresents" | "neutral") {
    try {
      await apiPost(`/sessions/${sessionId}/reactions`, { section, reaction });
      await refreshReactions();
    } catch {
      // silent
    }
  }

  useEffect(() => {
    void refreshSession();
    const timer = setInterval(() => {
      void refreshAnalysis();
      void refreshReactions();
    }, 3000);
    return () => clearInterval(timer);
  }, [refreshAnalysis, refreshSession, refreshReactions]);

  async function submitPosition() {
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/sessions/${sessionId}/positions`, {
        positionText,
        roundNumber: 1
      });
      setHasSubmitted(true);
      setEditing(false);
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
  const isLocked = ["queued", "running", "completed"].includes(status);
  const showEditor = !hasSubmitted || editing;
  const policyWarnings = useMemo(() => checkContentPolicy(positionText), [positionText]);

  return (
    <section className="grid">
      <article className="card">
        <h1>{session?.topic ?? "Session"}</h1>
        <p>Status: <strong>{status}</strong></p>
      </article>

      <article className="card grid">
        <h2>Your Position</h2>
        {showEditor ? (
          <>
            <textarea
              rows={8}
              minLength={100}
              maxLength={5000}
              placeholder="Submit your position in 100-5000 characters"
              value={positionText}
              onChange={(event) => setPositionText(event.target.value)}
            />
            <ReadabilityMeter text={positionText} />
            {policyWarnings.length > 0 && (
              <div className="cgm-policy-warnings">
                {policyWarnings.map((w) => (
                  <p key={w.category} className="cgm-policy-warning">
                    ⚠ {w.message}
                  </p>
                ))}
              </div>
            )}
            <div style={{ display: "flex", gap: "0.8rem" }}>
              <button onClick={submitPosition} disabled={busy || positionText.length < 100}>
                {busy ? "Working..." : hasSubmitted ? "Save Changes" : "Submit Position"}
              </button>
              {hasSubmitted && (
                <button className="secondary" onClick={() => setEditing(false)}>
                  Cancel
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="cgm-position-preview">
              <p>{positionText}</p>
            </div>
            <div style={{ display: "flex", gap: "0.8rem" }}>
              {!isLocked && (
                <button onClick={() => setEditing(true)}>Edit Position</button>
              )}
              <button className="secondary" onClick={triggerAnalysis} disabled={busy || isLocked}>
                {isLocked ? "Analysis Started" : "Trigger Analysis"}
              </button>
            </div>
          </>
        )}
      </article>

      <article className="card grid">
        {analysis?.result ? (
          <>
            <CommonGroundMap
              result={analysis.result}
              reactions={{ mine: myReactions, mutual: mutualAcks }}
              onReact={handleReact}
            />
            <ExportPanel sessionId={sessionId} />
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

function ExportPanel({ sessionId }: { sessionId: string }) {
  const [exporting, setExporting] = useState(false);

  async function downloadExport(format: "json" | "markdown") {
    setExporting(true);
    try {
      const { getSession } = await import("next-auth/react");
      const session = await getSession();
      const token = session?.user?.accessToken;
      const base = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";
      const res = await fetch(`${base}/sessions/${sessionId}/export/${format}`, {
        headers: token ? { authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`Export failed (${res.status})`);

      const blob = await res.blob();
      const ext = format === "json" ? "json" : "md";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `common-ground-${sessionId}.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="cgm-export">
      <h3>Export</h3>
      <div className="cgm-export__buttons">
        <button onClick={() => downloadExport("json")} disabled={exporting}>
          {exporting ? "Exporting…" : "JSON"}
        </button>
        <button onClick={() => downloadExport("markdown")} disabled={exporting}>
          {exporting ? "Exporting…" : "Markdown"}
        </button>
      </div>
    </div>
  );
}
