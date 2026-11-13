import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ResultsView } from "./results-view";
import type { AnalysisResult } from "./types";

const quotes = [
  { label: "Participant A", quote: "help new hires learn quickly" },
  { label: "Participant B", quote: "protect time for focused work" },
];

const RESULT: AnalysisResult = {
  sharedFoundations: "Joined text that the new layout does not show.",
  trueDisagreements: "Joined differences.",
  steelmans: {
    "Participant A": "Office days help new hires learn quickly.",
    "Participant B": "Remote days protect time for focused work.",
  },
  conflictMap: { policy: ["How many office days."] },
  sharedFoundationPoints: [
    { statement: "Both want the team to work well.", evidence: quotes },
    { statement: "Both want office time to be useful.", evidence: quotes },
    { statement: "Both want new people supported.", evidence: quotes },
    { statement: "Both want fewer pointless meetings.", evidence: quotes },
  ],
  disagreementPoints: [
    { statement: "They differ on how many days.", category: "policy", evidence: quotes },
    { statement: "They differ on whether focus suffers.", category: "empirical", settledBy: "Measured focus time in each setting.", evidence: quotes },
  ],
  participantValues: { "Participant A": [{ name: "growth", description: "" }], "Participant B": [{ name: "focus", description: "" }] },
  verification: { sharedProposed: 5, sharedVerified: 4, differencesProposed: 1, differencesVerified: 1 },
};

const owners = {
  "Participant A": { name: "Casey", mine: true },
  "Participant B": { name: "Val", mine: false },
};

describe("ResultsView", () => {
  it("opens with a one-line summary and the measured check", () => {
    render(<ResultsView result={RESULT} owners={owners} />);

    expect(screen.queryByText("You agree on 4 points and differ on 2.")).not.toBeNull();
    expect(screen.queryByText(/4 of 5 proposed common points held up/)).not.toBeNull();
  });

  it("shows each common point between the quotes that back it, three at first", () => {
    render(<ResultsView result={RESULT} owners={owners} />);
    const agree = screen.getByRole("region", { name: "Where you agree" });

    expect(within(agree).getAllByRole("listitem")).toHaveLength(3);
    expect(within(agree).getAllByText("From your view")).toHaveLength(3);
    expect(within(agree).getAllByText("From Val's view")).toHaveLength(3);
    expect(within(agree).queryByText("Joined text that the new layout does not show.")).toBeNull();

    fireEvent.click(within(agree).getByRole("button", { name: "Show 1 more common point" }));
    expect(within(agree).getAllByRole("listitem")).toHaveLength(4);
  });

  it("shows one card per difference with its kind and each side", () => {
    render(<ResultsView result={RESULT} owners={owners} />);
    const differ = screen.getByRole("region", { name: "Where you differ" });

    expect(within(differ).queryByRole("heading", { name: "They differ on how many days." })).not.toBeNull();
    expect(within(differ).queryByText("Approach")).not.toBeNull();
    expect(within(differ).getAllByText("Val:")).toHaveLength(2);
    expect(within(differ).getAllByText("You:")).toHaveLength(2);
  });

  it("says what could change minds on a factual difference", () => {
    render(<ResultsView result={RESULT} owners={owners} />);

    expect(screen.queryByText("Measured focus time in each setting.")).not.toBeNull();
    expect(screen.getAllByText("What could change minds:")).toHaveLength(1);
  });

  it("names what matters to each person under their restated view", () => {
    render(<ResultsView result={RESULT} owners={owners} />);

    expect(screen.queryByText("What matters to you:")).not.toBeNull();
    expect(screen.queryByText("focus")).not.toBeNull();
  });

  it("words the page for a reader outside the conversation", () => {
    render(<ResultsView result={RESULT} audience="public" />);

    expect(screen.queryByText("They agree on 4 points and differ on 2.")).not.toBeNull();
    expect(screen.queryByRole("heading", { name: "Where they agree" })).not.toBeNull();
    expect(screen.getAllByText("From Participant A's view").length).toBeGreaterThan(0);
  });

  it("still shows results saved before points were kept", () => {
    const older: AnalysisResult = {
      sharedFoundations: "Both want the team to work well.",
      trueDisagreements: "They differ on how many days.",
      steelmans: RESULT.steelmans,
      conflictMap: { policy: ["How many office days."] },
    };
    render(<ResultsView result={older} owners={owners} />);

    expect(screen.queryByText("Both want the team to work well.")).not.toBeNull();
    expect(screen.queryByText("They differ on how many days.")).not.toBeNull();
    expect(screen.queryByText(/agree on .* points/)).toBeNull();
  });

  it("asks the author what was missed after \"Not quite\", and keeps the note as their comment", async () => {
    const onComment = vi.fn(async () => true);
    const interaction = {
      myReactions: { "steelman:Participant A": "misrepresents" as const },
      mutual: {},
      reactionErrors: {},
      onReact: () => {},
      comments: [],
      commentErrors: {},
      onComment,
      authorName: () => "You",
      myLabel: "Participant A",
    };
    render(<ResultsView result={RESULT} owners={owners} interaction={interaction} />);

    fireEvent.change(screen.getByLabelText("What did it miss or get wrong?"), { target: { value: "I would accept one day a week." } });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    await waitFor(() => expect(onComment).toHaveBeenCalledWith("steelman:Participant A", "I would accept one day a week."));
  });

  it("shows the saved note instead of the form", () => {
    const interaction = {
      myReactions: { "steelman:Participant A": "misrepresents" as const },
      mutual: {},
      reactionErrors: {},
      onReact: () => {},
      comments: [{ id: "c1", userId: "user-1", mine: true, section: "steelman:Participant A", text: "One day is fine.", createdAt: "2026-11-12T12:00:00Z" }],
      commentErrors: {},
      onComment: async () => true,
      authorName: () => "You",
      myLabel: "Participant A",
    };
    render(<ResultsView result={RESULT} owners={owners} interaction={interaction} />);

    expect(screen.queryByLabelText("What did it miss or get wrong?")).toBeNull();
    expect(screen.queryByText(/Your note: .One day is fine\./)).not.toBeNull();
  });

  it("says so when no common point held up", () => {
    render(<ResultsView result={{ ...RESULT, sharedFoundationPoints: [] }} owners={owners} />);

    expect(screen.queryByText("No common point held up this round. You differ on 2 points.")).not.toBeNull();
  });
});
