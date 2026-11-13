import type { ReactNode } from "react";

/** Renders the little markdown the analysis uses: **bold**, *italic* and line breaks. */
export function renderMarkdown(text: unknown): ReactNode[] {
  const normalized =
    typeof text === "string" ? text : text == null ? "" : typeof text === "object" ? JSON.stringify(text) : String(text);

  return normalized.split(/\n/).flatMap((line, lineIndex, lines) => {
    const parts: ReactNode[] = [];
    const pattern = /(\*\*(.+?)\*\*|\*(.+?)\*)/g;
    let lastIndex = 0;
    let match;
    while ((match = pattern.exec(line)) !== null) {
      if (match.index > lastIndex) parts.push(line.slice(lastIndex, match.index));
      if (match[2]) parts.push(<strong key={`${lineIndex}-b-${match.index}`}>{match[2]}</strong>);
      else if (match[3]) parts.push(<em key={`${lineIndex}-i-${match.index}`}>{match[3]}</em>);
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < line.length) parts.push(line.slice(lastIndex));
    if (lineIndex < lines.length - 1) parts.push(<br key={`br-${lineIndex}`} />);
    return parts;
  });
}
