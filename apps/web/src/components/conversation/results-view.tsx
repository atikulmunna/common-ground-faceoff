"use client";

import { useId, useState } from "react";
import type { GroundedPoint, RoundChanges } from "@common-ground/shared";

import { labelLetter } from "../../lib/conversation-stage";
import { renderMarkdown } from "./markdown";
import type { AnalysisResult, ReactionValue, ResultsInteraction, SectionComment } from "./types";

/** Who a participant label belongs to, as far as the viewer may know. */
export type LabelOwner = { name: string; mine: boolean };

/** Common points shown before "Show more". */
const POINTS_SHOWN = 3;

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

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** "You agree on 3 points and differ on 2." */
function summaryLine(shared: number, differences: number, who: "You" | "They"): string {
  if (shared === 0 && differences === 0) return `${who} found no common point and no clear difference this round.`;
  if (shared === 0) return `No common point held up this round. ${who} differ on ${plural(differences, "point", "points")}.`;
  if (differences === 0) return `${who} agree on ${plural(shared, "point", "points")} and no clear difference remains.`;
  return `${who} agree on ${plural(shared, "point", "points")} and differ on ${differences}.`;
}

export function ResultsView({
  result,
  owners = {},
  interaction,
  audience = "participants",
}: {
  result: AnalysisResult;
  /** Maps "Participant A" to a name; labels without an owner are shown as they are. */
  owners?: Record<string, LabelOwner>;
  /** Reactions and comments; leave out for a read-only view. */
  interaction?: ResultsInteraction;
  /** "public" words the page for someone outside the conversation, such as a share link reader. */
  audience?: "participants" | "public";
}) {
  const id = useId();
  const labels = Object.keys(result.steelmans ?? {});
  const sharedPoints = result.sharedFoundationPoints ?? null;
  const differencePoints = result.disagreementPoints ?? null;
  // Results saved before points were kept only have the joined text.
  const hasPoints = Array.isArray(sharedPoints) && Array.isArray(differencePoints);
  const who = audience === "public" ? "They" : "You";
  const whoLower = who.toLowerCase();
  const everyone = audience === "public"
    ? labels.length > 2 ? "all of them" : "both of them"
    : labels.length > 2 ? "all of you" : "both of you";

  const ownerOf = (label: string) => owners[label] ?? { name: label, mine: interaction?.myLabel === label };
  const fromView = (label: string) => {
    const owner = ownerOf(label);
    return owner.mine ? "From your view" : `From ${owner.name}'s view`;
  };

  return (
    <div className="results">
      {hasPoints && (
        <div className="results__summary">
          <p className="summary-line">{summaryLine(sharedPoints.length, differencePoints.length, who)}</p>
          {result.verification && result.verification.sharedProposed > 0 && (
            <p className="field__help">
              {result.verification.sharedVerified} of {result.verification.sharedProposed} proposed common points held up
              when checked against every restated view.
            </p>
          )}
        </div>
      )}

      {result.roundChanges && <RoundChangesSection id={`${id}-changed`} changes={result.roundChanges} />}

      <section className="results__section" aria-labelledby={`${id}-agree`}>
        <h2 id={`${id}-agree`}>Where {whoLower} agree</h2>
        <p className="section-help">
          {hasPoints
            ? `Each point is backed by words from ${labels.length > 2 ? "every" : "both"} restated view${labels.length > 2 ? "" : "s"}.`
            : `The ground ${everyone} stand on.`}
        </p>
        {hasPoints ? (
          sharedPoints.length > 0 ? (
            <CommonPoints points={sharedPoints} fromView={fromView} />
          ) : (
            <p className="empty-note">No common point held up when checked against every restated view.</p>
          )
        ) : (
          <div className="agree-sheet">
            <p>{renderMarkdown(result.sharedFoundations)}</p>
          </div>
        )}
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
        <h2 id={`${id}-differ`}>Where {whoLower} differ</h2>
        <p className="section-help">What is left once misunderstandings are cleared up.</p>
        {hasPoints ? (
          differencePoints.length > 0 ? (
            <ul className="differences">
              {differencePoints.map((point, index) => (
                <DifferenceCard key={`${index}-${point.statement}`} point={point} ownerOf={ownerOf} />
              ))}
            </ul>
          ) : (
            <p className="empty-note">No clear difference remains.</p>
          )
        ) : (
          <LegacyDifferences result={result} />
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
            const owner = ownerOf(label);
            const section = `steelman:${label}`;
            const values = result.participantValues?.[label] ?? [];
            return (
              <article key={label} className={`restated ${inkClass(label)}`}>
                <h3>
                  <span className="ink-dot" aria-hidden="true" />
                  {owner.mine ? "Your view, restated" : `${owner.name}'s view, restated`}
                </h3>
                <p>{renderMarkdown(result.steelmans[label])}</p>
                {values.length > 0 && (
                  <p className="values">
                    <span className="values__label">{owner.mine ? "What matters to you:" : "What matters to them:"}</span>{" "}
                    {values.map((value) => value.name).join(", ")}
                  </p>
                )}
                {interaction && (
                  owner.mine ? (
                    <>
                      <SectionResponse
                        section={section}
                        question="Is this what you meant?"
                        options={[["represents", "Yes"], ["misrepresents", "Not quite"]]}
                        interaction={interaction}
                        mutualNote="You confirmed it, and everyone else understands it."
                      />
                      {interaction.myReactions[section] === "misrepresents" && (
                        <CorrectionNote section={section} interaction={interaction} />
                      )}
                    </>
                  ) : (
                    <SectionResponse
                      section={section}
                      question={`Do you understand ${owner.name}'s view?`}
                      options={[["represents", "I understand this view"], ["neutral", "Not sure yet"]]}
                      interaction={interaction}
                      hideQuestion
                      mutualNote="Its author confirmed it, and everyone else understands it."
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

/** 4.10: new common ground, and differences that were resolved or narrowed since the last round. */
function RoundChangesSection({ id, changes }: { id: string; changes: RoundChanges }) {
  const nothing = changes.newCommonPoints.length === 0 && changes.resolved.length === 0 && changes.narrowed.length === 0;
  return (
    <section className="results__section" aria-labelledby={id}>
      <h2 id={id}>What changed since round {changes.previousRound}</h2>
      {nothing ? (
        <p className="empty-note">The common points and differences are the same as in round {changes.previousRound}.</p>
      ) : (
        <div className="round-changes">
          {changes.newCommonPoints.length > 0 && (
            <div className="round-changes__group round-changes__group--new">
              <h3>New common ground</h3>
              <ul>{changes.newCommonPoints.map((statement) => <li key={statement}>{statement}</li>)}</ul>
            </div>
          )}
          {changes.resolved.length > 0 && (
            <div className="round-changes__group round-changes__group--resolved">
              <h3>No longer a difference</h3>
              <ul>{changes.resolved.map((statement) => <li key={statement}>{statement}</li>)}</ul>
            </div>
          )}
          {changes.narrowed.length > 0 && (
            <div className="round-changes__group round-changes__group--narrowed">
              <h3>A smaller difference now</h3>
              <ul>
                {changes.narrowed.map((item) => (
                  <li key={item.previous}>
                    <span className="round-changes__was">Was: {item.previous}</span>
                    {item.current && <span>Now: {item.current}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * One card per common point. With two people the quotes sit either side of the shared statement,
 * like two sheets overlapping; with more, they are listed under it and can be opened.
 */
function CommonPoints({ points, fromView }: { points: GroundedPoint[]; fromView: (label: string) => string }) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? points : points.slice(0, POINTS_SHOWN);
  const hidden = points.length - shown.length;

  return (
    <>
      <ol className="common-points">
        {shown.map((point, index) => {
          const pair = point.evidence.length === 2;
          const quotes = point.evidence.map((item) => (
            <blockquote key={item.label} className={`quote ${inkClass(item.label)}`}>
              <span className="quote__source">{fromView(item.label)}</span>
              <span className="quote__text">&ldquo;{item.quote}&rdquo;</span>
            </blockquote>
          ));
          return (
            <li key={`${index}-${point.statement}`} className={`common-point${pair ? " common-point--pair" : ""}`}>
              {pair && quotes[0]}
              <p className="common-point__statement">{point.statement}</p>
              {pair ? quotes[1] : (
                <details className="common-point__quotes">
                  <summary>What each view says</summary>
                  <div className="common-point__quote-list">{quotes}</div>
                </details>
              )}
            </li>
          );
        })}
      </ol>
      {hidden > 0 && (
        <button type="button" className="link-button" onClick={() => setShowAll(true)}>
          {hidden === 1 ? "Show 1 more common point" : `Show ${hidden} more common points`}
        </button>
      )}
    </>
  );
}

function DifferenceCard({ point, ownerOf }: { point: GroundedPoint; ownerOf: (label: string) => LabelOwner }) {
  return (
    <li className="difference">
      <div className="difference__head">
        <h3>{point.statement}</h3>
        {point.category && <span className="kind-chip">{differenceKind(point.category)}</span>}
      </div>
      <div className="difference__sides">
        {point.evidence.map((item) => {
          const owner = ownerOf(item.label);
          return (
            <p key={item.label} className={`side ${inkClass(item.label)}`}>
              <strong>{owner.mine ? "You" : owner.name}:</strong> &ldquo;{item.quote}&rdquo;
            </p>
          );
        })}
      </div>
      {point.settledBy && (
        <p className="settled-by"><strong>What could change minds:</strong> {point.settledBy}</p>
      )}
    </li>
  );
}

/** Results saved before points were kept: the joined text and the classified conflicts. */
function LegacyDifferences({ result }: { result: AnalysisResult }) {
  const differences = Object.entries(result.conflictMap ?? {}).flatMap(([category, items]) =>
    (Array.isArray(items) ? items : [items]).map((text, index) => ({ key: `${category}-${index}`, kind: differenceKind(category), text })),
  );
  return (
    <>
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
    </>
  );
}

function SectionResponse({
  section,
  question,
  options,
  interaction,
  hideQuestion = false,
  mutualNote = "Everyone who answered said yes.",
}: {
  section: string;
  question: string;
  options: Array<[ReactionValue, string]>;
  interaction: ResultsInteraction;
  hideQuestion?: boolean;
  /** Shown once the section is mutually acknowledged. */
  mutualNote?: string;
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
      {interaction.mutual[section] && <p className="agreed-note">{mutualNote}</p>}
      {error && <p className="field-error" role="alert">{error}</p>}
    </div>
  );
}

/**
 * After "Not quite", the author says what the restatement missed. The note is posted as their
 * comment on it, and comes back above their editor when the next round starts.
 */
function CorrectionNote({ section, interaction }: { section: string; interaction: ResultsInteraction }) {
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const fieldId = useId();
  const saved = interaction.comments.find((item) => item.section === section && item.mine);

  if (saved) {
    return (
      <p className="correction-saved">
        Your note: &ldquo;{saved.text}&rdquo; You will see it again when you revise your perspective.
      </p>
    );
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setSaving(true);
    const ok = await interaction.onComment(section, text);
    setSaving(false);
    if (ok) setDraft("");
  }

  return (
    <form className="correction" onSubmit={save}>
      <label htmlFor={fieldId}>What did it miss or get wrong?</label>
      <textarea id={fieldId} rows={3} maxLength={2000} value={draft} onChange={(event) => setDraft(event.target.value)} />
      <p className="field__help">Others in the conversation can read this note.</p>
      {interaction.commentErrors[section] && <p className="field-error" role="alert">{interaction.commentErrors[section]}</p>}
      <div className="form-actions">
        <button type="submit" className="secondary" disabled={saving || !draft.trim()}>{saving ? "Saving" : "Save note"}</button>
      </div>
    </form>
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
