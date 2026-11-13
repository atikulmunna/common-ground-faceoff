import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
const auth = vi.hoisted(() => ({ userId: "user-1", role: "individual_user" }));

vi.mock("../lib-api", () => ({ apiGet: api.get, apiPost: api.post }));
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { id: auth.userId, role: auth.role } }, status: "authenticated" }),
}));

import { SessionView } from "./session-view";

const SAVED_POSITION = "I think remote work helps focus, and the evidence from our own team supports that view strongly.";

const RESULT = {
  roundNumber: 1,
  createdAt: "2026-11-12T12:00:00Z",
  sharedFoundations: "Both want a team that can do focused work.",
  trueDisagreements: "They differ on how many office days are needed.",
  steelmans: { "Participant A": "Remote work helps focus.", "Participant B": "Office days help new hires learn." },
  conflictMap: { value: ["Autonomy against team cohesion."] },
};

let status = "collecting_positions";
let result: typeof RESULT | null = null;
let removedByModeratorAt: string | null = null;
let otherSubmitted = true;
let pause: { reason: string } | null = null;
let progress: { stage: number; total: number } | null = null;

function serveApi() {
  api.get.mockImplementation(async (path: string) => {
    if (path === "/sessions/s1") {
      const isCreator = auth.userId === "user-1";
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
            viewer: { isCreator, isParticipant: true, canShare: isCreator },
            participantLimit: 2,
            pause,
            participants: [
              {
                id: "p1",
                userId: "user-1",
                role: "session_creator",
                label: "Participant A",
                positionText: auth.userId === "user-1" && !removedByModeratorAt ? SAVED_POSITION : null,
                positionSubmittedAt: removedByModeratorAt ? null : "2026-11-12T10:00:00Z",
                positionRemovedAt: auth.userId === "user-1" ? removedByModeratorAt : null,
                user: { id: "user-1", displayName: "Casey" },
              },
              {
                id: "p2",
                userId: "user-2",
                role: "session_participant",
                label: "Participant B",
                positionText: auth.userId === "user-2" ? SAVED_POSITION : null,
                positionSubmittedAt: otherSubmitted ? "2026-11-12T11:00:00Z" : null,
                user: { id: "user-2", displayName: "Val" },
              },
            ],
          },
        },
      };
    }
    if (path.endsWith("/analysis")) return { success: true, data: { status, estimatedCompletionAt: null, result, progress } };
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

beforeEach(() => {
  vi.useFakeTimers();
  api.get.mockReset();
  api.post.mockReset().mockResolvedValue({ success: true, data: null });
  localStorage.clear();
  auth.userId = "user-1";
  auth.role = "individual_user";
  status = "collecting_positions";
  result = null;
  removedByModeratorAt = null;
  otherSubmitted = true;
  pause = null;
  progress = null;
  serveApi();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("SessionView live updates", () => {
  it("makes no periodic requests once results are showing", async () => {
    status = "completed";
    result = RESULT;
    await renderConversation();
    expect(screen.queryByRole("heading", { name: "Where you agree" })).not.toBeNull();

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

  it("names the stage a running analysis has reached", async () => {
    status = "running";
    progress = { stage: 2, total: 5 };
    await renderConversation();

    expect(screen.queryByText("Restating each perspective (2 of 5)")).not.toBeNull();
    expect(screen.queryByText(/We will email you when the results are ready/)).not.toBeNull();
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

    expect(screen.queryByRole("heading", { name: "Where you agree" })).not.toBeNull();
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
    const editor = screen.getByLabelText("Your perspective") as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: `${SAVED_POSITION} I have since changed my mind on one point.` } });
    await advance(30_000);

    expect(editor.value).toBe(`${SAVED_POSITION} I have since changed my mind on one point.`);
  });

  it("sends what could change the author's mind with their perspective", async () => {
    await renderConversation();

    fireEvent.click(screen.getByRole("button", { name: "Edit perspective" }));
    const revised = `${SAVED_POSITION} Focus matters most to me.`;
    fireEvent.change(screen.getByLabelText("Your perspective"), { target: { value: revised } });
    fireEvent.change(screen.getByLabelText("What could change your mind? (optional)"), { target: { value: " New data on focus time. " } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await advance(0);

    expect(api.post).toHaveBeenCalledWith("/sessions/s1/positions", {
      positionText: revised,
      changeMind: "New data on focus time.",
      roundNumber: 1,
    });
  });

  it("tells the author when a moderator removed their perspective, and offers the editor", async () => {
    removedByModeratorAt = "2026-11-12T12:00:00Z";
    await renderConversation();

    expect(screen.queryByText(/A moderator removed your perspective/)).not.toBeNull();
    expect(screen.queryByLabelText("What do you believe?")).not.toBeNull();
  });
});

describe("SessionView next steps", () => {
  it("says why the analysis cannot start yet", async () => {
    otherSubmitted = false;
    removedByModeratorAt = null;
    // Only one perspective is in, so the creator has to wait.
    serveApi();
    await renderConversation();

    expect((screen.getByRole("button", { name: "Find common ground" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText("Waiting for 1 more perspective. At least 2 are needed.")).not.toBeNull();
  });

  it("explains a moderator hold to everyone", async () => {
    pause = { reason: "moderation_review" };
    auth.userId = "user-2";
    await renderConversation();

    expect(screen.queryByText(/on hold while a moderator reviews reported content/)).not.toBeNull();
  });

  it("shows the analysis and next-round controls only to the creator", async () => {
    auth.userId = "user-2";
    await renderConversation();
    expect(screen.queryByRole("button", { name: "Find common ground" })).toBeNull();
    expect(screen.queryByText(/The host starts the analysis/)).not.toBeNull();
    expect(screen.queryByLabelText("Participant email address")).toBeNull();
  });

  it("hides the creator's next-round and share controls from other participants", async () => {
    status = "completed";
    result = RESULT;
    auth.userId = "user-2";
    await renderConversation();

    expect(screen.queryByRole("button", { name: /Start round/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Share a read-only link" })).toBeNull();
    expect(screen.queryByRole("button", { name: "JSON" })).not.toBeNull();
  });

  it("asks before analyzing without someone who has not submitted", async () => {
    // Three people, two submitted: the creator may go ahead, but is asked first.
    const original = api.get.getMockImplementation()!;
    api.get.mockImplementation(async (path: string) => {
      const response = await original(path);
      if (path === "/sessions/s1") {
        response.data.session.participantLimit = 6;
        response.data.session.participants.push({
          id: "p3", userId: "user-3", role: "session_participant", label: "Participant C",
          positionText: null, positionSubmittedAt: null, user: { id: "user-3", displayName: "Sam" },
        });
      }
      return response;
    });
    await renderConversation();

    fireEvent.click(screen.getByRole("button", { name: "Find common ground" }));
    expect(screen.queryByText(/1 person has not submitted a perspective yet/)).not.toBeNull();
    expect(api.post).not.toHaveBeenCalledWith("/sessions/s1/analyze", {});

    fireEvent.click(screen.getByRole("button", { name: "Find common ground without them" }));
    await advance(0);
    expect(api.post).toHaveBeenCalledWith("/sessions/s1/analyze", {});
  });

  it("brings back the author's \"Not quite\" note when the next round starts", async () => {
    result = RESULT;
    const original = api.get.getMockImplementation()!;
    api.get.mockImplementation(async (path: string) => {
      if (path.endsWith("/comments")) {
        return { success: true, data: { comments: [
          { id: "c1", userId: "user-1", mine: true, section: "steelman:Participant A", text: "I would accept one office day.", createdAt: "2026-11-12T12:00:00Z" },
          { id: "c2", userId: "user-2", mine: false, section: "steelman:Participant A", text: "Someone else's comment.", createdAt: "2026-11-12T12:01:00Z" },
        ] } };
      }
      return original(path);
    });
    await renderConversation();

    fireEvent.click(screen.getByRole("button", { name: "Edit perspective" }));
    expect(screen.queryByText(/In round 1 you said your restated view missed: .I would accept one office day\./)).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Add it to my perspective" }));
    expect((screen.getByLabelText("Your perspective") as HTMLTextAreaElement).value).toBe(`${SAVED_POSITION}\n\nI would accept one office day.`);
  });

  it("keeps the previous round's results readable while a new round gathers perspectives", async () => {
    result = RESULT;
    await renderConversation();

    expect(screen.queryByText("Round 1 results, read only")).not.toBeNull();
    expect(screen.queryByText("Both want a team that can do focused work.")).not.toBeNull();
  });
});

describe("SessionView results", () => {
  beforeEach(() => {
    status = "completed";
    result = RESULT;
  });

  it("names whose view each restatement is, and asks the author if it is right", async () => {
    await renderConversation();

    expect(screen.queryByRole("heading", { name: "Your view, restated" })).not.toBeNull();
    expect(screen.queryByRole("heading", { name: "Val's view, restated" })).not.toBeNull();
    expect(screen.queryByRole("group", { name: "Is this what you meant?" })).not.toBeNull();
  });

  it("shows an answer at once, and takes it back with an error if it is not saved", async () => {
    api.post.mockRejectedValue(new Error("offline"));
    await renderConversation();

    const agree = screen.getByRole("region", { name: "Where you agree" });
    const yes = within(agree).getByRole("button", { name: "Yes" });
    fireEvent.click(yes);
    expect(yes.getAttribute("aria-pressed")).toBe("true");

    await advance(0);
    expect(yes.getAttribute("aria-pressed")).toBe("false");
    expect(within(agree).queryByText("Your answer was not saved. Try again.")).not.toBeNull();
  });

  it("reports a problem through an inline form instead of a browser prompt", async () => {
    await renderConversation();

    fireEvent.click(screen.getByRole("button", { name: "Report this conversation" }));
    fireEvent.change(screen.getByLabelText("What is wrong?"), { target: { value: "This conversation contains a personal attack." } });
    fireEvent.click(screen.getByRole("button", { name: "Send report" }));
    await advance(0);

    expect(api.post).toHaveBeenCalledWith("/moderation/report/s1", { reason: "This conversation contains a personal attack." });
    expect(screen.queryByText("Report sent. A moderator will review it.")).not.toBeNull();
  });

  it("does not load the moderation queue for people who are not moderators", async () => {
    await renderConversation();
    expect(api.get.mock.calls.some(([path]) => String(path).includes("/moderation/"))).toBe(false);
  });
});
