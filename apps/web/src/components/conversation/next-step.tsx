"use client";

import { useEffect, useState } from "react";

import type { PauseReason } from "./types";

/** Why a conversation is waiting (CG-FR51 holds, CG-FR07 inactivity), and who can move it on. */
export function PauseNotice({ status, pause, isCreator }: { status: string; pause: PauseReason | null; isCreator: boolean }) {
  if (pause === "moderation_review") {
    return (
      <p className="notice notice--warn" role="status">
        This conversation is on hold while a moderator reviews reported content. The analysis can start once the review is finished.
      </p>
    );
  }
  if (pause === "awaiting_rewrite") {
    return (
      <p className="notice notice--warn" role="status">
        A moderator removed one perspective. The analysis waits until its author writes it again.
      </p>
    );
  }
  if (status === "failed") {
    return (
      <p className="notice notice--error" role="status">
        The last analysis did not finish. Every perspective is saved.{" "}
        {isCreator ? "Try again when you are ready." : "The host can try again."}
      </p>
    );
  }
  if (status === "needs_input") {
    return (
      <p className="notice notice--warn" role="status">
        This conversation was paused after a long time without activity.{" "}
        {isCreator
          ? "You can still find common ground, or wait for more perspectives."
          : "You can still add or change your perspective."}
      </p>
    );
  }
  return null;
}

export function NextStep({
  isCreator,
  pause,
  submittedCount,
  waitingCount,
  viewerSubmitted,
  busy,
  onAnalyze,
}: {
  isCreator: boolean;
  pause: PauseReason | null;
  submittedCount: number;
  /** People who joined but have not submitted. */
  waitingCount: number;
  viewerSubmitted: boolean;
  busy: boolean;
  onAnalyze: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  if (!isCreator) {
    return (
      <section className="next-step" aria-label="Next step">
        <p>
          {viewerSubmitted ? "Your perspective is in. " : ""}
          The host starts the analysis when everyone is ready.
        </p>
      </section>
    );
  }

  const missing = Math.max(0, 2 - submittedCount);
  const blockedReason = pause
    ? "The analysis can start once the hold above is cleared."
    : missing > 0
      ? `Waiting for ${missing} more ${missing === 1 ? "perspective" : "perspectives"}. At least 2 are needed.`
      : null;

  return (
    <section className="next-step" aria-label="Next step">
      {confirming ? (
        <div className="confirm" role="group" aria-labelledby="confirm-text">
          <p id="confirm-text">
            {waitingCount} {waitingCount === 1 ? "person has" : "people have"} not submitted a perspective yet.
            Find common ground without them?
          </p>
          <div className="form-actions">
            {/* The button that opened this question is gone, so focus moves to the answer. */}
            <button type="button" className="button-go" autoFocus disabled={busy} onClick={() => { setConfirming(false); onAnalyze(); }}>
              Find common ground without them
            </button>
            <button type="button" className="link-button" onClick={() => setConfirming(false)}>Keep waiting</button>
          </div>
        </div>
      ) : (
        <div className="form-actions">
          <button
            type="button"
            className="button-go"
            disabled={busy || Boolean(blockedReason)}
            aria-describedby={blockedReason ? "analyze-blocked" : undefined}
            onClick={() => (waitingCount > 0 ? setConfirming(true) : onAnalyze())}
          >
            {busy ? "Starting" : "Find common ground"}
          </button>
          {blockedReason && <span id="analyze-blocked" className="field__help">{blockedReason}</span>}
        </div>
      )}
    </section>
  );
}

export function AnalysisProgress({ estimatedCompletionAt }: { estimatedCompletionAt: string | null }) {
  const [remainingLabel, setRemainingLabel] = useState<string | null>(null);

  // CG-FR57: a rough time left, updated every few seconds.
  useEffect(() => {
    if (!estimatedCompletionAt) {
      setRemainingLabel(null);
      return;
    }
    function update() {
      const seconds = Math.ceil((new Date(estimatedCompletionAt!).getTime() - Date.now()) / 1000);
      setRemainingLabel(
        seconds <= 0 ? "Almost done."
          : seconds < 60 ? "Less than a minute left."
            : `About ${Math.ceil(seconds / 60)} minutes left.`,
      );
    }
    update();
    const timer = setInterval(update, 5000);
    return () => clearInterval(timer);
  }, [estimatedCompletionAt]);

  return (
    <section className="progress" role="status" aria-live="polite" aria-labelledby="progress-heading">
      <div className="progress__mark" aria-hidden="true">
        <span className="progress__circle progress__circle--first" />
        <span className="progress__circle progress__circle--second" />
      </div>
      <div>
        <h2 id="progress-heading">Finding common ground</h2>
        <p>Each perspective is being restated and compared. You can close this page; the analysis keeps going.</p>
        {remainingLabel && <p className="field__help">{remainingLabel}</p>}
      </div>
    </section>
  );
}
