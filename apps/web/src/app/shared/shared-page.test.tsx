import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import SharedPage, { generateMetadata } from "./page";

const SHARED = {
  success: true,
  data: {
    session: {
      id: "s1",
      topic: "How many office days should our team keep?",
      status: "completed",
      anonymousMode: false,
      createdAt: "2026-11-12T10:00:00Z",
      analyzedAt: "2026-11-12T12:00:00Z",
      participantCount: 2,
      participants: [{ displayName: "Casey", role: "session_creator" }, { displayName: "Val", role: "session_participant" }],
    },
    analysis: {
      roundNumber: 1,
      createdAt: "2026-11-12T12:00:00Z",
      sharedFoundations: "Both want the team to work well.",
      trueDisagreements: "They differ on how many days.",
      steelmans: { "Participant A": "A.", "Participant B": "B." },
      conflictMap: {},
      sharedFoundationPoints: [{ statement: "Both want the team to work well.", evidence: [] }],
      disagreementPoints: [{ statement: "They differ on how many days.", category: "policy", evidence: [] }],
    },
  },
};

function serve(body: unknown, ok = true) {
  const fetchMock = vi.fn(async () => ({ ok, json: async () => body }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const props = (token?: string) => ({ searchParams: Promise.resolve(token ? { token } : {}) });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("share link previews (5.4)", () => {
  it("describes the shared results by their question and summary, and points to a preview image", async () => {
    serve(SHARED);

    const metadata = await generateMetadata(props("abc 123"));

    expect(metadata.title).toBe("How many office days should our team keep?");
    expect(metadata.description).toBe("They agree on 1 point and differ on 1.");
    expect(metadata.openGraph?.images).toEqual([expect.objectContaining({ url: "/shared/preview-image?token=abc%20123", width: 1200, height: 630 })]);
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it("never puts participants' names in the preview", async () => {
    serve(SHARED);

    const metadata = await generateMetadata(props("abc"));

    expect(JSON.stringify(metadata)).not.toContain("Casey");
    expect(JSON.stringify(metadata)).not.toContain("Val");
  });

  it("falls back to a general preview for a link that does not work", async () => {
    serve({ success: false, data: null, error: { message: "This share link has been revoked" } }, false);

    const metadata = await generateMetadata(props("revoked"));

    expect(metadata.title).toBe("Shared results");
    expect(metadata.description).toBe("Find the ground you share.");
  });
});

describe("shared results page", () => {
  it("renders the results on the server", async () => {
    serve(SHARED);

    render(await SharedPage(props("abc")));

    expect(screen.queryByRole("heading", { name: "How many office days should our team keep?" })).not.toBeNull();
    expect(screen.queryByText("They agree on 1 point and differ on 1.")).not.toBeNull();
    expect(screen.queryByRole("link", { name: "Start your own conversation" })).not.toBeNull();
  });

  it("says why when the link does not work", async () => {
    serve({ success: false, data: null, error: { message: "This share link has been revoked" } }, false);

    render(await SharedPage(props("revoked")));

    expect(screen.queryByText("This share link has been revoked")).not.toBeNull();
  });

  it("asks for the full link when the token is missing, without calling the API", async () => {
    const fetchMock = serve(SHARED);

    render(await SharedPage(props()));

    expect(screen.queryByText(/This link is incomplete/)).not.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
