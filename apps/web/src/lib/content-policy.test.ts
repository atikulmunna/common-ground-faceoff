import { describe, it, expect } from "vitest";
import { checkContentPolicy } from "./content-policy";

describe("checkContentPolicy", () => {
  it("returns empty array for safe text", () => {
    const warnings = checkContentPolicy(
      "I believe we should focus on finding common ground through respectful dialogue and evidence-based reasoning."
    );
    expect(warnings).toEqual([]);
  });

  it("detects threat patterns", () => {
    const warnings = checkContentPolicy("I will hurt you if you disagree with me about this policy.");
    expect(warnings.some((w) => w.category === "threats")).toBe(true);
  });

  it("detects personal info (phone number)", () => {
    const warnings = checkContentPolicy("Call me at 555-123-4567 to discuss my position on the topic further.");
    expect(warnings.some((w) => w.category === "personal_info")).toBe(true);
  });

  it("detects personal info (SSN)", () => {
    const warnings = checkContentPolicy("My SSN is 123-45-6789 please verify my identity with that.");
    expect(warnings.some((w) => w.category === "personal_info")).toBe(true);
  });

  it("detects aggressive tone (excessive caps)", () => {
    const warnings = checkContentPolicy("THIS IS COMPLETELY WRONG AND YOU ARE ALL BEING RIDICULOUS ABOUT THIS ENTIRE ISSUE");
    expect(warnings.some((w) => w.category === "tone")).toBe(true);
  });

  it("does not flag mixed-case text as aggressive", () => {
    const warnings = checkContentPolicy(
      "I strongly disagree with the proposed policy changes because the evidence suggests otherwise in multiple studies."
    );
    expect(warnings.some((w) => w.category === "tone")).toBe(false);
  });

  it("returns multiple warnings when multiple issues found", () => {
    const warnings = checkContentPolicy("I WILL HURT YOU, MY SSN IS 123-45-6789 AND I WANT EVERYONE TO KNOW EXACTLY WHERE I STAND ON THIS CRITICAL MATTER");
    expect(warnings.length).toBeGreaterThanOrEqual(2);
  });
});
