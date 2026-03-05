"use client";

import { useState } from "react";

const PROMPTS = [
  { label: "Core Claim", hint: "What is the single strongest statement of your position?" },
  { label: "Key Reasons", hint: "What are the 2-3 main reasons you hold this view?" },
  { label: "Evidence", hint: "What evidence or experiences support your position?" },
  { label: "Values", hint: "Which core values (fairness, freedom, safety, etc.) underlie your position?" },
  { label: "Steelman", hint: "What is the strongest argument against your position that you can acknowledge?" },
];

export function GuidedPrompt({ onApply }: { onApply: (text: string) => void }) {
  const [dismissed, setDismissed] = useState(false);
  const [answers, setAnswers] = useState<string[]>(PROMPTS.map(() => ""));

  if (dismissed) return null;

  function apply() {
    const parts = PROMPTS
      .map((p, i) => (answers[i].trim() ? `**${p.label}:** ${answers[i].trim()}` : ""))
      .filter(Boolean);
    onApply(parts.join("\n\n"));
  }

  const hasContent = answers.some((a) => a.trim().length > 0);

  return (
    <div className="guided-prompt">
      <div className="guided-prompt__header">
        <h3>Guided Prompt Framework</h3>
        <button
          type="button"
          className="guided-prompt__dismiss"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss guided prompt"
        >
          ✕
        </button>
      </div>
      <p className="guided-prompt__intro">
        Answer these optional prompts to structure your position. You can dismiss this and write freely.
      </p>
      {PROMPTS.map((prompt, i) => (
        <div key={prompt.label} className="guided-prompt__field">
          <label className="guided-prompt__label">{prompt.label}</label>
          <textarea
            className="guided-prompt__input"
            rows={2}
            placeholder={prompt.hint}
            value={answers[i]}
            onChange={(e) => {
              const next = [...answers];
              next[i] = e.target.value;
              setAnswers(next);
            }}
          />
        </div>
      ))}
      <div className="guided-prompt__actions">
        <button type="button" onClick={apply} disabled={!hasContent}>
          Use in Position
        </button>
        <button type="button" className="secondary" onClick={() => setDismissed(true)}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
