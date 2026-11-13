"use client";

import { useId, useState } from "react";

import { apiPost } from "../../lib-api";
import type { ModerationSla } from "./use-conversation";

const JOURNEY_STEPS = ["Set up", "Perspectives", "Analysis", "Common ground"];

function ConversationJourney({ status }: { status: string }) {
  const activeStep = status === "completed"
    ? 3
    : ["queued", "running", "failed", "needs_input"].includes(status) ? 2 : 1;

  return (
    <ol className="journey" aria-label="Conversation progress">
      {JOURNEY_STEPS.map((label, index) => (
        <li
          key={label}
          className={index < activeStep ? "is-complete" : index === activeStep ? "is-current" : undefined}
          aria-current={index === activeStep ? "step" : undefined}
        >
          <span className="journey__marker" aria-hidden="true" />
          <span>{label}</span>
          {index < activeStep && <span className="visually-hidden"> (done)</span>}
        </li>
      ))}
    </ol>
  );
}

export function ConversationHeader({
  sessionId,
  topic,
  status,
  deadline,
  anonymous,
  roundNote,
  moderationSla,
}: {
  sessionId: string;
  topic: string;
  status: string;
  deadline: string | null;
  anonymous: boolean;
  roundNote: string | null;
  /** Only loaded for moderators and administrators. */
  moderationSla: ModerationSla | null;
}) {
  const deadlinePassed = deadline ? new Date(deadline) < new Date() : false;

  return (
    <header className="conversation-header">
      <div className="conversation-header__top">
        <h1>{topic}</h1>
        <ReportControl sessionId={sessionId} />
      </div>
      <div className="conversation-header__meta">
        {roundNote && <span>{roundNote}</span>}
        {anonymous && <span>Anonymous: nobody sees who wrote what</span>}
        {deadline && (
          <span>
            {deadlinePassed ? "Perspectives closed on " : "Perspectives close on "}
            {new Date(deadline).toLocaleString(undefined, { day: "numeric", month: "long", hour: "numeric", minute: "2-digit" })}
          </span>
        )}
      </div>
      {moderationSla && moderationSla.summary.pendingCount > 0 && (
        <p className={`notice ${moderationSla.summary.breachedCount > 0 ? "notice--error" : "notice--warn"}`}>
          Moderation: {moderationSla.summary.pendingCount} {moderationSla.summary.pendingCount === 1 ? "report" : "reports"} waiting
          {moderationSla.summary.breachedCount > 0 ? `, ${moderationSla.summary.breachedCount} past the review target` : ""}.
        </p>
      )}
      <ConversationJourney status={status} />
    </header>
  );
}

/** CG-FR53: anyone taking part can report the conversation to a moderator. */
function ReportControl({ sessionId }: { sessionId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  const fieldId = useId();

  if (state === "sent") {
    return <p className="report-sent" role="status">Report sent. A moderator will review it.</p>;
  }

  async function send(event: React.FormEvent) {
    event.preventDefault();
    setState("sending");
    setError(null);
    try {
      await apiPost(`/moderation/report/${sessionId}`, { reason: reason.trim() });
      setState("sent");
    } catch (sendError) {
      setState("idle");
      setError(sendError instanceof Error ? sendError.message : "The report was not sent. Try again.");
    }
  }

  return (
    <div className="report">
      {!open ? (
        <button type="button" className="link-button" onClick={() => setOpen(true)} aria-label="Report this conversation">
          Report
        </button>
      ) : (
        <form className="report__form" onSubmit={send}>
          <label htmlFor={fieldId}>What is wrong?</label>
          <textarea
            id={fieldId}
            rows={3}
            minLength={10}
            maxLength={1000}
            required
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            aria-describedby={`${fieldId}-help`}
          />
          <p id={`${fieldId}-help`} className="field__help">At least 10 characters. A moderator reads every report.</p>
          {error && <p className="field-error" role="alert">{error}</p>}
          <div className="form-actions">
            <button type="submit" disabled={state === "sending" || reason.trim().length < 10}>
              {state === "sending" ? "Sending" : "Send report"}
            </button>
            <button type="button" className="link-button" onClick={() => { setOpen(false); setError(null); }}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
