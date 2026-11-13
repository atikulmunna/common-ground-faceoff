"use client";

/** Characters used of the 5,000 allowed, the words, and how many are still needed to reach 100. */
export function TextMeter({ text }: { text: string }) {
  const charCount = text.length;
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  const charPct = Math.min(100, (charCount / 5000) * 100);
  const tooShort = charCount < 100;
  const nearLimit = charCount > 4500;

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
    </div>
  );
}
