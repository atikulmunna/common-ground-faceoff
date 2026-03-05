"use client";

import { useMemo } from "react";

function estimateSyllables(word: string): number {
  const cleaned = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!cleaned) return 1;
  const matches = cleaned.match(/[aeiouy]+/g);
  return Math.max(matches?.length ?? 1, 1);
}

function fleschLabel(score: number): { text: string; color: string } {
  if (score >= 80) return { text: "Very Easy", color: "#16a34a" };
  if (score >= 60) return { text: "Easy", color: "#65a30d" };
  if (score >= 40) return { text: "Moderate", color: "#ca8a04" };
  if (score >= 20) return { text: "Difficult", color: "#ea580c" };
  return { text: "Very Difficult", color: "#dc2626" };
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
  const charColor = charCount < 100 ? "#dc2626" : charCount > 4500 ? "#ea580c" : "#16a34a";
  const { text: readLabel, color: readColor } = fleschLabel(score);

  return (
    <div className="readability-meter" aria-live="polite">
      <div className="readability-meter__item">
        <span>{charCount} / 5,000 chars</span>
        <div className="readability-meter__bar" aria-label={`${charCount} of 5000 characters used`}>
          <div className="readability-meter__fill" style={{ width: `${charPct}%`, background: charColor }} />
        </div>
        {charCount > 0 && charCount < 100 && (
          <span style={{ color: "#dc2626", fontSize: "0.8rem" }}>min 100</span>
        )}
      </div>
      <div className="readability-meter__item">
        <span>{wordCount} words</span>
      </div>
      <div className="readability-meter__item">
        <span>Readability: {score}</span>
        <div className="readability-meter__bar" aria-label={`Flesch readability score ${score} — ${readLabel}`}>
          <div className="readability-meter__fill" style={{ width: `${score}%`, background: readColor }} />
        </div>
        <span style={{ color: readColor, fontWeight: 600, fontSize: "0.8rem" }}>{readLabel}</span>
      </div>
    </div>
  );
}
