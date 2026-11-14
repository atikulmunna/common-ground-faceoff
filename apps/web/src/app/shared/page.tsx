import type { Metadata } from "next";

import { fetchSharedResults, sharedSummary } from "../../lib/shared-results";
import { SharedView } from "./shared-view";

type Props = { searchParams: Promise<{ token?: string | string[] }> };

function tokenOf(value: string | string[] | undefined): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * CG-FR38 and 5.4: link previews for share links. Chat apps show the question and the summary
 * line, never participants' names. Shared results are reachable by link only, so they are kept
 * out of search engines.
 */
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const token = tokenOf((await searchParams).token);
  const lookup = await fetchSharedResults(token);
  const title = lookup.data ? lookup.data.session.topic : "Shared results";
  const description = lookup.data ? sharedSummary(lookup.data) : "Find the ground you share.";
  const image = token ? `/shared/preview-image?token=${encodeURIComponent(token)}` : "/opengraph-image";

  return {
    title,
    description,
    robots: { index: false, follow: false },
    openGraph: {
      type: "article",
      siteName: "Common Ground",
      title,
      description,
      images: [{ url: image, width: 1200, height: 630, alt: lookup.data ? `${title}${/[.?!]$/.test(title) ? "" : "."} ${description}` : "Common Ground" }],
    },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

export default async function SharedPage({ searchParams }: Props) {
  const lookup = await fetchSharedResults(tokenOf((await searchParams).token));
  return <SharedView lookup={lookup} />;
}
