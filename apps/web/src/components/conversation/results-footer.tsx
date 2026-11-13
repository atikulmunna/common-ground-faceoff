"use client";

import { useId, useState } from "react";

import { apiPost } from "../../lib-api";
import { getPublicApiBaseUrl } from "../../lib/api-base";
import { renderMarkdown } from "./markdown";
import type { RoundSummary } from "./types";

export function ResultsActions({
  sessionId,
  nextRound,
  canStartRound,
  canShare,
  canExport,
  busy,
  onStartRound,
}: {
  sessionId: string;
  nextRound: number;
  canStartRound: boolean;
  canShare: boolean;
  canExport: boolean;
  busy: boolean;
  onStartRound: () => void;
}) {
  if (!canStartRound && !canShare && !canExport) return null;
  return (
    <section className="results-actions" aria-label="What to do next">
      {canStartRound && (
        <div className="results-actions__round">
          <button type="button" className="button-go" onClick={onStartRound} disabled={busy}>
            {busy ? "Opening the next round" : `Start round ${nextRound}`}
          </button>
          <p className="field__help">Everyone can revise their perspective, then you find common ground again.</p>
        </div>
      )}
      {canShare && <ShareLink sessionId={sessionId} />}
      {canExport && <ExportLinks sessionId={sessionId} />}
    </section>
  );
}

function ShareLink({ sessionId }: { sessionId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "creating" | "copied">("idle");
  const [error, setError] = useState<string | null>(null);
  const fieldId = useId();

  async function create() {
    setState("creating");
    setError(null);
    try {
      const response = await apiPost<{ data: { shareLink: { token: string } } | null }>(`/sessions/${sessionId}/share-links`, {});
      const token = response?.data?.shareLink.token;
      if (!token) throw new Error("The link was not created. Try again.");
      setUrl(`${window.location.origin}/shared?token=${encodeURIComponent(token)}`);
      setState("idle");
    } catch (createError) {
      setState("idle");
      setError(createError instanceof Error ? createError.message : "The link was not created. Try again.");
    }
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setState("copied");
    } catch {
      setError("Copying is blocked in this browser. Select the link and copy it.");
    }
  }

  return (
    <div className="share-link">
      {!url ? (
        <button type="button" className="link-button" onClick={create} disabled={state === "creating"}>
          {state === "creating" ? "Creating a link" : "Share a read-only link"}
        </button>
      ) : (
        <div className="share-link__ready">
          <label htmlFor={fieldId}>Anyone with this link can read the results, but not your own words.</label>
          <div className="share-link__row">
            <input id={fieldId} type="text" readOnly value={url} onFocus={(event) => event.currentTarget.select()} />
            <button type="button" className="secondary" onClick={copy}>{state === "copied" ? "Copied" : "Copy link"}</button>
          </div>
        </div>
      )}
      {error && <p className="field-error" role="alert">{error}</p>}
    </div>
  );
}

function ExportLinks({ sessionId }: { sessionId: string }) {
  const [exporting, setExporting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function download(format: "json" | "markdown" | "pdf") {
    setExporting(format);
    setError(null);
    try {
      const { getSession } = await import("next-auth/react");
      const session = await getSession();
      const token = session?.user?.accessToken;
      const response = await fetch(`${getPublicApiBaseUrl()}/sessions/${sessionId}/export/${format}`, {
        headers: token ? { authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) throw new Error(`The export failed (${response.status}). Try again.`);

      const blob = await response.blob();
      const extension = format === "json" ? "json" : format === "pdf" ? "pdf" : "md";
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = `common-ground-${sessionId}.${extension}`;
      anchor.click();
      URL.revokeObjectURL(href);
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : "The export failed. Try again.");
    } finally {
      setExporting(null);
    }
  }

  return (
    <div className="export" role="group" aria-label="Export the results">
      <span className="export__label">Export as</span>
      {([["json", "JSON"], ["markdown", "Markdown"], ["pdf", "PDF"]] as const).map(([format, label]) => (
        <button key={format} type="button" className="secondary" onClick={() => download(format)} disabled={exporting !== null}>
          {label}
        </button>
      ))}
      {exporting && <span className="field__help" role="status">Preparing the file</span>}
      {error && <p className="field-error" role="alert">{error}</p>}
    </div>
  );
}

const SCALES = [
  { key: "faithfulness", question: "Did the restated views say what people meant?" },
  { key: "neutrality", question: "Did the summary avoid taking sides?" },
] as const;

export function FeedbackPanel({
  onSubmit,
  saved,
}: {
  onSubmit: (faithfulness: number, neutrality: number, comment: string) => Promise<void>;
  saved: boolean;
}) {
  const [scores, setScores] = useState({ faithfulness: 0, neutrality: 0 });
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const commentId = useId();

  if (saved) {
    return <p className="notice notice--ok" role="status">Thanks. Your feedback was sent.</p>;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit(scores.faithfulness, scores.neutrality, comment);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Your feedback was not sent. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel feedback" aria-labelledby="feedback-heading">
      <h2 id="feedback-heading">Was this fair?</h2>
      <p className="section-help">Your answers help improve how perspectives are restated.</p>
      <form onSubmit={submit} className="form-stack">
        {SCALES.map((scale) => (
          <div key={scale.key} className="scale" role="group" aria-label={scale.question}>
            <span className="scale__question">{scale.question}</span>
            <div className="scale__options">
              <span className="scale__end" aria-hidden="true">Not at all</span>
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  type="button"
                  className="scale__option"
                  aria-pressed={scores[scale.key] === value}
                  aria-label={`${value} out of 5`}
                  onClick={() => setScores((current) => ({ ...current, [scale.key]: value }))}
                >
                  {value}
                </button>
              ))}
              <span className="scale__end" aria-hidden="true">Completely</span>
            </div>
          </div>
        ))}
        <div className="field">
          <label htmlFor={commentId}>Anything else? (optional)</label>
          <textarea id={commentId} rows={2} value={comment} onChange={(event) => setComment(event.target.value)} />
        </div>
        {error && <p className="field-error" role="alert">{error}</p>}
        <div className="form-actions">
          <button type="submit" disabled={busy || scores.faithfulness === 0 || scores.neutrality === 0}>
            {busy ? "Sending" : "Send feedback"}
          </button>
        </div>
      </form>
    </section>
  );
}

/** CG-FR69: earlier rounds side by side. */
export function RoundHistory({ rounds }: { rounds: RoundSummary[] }) {
  const [left, setLeft] = useState(Math.max(0, rounds.length - 2));
  const [right, setRight] = useState(rounds.length - 1);
  const leftRound = rounds[left];
  const rightRound = rounds[right];
  if (rounds.length < 2 || !leftRound || !rightRound) return null;

  return (
    <details className="round-history">
      <summary>Compare rounds</summary>
      <div className="round-history__pickers">
        <label>
          Round
          <select value={left} onChange={(event) => setLeft(Number(event.target.value))}>
            {rounds.map((round, index) => <option key={round.id} value={index}>{round.roundNumber}</option>)}
          </select>
        </label>
        <span>with round</span>
        <label>
          <span className="visually-hidden">Round</span>
          <select value={right} onChange={(event) => setRight(Number(event.target.value))}>
            {rounds.map((round, index) => <option key={round.id} value={index}>{round.roundNumber}</option>)}
          </select>
        </label>
      </div>
      <div className="round-history__panels">
        {[leftRound, rightRound].map((round, index) => (
          <article key={`${round.id}-${index}`} className="round-panel">
            <h3>Round {round.roundNumber}</h3>
            <h4>Where you agreed</h4>
            <p>{renderMarkdown(round.sharedFoundations)}</p>
            <h4>Where you differed</h4>
            <p>{renderMarkdown(round.trueDisagreements)}</p>
          </article>
        ))}
      </div>
    </details>
  );
}
