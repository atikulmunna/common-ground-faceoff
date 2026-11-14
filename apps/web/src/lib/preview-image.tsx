import { ImageResponse } from "next/og";

/** Link preview size used by Open Graph and most chat apps. */
export const PREVIEW_SIZE = { width: 1200, height: 630 };

// The two-circle mark, with the overlap drawn as its own shape so it is always the shared green.
const MARK = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 28"><circle cx="14" cy="14" r="12" fill="#007780"/><circle cx="26" cy="14" r="12" fill="#FFE800"/><path d="M20 3.61A12 12 0 0 1 20 24.39A12 12 0 0 1 20 3.61Z" fill="#006C00"/></svg>',
)}`;

/**
 * A link preview in the site's inks: the mark, a headline, a supporting line, and a band of teal,
 * green and yellow along the bottom, like a common point between two views. Never names people.
 */
export function renderPreviewImage({ headline, line }: { headline: string; line: string }): ImageResponse {
  const shortened = headline.length > 140 ? `${headline.slice(0, 137).trimEnd()}...` : headline;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#FCFCFA", color: "#13241B" }}>
        <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, padding: "64px 72px 40px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={MARK} width={80} height={56} alt="" />
            <span style={{ fontSize: 36 }}>Common Ground</span>
          </div>
          <div style={{ display: "flex", flexGrow: 1, alignItems: "center" }}>
            <span style={{ fontSize: shortened.length > 80 ? 52 : 64, lineHeight: 1.1, color: "#006C00", letterSpacing: -1 }}>{shortened}</span>
          </div>
          <span style={{ fontSize: 34, lineHeight: 1.3 }}>{line}</span>
        </div>
        <div style={{ display: "flex", height: 28 }}>
          <div style={{ flexGrow: 1, background: "#007780" }} />
          <div style={{ flexGrow: 1, background: "#006C00" }} />
          <div style={{ flexGrow: 1, background: "#FFE800" }} />
        </div>
      </div>
    ),
    PREVIEW_SIZE,
  );
}
