"use client";

import { useState } from "react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface AnalysisResult {
  sharedFoundations: string;
  trueDisagreements: string;
  steelmans: Record<string, string>;
  conflictMap: Record<string, string[]>;
  confidenceScores?: {
    sharedFoundations: number;
    disagreements: number;
  };
}

type ReactionValue = "represents" | "misrepresents" | "neutral";

interface ReactionData {
  /** Map of section key → current user's reaction */
  mine: Record<string, ReactionValue>;
  /** Map of section key → true when all participants agree "represents" */
  mutual: Record<string, boolean>;
}

interface CommonGroundMapProps {
  result: AnalysisResult;
  reactions?: ReactionData;
  onReact?: (section: string, reaction: ReactionValue) => void;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function confidenceLabel(score: number): { text: string; cls: string } {
  if (score >= 0.8) return { text: "High", cls: "cgm-confidence--high" };
  if (score >= 0.5) return { text: "Medium", cls: "cgm-confidence--medium" };
  return { text: "Low", cls: "cgm-confidence--low" };
}

const CONFLICT_LABELS: Record<string, string> = {
  empirical: "Empirical",
  value: "Value-based",
  semantic: "Semantic",
  procedural: "Policy / Procedural",
};

const CONFLICT_ICONS: Record<string, string> = {
  empirical: "🔬",
  value: "⚖️",
  semantic: "💬",
  procedural: "📋",
};

/* ------------------------------------------------------------------ */
/*  Expandable section                                                 */
/* ------------------------------------------------------------------ */

function ExpandableSection({
  title,
  badge,
  defaultOpen = true,
  children,
}: {
  title: string;
  badge?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="cgm-section">
      <button
        type="button"
        className="cgm-section__header"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
      >
        <span className="cgm-section__chevron" data-open={open}>
          ▶
        </span>
        <span className="cgm-section__title">{title}</span>
        {badge && <span className="cgm-section__badge">{badge}</span>}
      </button>
      {open && <div className="cgm-section__body">{children}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Common Ground Map                                                  */
/* ------------------------------------------------------------------ */

export function CommonGroundMap({ result, reactions, onReact }: CommonGroundMapProps) {
  const participants = Object.keys(result.steelmans);
  const conflicts = Object.entries(result.conflictMap);
  const confidence = result.confidenceScores;

  return (
    <div className="cgm">
      {/* ---- Header ---- */}
      <div className="cgm__header">
        <h2 className="cgm__title">Common Ground Map</h2>
        {confidence && (
          <div className="cgm__confidence-row">
            <ConfidenceBadge label="Shared Foundations" score={confidence.sharedFoundations} />
            <ConfidenceBadge label="Disagreements" score={confidence.disagreements} />
          </div>
        )}
      </div>

      {/* ---- Two-column Steelmans ---- */}
      <ExpandableSection title="Steelmanned Positions" defaultOpen={true}>
        <div className="cgm-columns">
          {participants.map((label) => {
            const sectionKey = `steelman:${label}`;
            return (
              <div key={label} className="cgm-columns__panel">
                <div className="cgm-columns__label">{label}</div>
                <p className="cgm-columns__text">{result.steelmans[label]}</p>
                {reactions?.mutual[sectionKey] && (
                  <MutualBadge />
                )}
                {onReact && (
                  <ReactionButtons
                    section={sectionKey}
                    current={reactions?.mine[sectionKey]}
                    onReact={onReact}
                  />
                )}
              </div>
            );
          })}
        </div>
      </ExpandableSection>

      {/* ---- Overlap zone: Shared Foundations ---- */}
      <ExpandableSection
        title="Shared Foundations"
        badge={
          confidence ? (
            <ConfidenceTag score={confidence.sharedFoundations} />
          ) : undefined
        }
        defaultOpen={true}
      >
        <div className="cgm-overlap">
          <p>{result.sharedFoundations}</p>
          {reactions?.mutual["sharedFoundations"] && <MutualBadge />}
          {onReact && (
            <ReactionButtons
              section="sharedFoundations"
              current={reactions?.mine["sharedFoundations"]}
              onReact={onReact}
            />
          )}
        </div>
      </ExpandableSection>

      {/* ---- True Disagreements ---- */}
      <ExpandableSection
        title="True Points of Disagreement"
        badge={
          confidence ? (
            <ConfidenceTag score={confidence.disagreements} />
          ) : undefined
        }
        defaultOpen={true}
      >
        <div className="cgm-disagreements">
          <p>{result.trueDisagreements}</p>
          {reactions?.mutual["trueDisagreements"] && <MutualBadge />}
          {onReact && (
            <ReactionButtons
              section="trueDisagreements"
              current={reactions?.mine["trueDisagreements"]}
              onReact={onReact}
            />
          )}
        </div>
      </ExpandableSection>

      {/* ---- Conflict Map ---- */}
      {conflicts.length > 0 && (
        <ExpandableSection title="Conflict Classification" defaultOpen={false}>
          <div className="cgm-conflicts">
            {conflicts.map(([category, descriptions]) => (
              <div key={category} className="cgm-conflicts__group">
                <h4 className="cgm-conflicts__category">
                  <span>{CONFLICT_ICONS[category] ?? "•"}</span>{" "}
                  {CONFLICT_LABELS[category] ?? category}
                </h4>
                <ul className="cgm-conflicts__list">
                  {descriptions.map((desc, i) => (
                    <li key={i}>{desc}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </ExpandableSection>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Small sub-components                                               */
/* ------------------------------------------------------------------ */

function ConfidenceBadge({ label, score }: { label: string; score: number }) {
  const { text, cls } = confidenceLabel(score);
  return (
    <span className={`cgm-confidence ${cls}`}>
      {label}: {text} ({Math.round(score * 100)}%)
    </span>
  );
}

function ConfidenceTag({ score }: { score: number }) {
  const { text, cls } = confidenceLabel(score);
  return (
    <span className={`cgm-confidence-tag ${cls}`}>
      {text}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Reaction buttons (CG-FR33)                                         */
/* ------------------------------------------------------------------ */

const REACTION_OPTIONS: { value: ReactionValue; emoji: string; label: string }[] = [
  { value: "represents", emoji: "👍", label: "Represents my view" },
  { value: "neutral", emoji: "😐", label: "Neutral" },
  { value: "misrepresents", emoji: "👎", label: "Misrepresents my view" },
];

function ReactionButtons({
  section,
  current,
  onReact,
}: {
  section: string;
  current?: ReactionValue;
  onReact: (section: string, reaction: ReactionValue) => void;
}) {
  return (
    <div className="cgm-reactions">
      {REACTION_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={`cgm-reactions__btn ${current === opt.value ? "cgm-reactions__btn--active" : ""}`}
          onClick={() => onReact(section, opt.value)}
          title={opt.label}
        >
          <span>{opt.emoji}</span>
          <span className="cgm-reactions__label">{opt.label}</span>
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Mutual acknowledgment badge (CG-FR34)                              */
/* ------------------------------------------------------------------ */

function MutualBadge() {
  return (
    <div className="cgm-mutual">
      <span className="cgm-mutual__icon">🤝</span>
      <span className="cgm-mutual__text">Mutually acknowledged</span>
    </div>
  );
}
