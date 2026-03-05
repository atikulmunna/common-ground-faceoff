"use client";

import { useMemo } from "react";

export function ReadabilityMeter({ text }: { text: string }) {
  const { count, score } = useMemo(() => {
    const words = text.trim().split(/\s+/).filter(Boolean);
    const sentences = text.split(/[.!?]+/).filter((item) => item.trim().length > 0);
    const syllables = words.reduce((sum, word) => sum + estimateSyllables(word), 0);

    const wordCount = words.length;
    const sentenceCount = Math.max(sentences.length, 1);

    const flesch = wordCount > 0
      ? 206.835 - 1.015 * (wordCount / sentenceCount) - 84.6 * (syllables / Math.max(wordCount, 1))
      : 0;

    return {
      count: text.length,
      score: Number.isFinite(flesch) ? Math.round(flesch) : 0
    };
  }, [text]);

  return (
    <p style={{ marginTop: "0.4rem", color: "#475569" }}>
      Character count: {count} | Flesch score: {score}
    </p>
  );
}

function estimateSyllables(word: string): number {
  const cleaned = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!cleaned) return 1;
  const matches = cleaned.match(/[aeiouy]+/g);
  return Math.max(matches?.length ?? 1, 1);
}
