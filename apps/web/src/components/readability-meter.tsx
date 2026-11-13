"use client";

import { useMemo } from "react";

function estimateSyllables(word: string): number {
  const cleaned = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!cleaned) return 1;
  const matches = cleaned.match(/[aeiouy]+/g);
  return Math.max(matches?.length ?? 1, 1);
}

function fleschLabel(score: number): string {
  if (score >= 80) return "Very easy to read";
  if (score >= 60) return "Easy to read";
  if (score >= 40) return "Fairly easy to read";
  if (score >= 20) return "Hard to read";
  return "Very hard to read";
}

export function ReadabilityMeter({ text }: { text: string }) {
  const { charCount, wordCount, score } = useMemo(() => {
    const words = text.trim().split(/\s+/).filter(Boolean);
    const sentences = text.split(/[.!?]+/).filter((item) => item.trim().length > 0);
    const syllables = words.reduce((sum, word) => sum + estimateSyllables(word), 0);

    const wc = words.length;
    const sc = Math.max(sentences.length, 1);

    const flesch = wc > 0
      ? 206.835 - 1.015 * (wc / sc) - 84.6 * (syllables / Math.max(wc, 1))
      : 0;

    return {
      charCount: text.length,
      wordCount: wc,
      score: Number.isFinite(flesch) ? Math.round(Math.max(0, Math.min(100, flesch))) : 0,
    };
  }, [text]);

  const charPct = Math.min(100, (charCount / 5000) * 100);
  const tooShort = charCount < 100;
  const nearLimit = charCount > 4500;
  const readLabel = fleschLabel(score);

  return (
    <div className="text-meter" aria-live="polite">
      <div className="text-meter__count">
        <span>{charCount.toLocaleString()} of 5,000 characters</span>
        <div className="text-meter__bar" aria-hidden="true">
          <div
            className={`text-meter__fill${tooShort ? " text-meter__fill--short" : nearLimit ? " text-meter__fill--near" : ""}`}
            style={{ width: `${charPct}%` }}
          />
        </div>
        {charCount > 0 && tooShort && <span className="text-meter__hint">{100 - charCount} more to reach the minimum of 100</span>}
      </div>
      <span>{wordCount} {wordCount === 1 ? "word" : "words"}</span>
      {wordCount > 0 && <span>{readLabel}</span>}
    </div>
  );
}
