import { describe, it, expect } from "vitest";
import { escapeHtml } from "./emailService.js";

describe("escapeHtml (emailService)", () => {
  it("escapes ampersands", () => {
    expect(escapeHtml("A & B")).toBe("A &amp; B");
  });

  it("escapes angle brackets", () => {
    expect(escapeHtml("<script>alert('xss')</script>")).toBe(
      "&lt;script&gt;alert('xss')&lt;/script&gt;"
    );
  });

  it("escapes double quotes", () => {
    expect(escapeHtml('He said "hello"')).toBe("He said &quot;hello&quot;");
  });

  it("handles clean text unchanged", () => {
    expect(escapeHtml("Hello World")).toBe("Hello World");
  });

  it("escapes all special chars together", () => {
    const result = escapeHtml('<a href="x">&</a>');
    expect(result).toContain("&lt;");
    expect(result).toContain("&gt;");
    expect(result).toContain("&quot;");
    expect(result).toContain("&amp;");
  });
});
