import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));

vi.mock("../lib-api", () => ({ apiGet: api.get, apiPost: api.post }));
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { id: "user-1" } }, status: "authenticated" }),
}));

import { SessionView } from "./session-view";

const SAVED_POSITION = "I think remote work helps focus, and the evidence from our own team supports that view strongly.";

const RESULT = {
  sharedFoundations: "Both want a team that can do focused work.",
  trueDisagreements: "They differ on how many office days are needed.",
  steelmans: { "Participant A": "Remote work helps focus." },
  conflictMap: {},
  confidenceScores: { sharedFoundations: 0.9, disagreements: 0.8 },
};

let status = "collecting_positions";
let result: typeof RESULT | null = null;

function serveApi() {
  api.get.mockImplementation(async (path: string) => {
    if (path === "/sessions/s1") {
      return {
        success: true,
        data: {
          session: {
            id: "s1",
            topic: "How many office days should our team keep?",
            status,
            creatorUserId: "user-1",
            anonymousMode: false,
            deadline: null,
            participants: [
              { id: "p1", userId: "user-1", role: "session_creator", positionText: SAVED_POSITION, positionSubmittedAt: "2026-11-12T10:00:00Z" },
              { id: "p2", userId: "user-2", role: "session_participant", positionText: null, positionSubmittedAt: "2026-11-12T11:00:00Z" },
            ],
          },
        },
      };
    }
    if (path.endsWith("/analysis")) return { success: true, data: { status, estimatedCompletionAt: null, result } };
    if (path.endsWith("/reactions")) return { success: true, data: { reactions: [], mutualAcknowledgments: {} } };
    if (path.endsWith("/rounds")) return { success: true, data: { rounds: [] } };
    if (path.endsWith("/comments")) return { success: true, data: { comments: [] } };
    if (path.includes("/moderation/")) return { success: true, data: null };
    throw new Error(`Unexpected GET ${path}`);
  });
}

function requestsEndingWith(suffix: string): number {
  return api.get.mock.calls.filter(([path]) => String(path).endsWith(suffix)).length;
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function renderConversation() {
  render(<SessionView sessionId="s1" />);
  await advance(0);
}

describe("SessionView live updates", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    api.get.mockReset();
    api.post.mockReset().mockResolvedValue({ success: true, data: null });
    localStorage.clear();
    status = "collecting_positions";
    result = null;
    serveApi();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("makes no periodic requests once results are showing", async () => {
    status = "completed";
    result = RESULT;
    await renderConversation();
    expect(screen.queryByRole("heading", { name: "Your common ground" })).not.toBeNull();

    const requestsAfterLoad = api.get.mock.calls.length;
    await advance(120_000);

    expect(api.get.mock.calls.length).toBe(requestsAfterLoad);
  });

  it("checks a running analysis every few seconds", async () => {
    status = "running";
    await renderConversation();

    const before = requestsEndingWith("/analysis");
    await advance(9_000);

    expect(requestsEndingWith("/analysis")).toBe(before + 3);
  });

  it("checks only occasionally while perspectives are being gathered", async () => {
    await renderConversation();

    const before = requestsEndingWith("/analysis");
    await advance(29_000);
    expect(requestsEndingWith("/analysis")).toBe(before);

    await advance(1_000);
    expect(requestsEndingWith("/analysis")).toBe(before + 1);
  });

  it("shows results and loads their reactions when an analysis finishes while the page is open", async () => {
    status = "running";
    await renderConversation();
    expect(requestsEndingWith("/reactions")).toBe(0);

    status = "completed";
    result = RESULT;
    await advance(3_000);

    expect(screen.queryByRole("heading", { name: "Your common ground" })).not.toBeNull();
    expect(requestsEndingWith("/reactions")).toBe(1);
    expect(requestsEndingWith("/comments")).toBe(1);
  });

  it("counts other participants' submissions even though their text is hidden", async () => {
    await renderConversation();

    expect(screen.queryByText(/2 of 2 perspectives submitted/)).not.toBeNull();
  });

  it("does not overwrite an edit in progress when it refreshes", async () => {
    await renderConversation();

    fireEvent.click(screen.getByRole("button", { name: "Edit perspective" }));
    const editor = screen.getByPlaceholderText(/Share your perspective/) as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: `${SAVED_POSITION} I have since changed my mind on one point.` } });
    await advance(30_000);

    expect(editor.value).toBe(`${SAVED_POSITION} I have since changed my mind on one point.`);
  });
});
