import Link from "next/link";

import { ResultsView } from "../../components/conversation/results-view";
import { stageLabel } from "../../lib/conversation-stage";
import type { SharedLookup } from "../../lib/shared-results";

/** The public, read-only results behind a share link, rendered from what the server fetched. */
export function SharedView({ lookup }: { lookup: SharedLookup }) {
  if (!lookup.data) {
    return (
      <section className="narrow-page">
        <h1>These results are not available</h1>
        <p className="notice notice--error" role="alert">{lookup.error}</p>
        <Link href="/" className="button-link">Go to Common Ground</Link>
      </section>
    );
  }

  const { session, analysis } = lookup.data;
  const day = (value: string) => new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });

  return (
    <div className="conversation shared">
      <header className="conversation-header">
        <h1>{session.topic}</h1>
        <div className="conversation-header__meta">
          <span>Shared results, read only</span>
          <span>{session.participantCount} {session.participantCount === 1 ? "person" : "people"} took part</span>
          {analysis
            ? <span>Round {analysis.roundNumber}, {day(analysis.createdAt)}</span>
            : <span>{stageLabel(session.status).label}</span>}
        </div>
      </header>

      {analysis ? (
        <ResultsView result={analysis} audience="public" />
      ) : (
        <p className="notice notice--warn">The results for this conversation are not ready yet. Try this link again later.</p>
      )}

      <section className="shared__invite" aria-labelledby="own-heading">
        <h2 id="own-heading">Have a disagreement of your own?</h2>
        <p>Common Ground restates each view fairly and shows the ground you share.</p>
        <Link href="/sign-in" className="button-link">Start your own conversation</Link>
      </section>
    </div>
  );
}
