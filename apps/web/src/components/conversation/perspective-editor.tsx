"use client";

import { useMemo, useState } from "react";

import { checkContentPolicy } from "../../lib/content-policy";
import { GuidedPrompt } from "../guided-prompt";
import { ReadabilityMeter } from "../readability-meter";

export function PerspectiveEditor({
  text,
  onChange,
  changeMind = "",
  onChangeMindChange = () => {},
  hasSubmitted,
  editing,
  onEdit,
  onCancel,
  onSubmit,
  busy,
  deadlinePassed,
  removedByModerator,
  anonymous,
  carryNote = null,
}: {
  text: string;
  onChange: (text: string) => void;
  /** Optional answer to "What could change your mind?". */
  changeMind?: string;
  onChangeMindChange?: (text: string) => void;
  hasSubmitted: boolean;
  editing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSubmit: () => void;
  busy: boolean;
  deadlinePassed: boolean;
  removedByModerator: boolean;
  anonymous: boolean;
  /** What the viewer said their restated view missed last round. */
  carryNote?: { round: number; text: string } | null;
}) {
  const [confirmingWarnings, setConfirmingWarnings] = useState(false);
  const warnings = useMemo(() => checkContentPolicy(text), [text]);
  const showEditor = !hasSubmitted || editing;
  const tooShort = text.length < 100;

  if (!showEditor) {
    return (
      <section className="panel" aria-labelledby="mine-heading">
        <h2 id="mine-heading">Your perspective</h2>
        <blockquote className="own-words">{text}</blockquote>
        {changeMind && (
          <p className="own-change-mind"><strong>What could change your mind:</strong> {changeMind}</p>
        )}
        {deadlinePassed ? (
          <p className="field__help">The deadline has passed, so perspectives can no longer change.</p>
        ) : (
          <button type="button" className="secondary" onClick={onEdit}>Edit perspective</button>
        )}
      </section>
    );
  }

  function handleSubmit() {
    // CG-FR19: content warnings need an explicit second step before submitting.
    if (warnings.length > 0 && !confirmingWarnings) {
      setConfirmingWarnings(true);
      return;
    }
    setConfirmingWarnings(false);
    onSubmit();
  }

  return (
    <section className="panel" aria-labelledby="write-heading">
      <h2 id="write-heading">Share your perspective</h2>
      <p className="section-help">
        Say what you believe, why it matters to you, and what could change your mind.{" "}
        {anonymous
          ? "Nobody else sees your own words; they see the restated version in the results."
          : "Nobody else sees it until the results are ready."}
      </p>

      {removedByModerator && (
        <p className="notice notice--warn" role="alert">
          A moderator removed your perspective. Please write it again; the analysis will wait until you do.
        </p>
      )}

      {carryNote && !deadlinePassed && (
        <div className="notice carry-note">
          <p>In round {carryNote.round} you said your restated view missed: &ldquo;{carryNote.text}&rdquo;</p>
          {!text.includes(carryNote.text) && (
            <button type="button" className="link-button" onClick={() => onChange(text ? `${text}\n\n${carryNote.text}` : carryNote.text)}>
              Add it to my perspective
            </button>
          )}
        </div>
      )}

      {deadlinePassed ? (
        <p className="notice notice--warn">The deadline has passed, so perspectives can no longer be added or changed.</p>
      ) : (
        <>
          {!hasSubmitted && <GuidedPrompt onApply={(addition) => onChange(text ? `${text}\n\n${addition}` : addition)} />}
          <div className="field">
            <label htmlFor="perspective">Your perspective</label>
            <textarea
              id="perspective"
              rows={9}
              minLength={100}
              maxLength={5000}
              placeholder="What do you think, and why?"
              value={text}
              onChange={(event) => { onChange(event.target.value); setConfirmingWarnings(false); }}
            />
            <ReadabilityMeter text={text} />
          </div>

          <div className="field">
            <label htmlFor="change-mind">What could change your mind? (optional)</label>
            <textarea
              id="change-mind"
              rows={3}
              maxLength={1000}
              placeholder="For example, a fact or a result that would make you think again."
              value={changeMind}
              onChange={(event) => onChangeMindChange(event.target.value)}
              aria-describedby="change-mind-help"
            />
            <p id="change-mind-help" className="field__help">
              This helps the results say what would settle a difference about facts.{" "}
              {anonymous
                ? "Like your perspective, nobody else sees these words."
                : "Like your perspective, others can read it once the results are ready."}
            </p>
          </div>

          {warnings.length > 0 && (
            <ul className="warnings" role="alert" aria-label="Before you submit">
              {warnings.map((warning) => <li key={warning.category}>{warning.message}</li>)}
            </ul>
          )}

          {confirmingWarnings && (
            <p className="notice notice--warn" role="alert">
              Your text may break the content rules above. Edit it, or submit it anyway.
            </p>
          )}

          <div className="form-actions">
            <button type="button" onClick={handleSubmit} disabled={busy || tooShort}>
              {busy ? "Saving" : confirmingWarnings ? "Submit anyway" : hasSubmitted ? "Save changes" : "Submit your perspective"}
            </button>
            {(hasSubmitted || confirmingWarnings) && (
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  if (confirmingWarnings) setConfirmingWarnings(false);
                  else onCancel();
                }}
              >
                {confirmingWarnings ? "Keep editing" : "Cancel"}
              </button>
            )}
            {tooShort && <span className="field__help">At least 100 characters.</span>}
          </div>
        </>
      )}
    </section>
  );
}
