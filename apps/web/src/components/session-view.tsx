"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";

import { ReadabilityMeter } from "./readability-meter";
import { CommonGroundMap } from "./common-ground-map";
import { GuidedPrompt } from "./guided-prompt";
import { apiGet, apiPost } from "../lib-api";
import { checkContentPolicy } from "../lib/content-policy";

/** Lightweight inline-markdown renderer: **bold**, *italic*, \n → <br/> */
function renderMarkdown(text: string): React.ReactNode[] {
  return text.split(/\n/).flatMap((line, li, lines) => {
    const parts: React.ReactNode[] = [];
    const regex = /(\*\*(.+?)\*\*|\*(.+?)\*)/g;
    let lastIndex = 0;
    let match;
    while ((match = regex.exec(line)) !== null) {
      if (match.index > lastIndex) {
        parts.push(line.slice(lastIndex, match.index));
      }
      if (match[2]) {
        parts.push(<strong key={`${li}-b-${match.index}`}>{match[2]}</strong>);
      } else if (match[3]) {
        parts.push(<em key={`${li}-i-${match.index}`}>{match[3]}</em>);
      }
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < line.length) {
      parts.push(line.slice(lastIndex));
    }
    if (li < lines.length - 1) {
      parts.push(<br key={`br-${li}`} />);
    }
    return parts;
  });
}

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
  creatorUserId: string;
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
    estimatedCompletionAt: string | null;
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

type ModerationSlaData = {
  summary: {
    pendingCount: number;
    breachedCount: number;
    nextDueAt: string | null;
  };
  flags: Array<{
    id: string;
    severity: "low" | "medium" | "high" | "critical";
    status: string;
    createdAt: string;
    reviewedAt: string | null;
    slaDueAt: string | null;
    sla: {
      targetMinutes: number;
      isBreached: boolean;
      remainingSeconds: number | null;
    };
  }>;
};

export function SessionView({ sessionId }: { sessionId: string }) {
  const { data: authSession, status: authStatus } = useSession();
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
  const [moderationSla, setModerationSla] = useState<ModerationSlaData | null>(null);

  // CG-NFR08: Persist draft position text in localStorage across refreshes
  const draftKey = `cg-draft-${sessionId}`;
  useEffect(() => {
    const saved = localStorage.getItem(draftKey);
    if (saved && !hasSubmitted) setPositionText(saved);
  }, [draftKey, hasSubmitted]);

  function updatePositionText(text: string) {
    setPositionText(text);
    if (!hasSubmitted) {
      localStorage.setItem(draftKey, text);
    }
  }

  function clearDraft() {
    localStorage.removeItem(draftKey);
  }

  const refreshSession = useCallback(async () => {
    try {
      const response = await apiGet<SessionResponse>(`/sessions/${sessionId}`);
      setSession(response.data?.session ?? null);
      setError(null);
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

  const fetchModerationSla = useCallback(async () => {
    try {
      const res = await apiGet<{ success: boolean; data: ModerationSlaData | null }>(`/moderation/session/${sessionId}/sla`);
      setModerationSla(res.data ?? null);
    } catch {
      // silent for non-critical polling
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
    if (authStatus === "loading") return;

    void refreshSession();
    void fetchRounds();
    void fetchComments();
    void fetchModerationSla();
    const timer = setInterval(() => {
      void refreshAnalysis();
      void refreshReactions();
      void fetchModerationSla();
    }, 3000);

    // CG-FR07: Session inactivity should reflect real user activity.
    // Send heartbeat only on user activity, throttled to once per minute.
    let lastHeartbeatAt = 0;
    const sendHeartbeat = () => {
      const now = Date.now();
      if (now - lastHeartbeatAt < 60_000) return;
      lastHeartbeatAt = now;
      void apiPost(`/sessions/${sessionId}/heartbeat`, {}).catch(() => {});
    };

    sendHeartbeat(); // mark active on initial page view

    const activityEvents = ["mousedown", "keydown", "scroll", "touchstart"] as const;
    for (const event of activityEvents) {
      window.addEventListener(event, sendHeartbeat, { passive: true });
    }

    return () => {
      clearInterval(timer);
      for (const event of activityEvents) {
        window.removeEventListener(event, sendHeartbeat);
      }
    };
  }, [authStatus, sessionId, refreshAnalysis, refreshSession, refreshReactions, fetchRounds, fetchComments, fetchModerationSla]);

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
      clearDraft();
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
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 300_000); // 5 min timeout
      await apiPost(`/sessions/${sessionId}/analyze`, {
        analysisVersion: "v1",
        promptTemplateVersion: "tpl-v1"
      }, undefined, controller.signal);
      clearTimeout(timeoutId);
      await refreshAnalysis();
    } catch (analyzeError) {
      if (analyzeError instanceof DOMException && analyzeError.name === "AbortError") {
        setError("Analysis is taking too long. Please refresh and try again.");
      } else {
        setError(analyzeError instanceof Error ? analyzeError.message : "Failed to analyze");
      }
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
            {moderationSla?.summary.pendingCount ? (
              <p style={{ color: moderationSla.summary.breachedCount > 0 ? "#b91c1c" : "#92400e" }}>
                Moderation SLA: {moderationSla.summary.pendingCount} pending
                {moderationSla.summary.breachedCount > 0 ? `, ${moderationSla.summary.breachedCount} overdue` : ""}
              </p>
            ) : null}
          </div>
          <button
            className="secondary"
            onClick={handleReport}
            disabled={reportSent}
            style={{ alignSelf: "flex-start" }}
            aria-label="Report this session"
          >
            {reportSent ? "Reported" : "🚩 Report"}
          </button>
        </div>
      </article>

      {/* CG-FR10: Email invitation panel (visible to session creator before analysis) */}
      {session && !isLocked && session.participants.some(
        (p) => p.userId === currentUserId && p.role === "session_creator"
      ) && (
        <InvitePanel sessionId={sessionId} />
      )}

      <article className="card grid">
        <h2>Your Position</h2>
        {showEditor ? (
          <>
            {!hasSubmitted && (
              <GuidedPrompt onApply={(text) => updatePositionText(positionText ? positionText + "\n\n" + text : text)} />
            )}
            <textarea
              rows={8}
              minLength={100}
              maxLength={5000}
              placeholder="Submit your position in 100-5000 characters"
              value={positionText}
              onChange={(event) => updatePositionText(event.target.value)}
            />
            <ReadabilityMeter text={positionText} />
            {policyWarnings.length > 0 && (
              <div className="cgm-policy-warnings" role="alert">
                {policyWarnings.map((w) => (
                  <p key={w.category} className="cgm-policy-warning">
                    ⚠ {w.message}
                  </p>
                ))}
              </div>
            )}
            <div style={{ display: "flex", gap: "0.8rem" }}>
              <button
                onClick={() => {
                  // CG-FR19: Require explicit confirmation if content policy warnings exist
                  if (policyWarnings.length > 0) {
                    const confirmed = window.confirm(
                      "Your text has content policy warnings. Are you sure you want to submit?"
                    );
                    if (!confirmed) return;
                  }
                  submitPosition();
                }}
                disabled={busy || positionText.length < 100}
                aria-label={hasSubmitted ? "Save position changes" : "Submit your position"}
              >
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
            <div style={{ display: "flex", gap: "0.8rem", alignItems: "center" }}>
              {!isLocked && (
                <button onClick={() => setEditing(true)}>Edit Position</button>
              )}
              {currentUserId === session?.creatorUserId ? (
                <button className="secondary" onClick={triggerAnalysis} disabled={busy || isLocked}>
                  {isLocked ? "Analysis Started" : "Trigger Analysis"}
                </button>
              ) : (
                <span style={{ fontSize: "0.9rem", color: "#6b7280", fontStyle: "italic" }}>
                  {isLocked ? "Analysis in progress…" : "Waiting for the session creator to trigger the analysis."}
                </span>
              )}
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
          <AnalysisStatus status={status} estimatedCompletionAt={analysis?.estimatedCompletionAt ?? null} />
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

function AnalysisStatus({ status, estimatedCompletionAt }: { status: string; estimatedCompletionAt: string | null }) {
  const info = STATUS_MESSAGES[status] ?? { label: status, description: "" };
  const isActive = status === "queued" || status === "running";

  // CG-FR57: Compute remaining time for async ETA
  const [etaLabel, setEtaLabel] = useState<string | null>(null);
  useEffect(() => {
    if (!estimatedCompletionAt || !isActive) {
      setEtaLabel(null);
      return;
    }
    function updateEta() {
      const remaining = Math.max(0, Math.ceil((new Date(estimatedCompletionAt!).getTime() - Date.now()) / 1000));
      if (remaining <= 0) {
        setEtaLabel("completing soon…");
      } else if (remaining < 60) {
        setEtaLabel(`~${remaining}s remaining`);
      } else {
        setEtaLabel(`~${Math.ceil(remaining / 60)}min remaining`);
      }
    }
    updateEta();
    const timer = setInterval(updateEta, 5000);
    return () => clearInterval(timer);
  }, [estimatedCompletionAt, isActive]);

  return (
    <div className="cgm-status" role="status" aria-live="polite">
      <div className="cgm-status__icon" aria-hidden="true">{isActive ? "⏳" : "📋"}</div>
      <h2 className="cgm-status__label">{info.label}</h2>
      <p className="cgm-status__desc">{info.description}</p>
      {isActive && etaLabel && (
        <p className="cgm-status__eta">{etaLabel}</p>
      )}
      {isActive && <div className="cgm-status__pulse" aria-hidden="true" />}
    </div>
  );
}

function FeedbackPanel({
  onSubmit,
  saved,
}: {
  onSubmit: (faithfulness: number, neutrality: number, comment: string) => Promise<void>;
  saved: boolean;
}) {
  const [faithfulness, setFaithfulness] = useState(0);
  const [neutrality, setNeutrality] = useState(0);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

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
      {submitError ? <p style={{ color: "#b91c1c", margin: 0 }}>{submitError}</p> : null}
      <button
        onClick={async () => {
          setBusy(true);
          setSubmitError(null);
          try {
            await onSubmit(faithfulness, neutrality, comment);
          } catch (e) {
            setSubmitError(e instanceof Error ? e.message : "Failed to submit feedback");
          } finally {
            setBusy(false);
          }
        }}
        disabled={busy || faithfulness === 0 || neutrality === 0}
      >
        {busy ? "Submitting..." : "Submit Feedback"}
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
  const [exportError, setExportError] = useState<string | null>(null);

  async function downloadExport(format: "json" | "markdown" | "pdf") {
    setExporting(true);
    setExportError(null);
    try {
      const { getSession } = await import("next-auth/react");
      const session = await getSession();
      const token = session?.user?.accessToken;
      const base = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4100";
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
    } catch (e) {
      setExportError(e instanceof Error ? e.message : "Export failed");
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
      {exportError ? <p style={{ color: "#b91c1c", margin: 0 }}>{exportError}</p> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  CG-FR10/13: Email Invitation Panel                                 */
/* ------------------------------------------------------------------ */

function InvitePanel({ sessionId }: { sessionId: string }) {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;
    setSending(true);
    setResult(null);
    try {
      await apiPost(`/sessions/${sessionId}/email-invite`, {
        email,
        message: message || undefined,
      });
      setResult(`Invitation sent to ${email}`);
      setEmail("");
      setMessage("");
    } catch (err) {
      setResult(err instanceof Error ? err.message : "Failed to send invitation");
    } finally {
      setSending(false);
    }
  }

  return (
    <article className="card grid">
      <h3>Invite Participant</h3>
      <form onSubmit={handleInvite} className="cgm-invite-form">
        <label htmlFor="invite-email">Email address</label>
        <input
          id="invite-email"
          type="email"
          placeholder="participant@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          aria-label="Participant email address"
        />
        <label htmlFor="invite-message">Message (optional)</label>
        <input
          id="invite-message"
          type="text"
          placeholder="Add a personal message…"
          maxLength={500}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          aria-label="Personal message for invitation"
        />
        <button type="submit" disabled={sending || !email}>
          {sending ? "Sending…" : "Send Invitation"}
        </button>
      </form>
      {result && <p className="cgm-invite-result">{result}</p>}
    </article>
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
        <p>{renderMarkdown(round.sharedFoundations)}</p>
      </div>

      <div className="cgm-round-panel__section">
        <h4>True Disagreements</h4>
        <p>{renderMarkdown(round.trueDisagreements)}</p>
      </div>

      <div className="cgm-round-panel__section">
        <h4>Steelmans</h4>
        {Object.entries(round.steelmans as Record<string, string>).map(([label, text]) => (
          <div key={label} className="cgm-round-panel__steelman">
            <strong>{label}:</strong> <span>{renderMarkdown(text)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
