import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

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
  disagreementPoints: [{ statement: "They differ on how many days.", category: "policy", evidence: quotes }],
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

    expect(screen.queryByText("You agree on 4 points and differ on 1.")).not.toBeNull();
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
    expect(within(differ).queryByText("Val:")).not.toBeNull();
    expect(within(differ).queryByText("You:")).not.toBeNull();
  });

  it("names what matters to each person under their restated view", () => {
    render(<ResultsView result={RESULT} owners={owners} />);

    expect(screen.queryByText("What matters to you:")).not.toBeNull();
    expect(screen.queryByText("focus")).not.toBeNull();
  });

  it("words the page for a reader outside the conversation", () => {
    render(<ResultsView result={RESULT} audience="public" />);

    expect(screen.queryByText("They agree on 4 points and differ on 1.")).not.toBeNull();
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

  it("says so when no common point held up", () => {
    render(<ResultsView result={{ ...RESULT, sharedFoundationPoints: [] }} owners={owners} />);

    expect(screen.queryByText("No common point held up this round. You differ on 1 point.")).not.toBeNull();
  });
});
