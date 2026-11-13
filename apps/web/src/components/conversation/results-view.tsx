"use client";

import { useId, useState } from "react";

import { labelLetter } from "../../lib/conversation-stage";
import { renderMarkdown } from "./markdown";
import type { AnalysisResult, ReactionValue, ResultsInteraction, SectionComment } from "./types";

/** Who a participant label belongs to, as far as the viewer may know. */
export type LabelOwner = { name: string; mine: boolean };

const DIFFERENCE_KINDS: Record<string, string> = {
  empirical: "Facts",
  value: "Values",
  semantic: "Definitions",
  policy: "Approach",
  procedural: "Approach",
};

function differenceKind(category: string): string {
  return DIFFERENCE_KINDS[category] ?? category.charAt(0).toUpperCase() + category.slice(1).replace(/_/g, " ");
}

/** Each letter has its own ink; after F they repeat. */
export function inkClass(label: string | null | undefined): string {
  const letter = labelLetter(label);
  if (!letter) return "ink-a";
  return `ink-${"abcdef"[(letter.charCodeAt(0) - 97) % 6]}`;
}

export function ResultsView({
  result,
  owners = {},
  interaction,
}: {
  result: AnalysisResult;
  /** Maps "Participant A" to a name; labels without an owner are shown as they are. */
  owners?: Record<string, LabelOwner>;
  /** Reactions and comments; leave out for a read-only view. */
  interaction?: ResultsInteraction;
}) {
  const id = useId();
  const labels = Object.keys(result.steelmans ?? {});
  const differences = Object.entries(result.conflictMap ?? {}).flatMap(([category, items]) =>
    (Array.isArray(items) ? items : [items]).map((text, index) => ({ key: `${category}-${index}`, kind: differenceKind(category), text })),
  );
  const everyone = labels.length > 2 ? "all of you" : "both of you";

  return (
    <div className="results">
      <section className="results__section" aria-labelledby={`${id}-agree`}>
        <h2 id={`${id}-agree`}>Where you agree</h2>
        <p className="section-help">The ground {everyone} stand on.</p>
        <div className="agree-sheet">
          <p>{renderMarkdown(result.sharedFoundations)}</p>
        </div>
        {interaction && (
          <SectionResponse
            section="sharedFoundations"
            question="Is this common ground for you?"
            options={[["represents", "Yes"], ["neutral", "Partly"], ["misrepresents", "No"]]}
            interaction={interaction}
          />
        )}
        {interaction && <CommentThread section="sharedFoundations" interaction={interaction} />}
      </section>

      <section className="results__section" aria-labelledby={`${id}-differ`}>
        <h2 id={`${id}-differ`}>Where you differ</h2>
        <p className="section-help">What is left once misunderstandings are cleared up.</p>
        <div className="differ-block">
          <p>{renderMarkdown(result.trueDisagreements)}</p>
        </div>
        {differences.length > 0 && (
          <ul className="difference-list" aria-label="Kinds of difference">
            {differences.map((difference) => (
              <li key={difference.key}>
                <span className="kind-chip">{difference.kind}</span>
                <span>{renderMarkdown(difference.text)}</span>
              </li>
            ))}
          </ul>
        )}
        {interaction && (
          <SectionResponse
            section="trueDisagreements"
            question="Does this describe the difference fairly?"
            options={[["represents", "Yes"], ["neutral", "Partly"], ["misrepresents", "No"]]}
            interaction={interaction}
          />
        )}
        {interaction && <CommentThread section="trueDisagreements" interaction={interaction} />}
      </section>

      <section className="results__section" aria-labelledby={`${id}-restated`}>
        <h2 id={`${id}-restated`}>How each view was restated</h2>
        <p className="section-help">Each perspective in its clearest, fairest form.</p>
        <div className="restated-grid">
          {labels.map((label) => {
            const owner = owners[label];
            const mine = owner?.mine || interaction?.myLabel === label;
            const section = `steelman:${label}`;
            return (
              <article key={label} className={`restated ${inkClass(label)}`}>
                <h3>
                  <span className="ink-dot" aria-hidden="true" />
                  {mine ? "Your view, restated" : `${owner?.name ?? label}'s view, restated`}
                </h3>
                <p>{renderMarkdown(result.steelmans[label])}</p>
                {interaction && (
                  mine ? (
                    <SectionResponse
                      section={section}
                      question="Is this what you meant?"
                      options={[["represents", "Yes"], ["misrepresents", "Not quite"]]}
                      interaction={interaction}
                    />
                  ) : (
                    <SectionResponse
                      section={section}
                      question={`Do you understand ${owner?.name ?? label}'s view?`}
                      options={[["represents", "I understand this view"], ["neutral", "Not sure yet"]]}
                      interaction={interaction}
                      hideQuestion
                    />
                  )
                )}
                {interaction && <CommentThread section={section} interaction={interaction} />}
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function SectionResponse({
  section,
  question,
  options,
  interaction,
  hideQuestion = false,
}: {
  section: string;
  question: string;
  options: Array<[ReactionValue, string]>;
  interaction: ResultsInteraction;
  hideQuestion?: boolean;
}) {
  const current = interaction.myReactions[section];
  const error = interaction.reactionErrors[section];
  return (
    <div className="response">
      <div className="response__row" role="group" aria-label={question}>
        {!hideQuestion && <span className="response__question">{question}</span>}
        {options.map(([value, label]) => (
          <button
            key={value}
            type="button"
            className="toggle"
            aria-pressed={current === value}
            onClick={() => interaction.onReact(section, value)}
          >
            {label}
          </button>
        ))}
      </div>
      {interaction.mutual[section] && <p className="agreed-note">Everyone who answered said yes.</p>}
      {error && <p className="field-error" role="alert">{error}</p>}
    </div>
  );
}

function CommentThread({ section, interaction }: { section: string; interaction: ResultsInteraction }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const inputId = useId();
  const threadId = useId();
  const comments: SectionComment[] = interaction.comments.filter((item) => item.section === section);
  const error = interaction.commentErrors[section];

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    const saved = await interaction.onComment(section, text);
    if (!saved) setDraft(text);
  }

  return (
    <div className="comments">
      <button
        type="button"
        className="link-button"
        aria-expanded={open}
        aria-controls={threadId}
        onClick={() => setOpen((value) => !value)}
      >
        {comments.length === 0 ? "Add a comment" : comments.length === 1 ? "1 comment" : `${comments.length} comments`}
      </button>
      {open && (
        <div className="comments__thread" id={threadId}>
          {comments.length > 0 && (
            <ul className="comments__list">
              {comments.map((item) => (
                <li key={item.id} className={item.pending ? "is-pending" : undefined}>
                  <span className="comments__author">{interaction.authorName(item)}</span>
                  <span>{item.text}</span>
                  <span className="comments__date">
                    {item.pending ? "Posting" : new Date(item.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <form className="comments__form" onSubmit={submit}>
            <label htmlFor={inputId} className="visually-hidden">Your comment</label>
            <input
              id={inputId}
              type="text"
              maxLength={2000}
              placeholder="Write a comment"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
            <button type="submit" className="secondary" disabled={!draft.trim()}>Post comment</button>
          </form>
          {error && <p className="field-error" role="alert">{error}</p>}
        </div>
      )}
    </div>
  );
}
