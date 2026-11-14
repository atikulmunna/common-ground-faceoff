import { PREVIEW_SIZE, renderPreviewImage } from "../lib/preview-image";

export const size = PREVIEW_SIZE;
export const contentType = "image/png";
export const alt = "Common Ground: find the ground you share";

/** The link preview for every page that does not set its own, such as the landing page. */
export default function OpenGraphImage() {
  return renderPreviewImage({
    headline: "Find the ground you share.",
    line: "Everyone writes what they think. See the points you share and the few you really differ on.",
  });
}
