import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TextMeter } from "../components/text-meter";

describe("TextMeter", () => {
  it("shows an empty count for empty text", () => {
    render(<TextMeter text="" />);
    expect(screen.getByText("0 of 5,000 characters")).toBeTruthy();
    expect(screen.getByText("0 words")).toBeTruthy();
  });

  it("shows the character count", () => {
    render(<TextMeter text="Hello world" />);
    expect(screen.getByText("11 of 5,000 characters")).toBeTruthy();
  });

  it("shows the word count", () => {
    render(<TextMeter text="One two three four five" />);
    expect(screen.getByText("5 words")).toBeTruthy();
  });

  it("says how many characters are missing below the minimum", () => {
    render(<TextMeter text="Short text" />);
    expect(screen.getByText("90 more to reach the minimum of 100")).toBeTruthy();
  });

  it("drops the minimum hint at 100 characters or more", () => {
    render(<TextMeter text={"A".repeat(100) + "."} />);
    expect(screen.queryByText(/to reach the minimum/)).toBeNull();
  });

  it("does not grade how easy the text is to read", () => {
    render(<TextMeter text="The cat sat on the mat. It was a good day. The sun was shining brightly." />);
    expect(screen.queryByText(/to read/i)).toBeNull();
  });
});
