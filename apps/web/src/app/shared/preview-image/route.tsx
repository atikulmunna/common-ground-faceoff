import { fetchSharedResults, sharedSummary } from "../../../lib/shared-results";
import { renderPreviewImage } from "../../../lib/preview-image";

/** The link preview image for one share link: the question and its summary line. */
export async function GET(request: Request) {
  const lookup = await fetchSharedResults(new URL(request.url).searchParams.get("token"));
  const image = lookup.data
    ? renderPreviewImage({ headline: lookup.data.session.topic, line: sharedSummary(lookup.data) })
    : renderPreviewImage({ headline: "Find the ground you share.", line: "Shared results from Common Ground." });
  // Chat apps fetch a preview once; a short cache keeps a revoked link's preview from lingering long.
  image.headers.set("Cache-Control", "public, max-age=300");
  return image;
}
