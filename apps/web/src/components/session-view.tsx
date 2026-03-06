"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";

import { ReadabilityMeter } from "./readability-meter";
import { CommonGroundMap } from "./common-ground-map";
import { GuidedPrompt } from "./guided-prompt";
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
  anonymousMode: boolean;
  deadline: string | null;
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

type RoundSummary = {
  id: string;
  roundNumber: number;
  parentSessionOrRoundId: string | null;
  sharedFoundations: string;
  trueDisagreements: string;
  steelmans: Record<string, string>;
  conflictMap: Record<string, string[]>;
  confidenceScores?: { sharedFoundations: number; disagreements: number };
  createdAt: string;
};

export function SessionView({ sessionId }: { sessionId: string }) {
  const { data: authSession } = useSession();
  const currentUserId = authSession?.user?.id;
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
  const [rounds, setRounds] = useState<RoundSummary[]>([]);
  const [showComparison, setShowComparison] = useState(false);
  const [comments, setComments] = useState<Array<{ id: string; userId: string; section: string; text: string; createdAt: string }>>([]);
  const [reportSent, setReportSent] = useState(false);

  const refreshSession = useCallback(async () => {
    try {
      const response = await apiGet<SessionResponse>(`/sessions/${sessionId}`);
      setSession(response.data?.session ?? null);
      if (currentUserId) {
        const self = response.data?.session.participants.find((p) => p.userId === currentUserId);
        if (self?.positionText) {
          setPositionText(self.positionText);
          setHasSubmitted(true);
        }
      }
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Failed to load session");
    }
  }, [sessionId, currentUserId]);

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
        for (const r of res.data.reactions) {
          if (r.userId === currentUserId) mine[r.section] = r.reaction;
        }
        setMyReactions(mine);
        setMutualAcks(res.data.mutualAcknowledgments);
      }
    } catch {
      // silent
    }
  }, [sessionId, currentUserId]);

  async function handleReact(section: string, reaction: "represents" | "misrepresents" | "neutral") {
    try {
      await apiPost(`/sessions/${sessionId}/reactions`, { section, reaction });
      await refreshReactions();
    } catch {
      // silent
    }
  }

  const fetchRounds = useCallback(async () => {
    try {
      const res = await apiGet<{
        success: boolean;
        data: { rounds: RoundSummary[] } | null;
      }>(`/sessions/${sessionId}/rounds`);
      setRounds(res.data?.rounds ?? []);
    } catch {
      // silent
    }
  }, [sessionId]);

  const fetchComments = useCallback(async () => {
    try {
      const res = await apiGet<{
        success: boolean;
        data: { comments: Array<{ id: string; userId: string; section: string; text: string; createdAt: string }> } | null;
      }>(`/sessions/${sessionId}/comments`);
      setComments(res.data?.comments ?? []);
    } catch {
      // silent
    }
  }, [sessionId]);

  async function handleComment(section: string, text: string) {
    try {
      await apiPost(`/sessions/${sessionId}/comments`, { section, text });
      await fetchComments();
    } catch {
      // silent
    }
  }

  useEffect(() => {
    void refreshSession();
    void fetchRounds();
    void fetchComments();
    const timer = setInterval(() => {
      void refreshAnalysis();
      void refreshReactions();
    }, 3000);
    // CG-FR07: Heartbeat to keep session alive server-side
    const heartbeat = setInterval(() => {
      void apiPost(`/sessions/${sessionId}/heartbeat`, {}).catch(() => {});
    }, 60_000);
    return () => { clearInterval(timer); clearInterval(heartbeat); };
  }, [refreshAnalysis, refreshSession, refreshReactions, fetchRounds, fetchComments]);

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

  async function handleReenter() {
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/sessions/${sessionId}/reenter`, {});
      setEditing(true);
      setHasSubmitted(false);
      setFeedbackSaved(false);
      setAnalysis(null);
      setShowComparison(false);
      await refreshSession();
    } catch (reenterError) {
      setError(reenterError instanceof Error ? reenterError.message : "Failed to initiate re-entry");
    } finally {
      setBusy(false);
    }
  }

  const status = useMemo(() => analysis?.status ?? session?.status ?? "draft", [analysis?.status, session?.status]);
  const isLocked = ["queued", "running", "completed"].includes(status);
  const showEditor = !hasSubmitted || editing;
  const policyWarnings = useMemo(() => checkContentPolicy(positionText), [positionText]);
  const deadlinePassed = session?.deadline ? new Date(session.deadline) < new Date() : false;

  async function handleReport() {
    const reason = prompt("Describe the issue (at least 10 characters):");
    if (!reason || reason.length < 10) return;
    try {
      await apiPost(`/moderation/report/${sessionId}`, { reason });
      setReportSent(true);
    } catch {
      setError("Failed to submit report");
    }
  }

  return (
    <section className="grid">
      <article className="card">
        <h1>{session?.topic ?? "Session"}</h1>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <p>Status: <strong>{status}</strong></p>
            {session?.deadline && (
              <p className={deadlinePassed ? "text-muted" : ""}>
                Deadline: {new Date(session.deadline).toLocaleString()}
                {deadlinePassed && " (passed)"}
              </p>
            )}
            {session?.anonymousMode && <p><em>Anonymous mode enabled</em></p>}
          </div>
          <button
            className="secondary"
            onClick={handleReport}
            disabled={reportSent}
            style={{ alignSelf: "flex-start" }}
          >
            {reportSent ? "Reported" : "🚩 Report"}
          </button>
        </div>
      </article>

      <article className="card grid">
        <h2>Your Position</h2>
        {showEditor ? (
          <>
            {!hasSubmitted && (
              <GuidedPrompt onApply={(text) => setPositionText((prev) => prev ? prev + "\n\n" + text : text)} />
            )}
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
              comments={comments}
              onComment={handleComment}
            />

            {/* Re-entry & round comparison controls */}
            <div className="cgm-reentry">
              <button onClick={handleReenter} disabled={busy}>
                {busy ? "Working..." : "Revise & Re-enter"}
              </button>
              {rounds.length > 1 && (
                <button
                  className="secondary"
                  onClick={() => setShowComparison((v) => !v)}
                >
                  {showComparison ? "Hide Round Comparison" : `Compare Rounds (${rounds.length})`}
                </button>
              )}
              {rounds.length <= 1 && (
                <button className="secondary" onClick={fetchRounds} disabled={busy}>
                  Load Round History
                </button>
              )}
            </div>

            {showComparison && rounds.length > 1 && (
              <RoundComparison rounds={rounds} />
            )}

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

  async function downloadExport(format: "json" | "markdown" | "pdf") {
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
      const ext = format === "json" ? "json" : format === "pdf" ? "pdf" : "md";
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
        <button onClick={() => downloadExport("pdf")} disabled={exporting}>
          {exporting ? "Exporting…" : "PDF"}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Round Comparison (CG-FR69)                                         */
/* ------------------------------------------------------------------ */

function RoundComparison({ rounds }: { rounds: RoundSummary[] }) {
  const [selectedA, setSelectedA] = useState(0);
  const [selectedB, setSelectedB] = useState(Math.min(1, rounds.length - 1));

  const roundA = rounds[selectedA];
  const roundB = rounds[selectedB];

  if (!roundA || !roundB) return null;

  return (
    <div className="cgm-round-compare">
      <h3>Round Comparison</h3>
      <div className="cgm-round-compare__selectors">
        <label>
          Left:
          <select value={selectedA} onChange={(e) => setSelectedA(Number(e.target.value))}>
            {rounds.map((r, i) => (
              <option key={r.id} value={i}>Round {r.roundNumber}</option>
            ))}
          </select>
        </label>
        <span className="cgm-round-compare__vs">vs</span>
        <label>
          Right:
          <select value={selectedB} onChange={(e) => setSelectedB(Number(e.target.value))}>
            {rounds.map((r, i) => (
              <option key={r.id} value={i}>Round {r.roundNumber}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="cgm-round-compare__panels">
        <RoundPanel round={roundA} />
        <RoundPanel round={roundB} />
      </div>
    </div>
  );
}

function RoundPanel({ round }: { round: RoundSummary }) {
  return (
    <div className="cgm-round-panel">
      <div className="cgm-round-panel__header">
        <strong>Round {round.roundNumber}</strong>
        <span className="cgm-round-panel__date">
          {new Date(round.createdAt).toLocaleDateString()}
        </span>
      </div>

      <div className="cgm-round-panel__section">
        <h4>Shared Foundations</h4>
        <p>{round.sharedFoundations}</p>
      </div>

      <div className="cgm-round-panel__section">
        <h4>True Disagreements</h4>
        <p>{round.trueDisagreements}</p>
      </div>

      <div className="cgm-round-panel__section">
        <h4>Steelmans</h4>
        {Object.entries(round.steelmans as Record<string, string>).map(([label, text]) => (
          <div key={label} className="cgm-round-panel__steelman">
            <strong>{label}:</strong> <span>{text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
