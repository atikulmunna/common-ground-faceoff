/**
 * Two overlapping circles, one for each voice. Where they overlap they make the shared green,
 * drawn as its own shape so the mark looks the same wherever it is rendered.
 */
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={(size * 40) / 28} height={size} viewBox="0 0 40 28" aria-hidden="true" focusable="false">
      <circle cx="14" cy="14" r="12" fill="#007780" />
      <circle cx="26" cy="14" r="12" fill="#FFE800" />
      <path d="M20 3.61A12 12 0 0 1 20 24.39A12 12 0 0 1 20 3.61Z" fill="#006C00" />
    </svg>
  );
}
