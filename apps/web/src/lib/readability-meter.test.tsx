import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReadabilityMeter } from "../components/readability-meter";

describe("ReadabilityMeter", () => {
  it("shows an empty count and no reading level for empty text", () => {
    render(<ReadabilityMeter text="" />);
    expect(screen.getByText("0 of 5,000 characters")).toBeTruthy();
    expect(screen.queryByText(/to read$/)).toBeNull();
  });

  it("shows the character count", () => {
    render(<ReadabilityMeter text="Hello world" />);
    expect(screen.getByText("11 of 5,000 characters")).toBeTruthy();
  });

  it("shows the word count", () => {
    render(<ReadabilityMeter text="One two three four five" />);
    expect(screen.getByText("5 words")).toBeTruthy();
  });

  it("says how many characters are missing below the minimum", () => {
    render(<ReadabilityMeter text="Short text" />);
    expect(screen.getByText("90 more to reach the minimum of 100")).toBeTruthy();
  });

  it("drops the minimum hint at 100 characters or more", () => {
    render(<ReadabilityMeter text={"A".repeat(100) + "."} />);
    expect(screen.queryByText(/to reach the minimum/)).toBeNull();
  });

  it("calls simple text easy to read", () => {
    render(<ReadabilityMeter text="The cat sat on the mat. It was a good day. The sun was shining brightly." />);
    expect(screen.getByText(/easy to read$/i)).toBeTruthy();
  });
});
