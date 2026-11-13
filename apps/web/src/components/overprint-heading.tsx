import type { ReactNode } from "react";

/**
 * A heading printed twice, teal and then yellow slightly off register. Where the two inks overlap
 * they make the shared green. Screen readers hear the text once.
 */
export function OverprintHeading({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <h1 className={`overprint ${className}`.trim()}>
      <span className="overprint__first">{children}</span>
      <span className="overprint__second" aria-hidden="true">{children}</span>
    </h1>
  );
}
