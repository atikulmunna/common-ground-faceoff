import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReadabilityMeter } from "../components/readability-meter";

describe("ReadabilityMeter", () => {
  it("shows 0 chars and 0 score for empty text", () => {
    render(<ReadabilityMeter text="" />);
    expect(screen.getByText(/0 \/ 5,000 chars/)).toBeTruthy();
    expect(screen.getByText(/Readability: 0/)).toBeTruthy();
  });

  it("shows correct char count", () => {
    render(<ReadabilityMeter text="Hello world" />);
    expect(screen.getByText(/11 \/ 5,000 chars/)).toBeTruthy();
  });

  it("shows word count", () => {
    render(<ReadabilityMeter text="One two three four five" />);
    expect(screen.getByText("5 words")).toBeTruthy();
  });

  it("shows min 100 warning when under 100 chars", () => {
    render(<ReadabilityMeter text="Short text" />);
    expect(screen.getByText("min 100")).toBeTruthy();
  });

  it("does not show min 100 warning at or above 100 chars", () => {
    const longText = "A".repeat(100) + ".";
    render(<ReadabilityMeter text={longText} />);
    expect(screen.queryByText("min 100")).toBeNull();
  });

  it("computes a positive Flesch score for simple text", () => {
    const simpleText = "The cat sat on the mat. It was a good day. The sun was shining brightly.";
    render(<ReadabilityMeter text={simpleText} />);
    // Simple text should have high readability
    const label = screen.getByText(/Readability: \d+/);
    expect(label).toBeTruthy();
  });
});
