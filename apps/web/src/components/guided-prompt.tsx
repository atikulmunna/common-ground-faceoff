"use client";

import { useState } from "react";

const PROMPTS = [
  { label: "Main point", hint: "What do you believe, in one or two sentences?" },
  { label: "Reasons", hint: "What are the two or three main reasons you hold this view?" },
  { label: "Evidence", hint: "What experience or evidence supports it?" },
  { label: "What matters to you", hint: "Which values sit underneath it, such as fairness, freedom or safety?" },
  { label: "The best case against it", hint: "What is the strongest argument against your view that you can accept is fair?" },
];

export function GuidedPrompt({ onApply }: { onApply: (text: string) => void }) {
  const [dismissed, setDismissed] = useState(false);
  const [answers, setAnswers] = useState<string[]>(PROMPTS.map(() => ""));

  if (dismissed) return null;

  function apply() {
    const parts = PROMPTS
      .map((p, i) => {
        const text = answers[i].trim();
        if (!text) return "";
        // Ensure the section ends with sentence-ending punctuation for readability scoring
        const endsWithPunctuation = /[.!?]$/.test(text);
        return `${p.label}: ${text}${endsWithPunctuation ? "" : "."}`;
      })
      .filter(Boolean);
    onApply(parts.join("\n\n"));
  }

  const hasContent = answers.some((a) => a.trim().length > 0);

  return (
    <div className="guided-prompt">
      <div className="guided-prompt__header">
        <h3>Not sure where to start?</h3>
        <button type="button" className="link-button" onClick={() => setDismissed(true)}>
          Write freely instead
        </button>
      </div>
      <p className="field__help">
        Answer any of these and add them to your perspective. Every prompt is optional.
      </p>
      {PROMPTS.map((prompt, i) => (
        <div key={prompt.label} className="field">
          <label htmlFor={`guided-${i}`}>{prompt.label}</label>
          <textarea
            id={`guided-${i}`}
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
      <div className="form-actions">
        <button type="button" className="secondary" onClick={apply} disabled={!hasContent}>
          Add to my perspective
        </button>
      </div>
    </div>
  );
}
