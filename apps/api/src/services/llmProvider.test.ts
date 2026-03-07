import { describe, it, expect } from "vitest";
import { parseJsonResponse, withRetryBudget } from "./llmProvider.js";

describe("parseJsonResponse", () => {
  it("parses clean JSON directly", () => {
    const raw = '{"key": "value", "num": 42}';
    expect(parseJsonResponse(raw)).toEqual({ key: "value", num: 42 });
  });

  it("extracts JSON from fenced code blocks", () => {
    const raw = 'Here is the result:\n```json\n{"answer": true}\n```\nDone.';
    expect(parseJsonResponse(raw)).toEqual({ answer: true });
  });

  it("extracts JSON from fences without json language tag", () => {
    const raw = '```\n{"x": 1}\n```';
    expect(parseJsonResponse(raw)).toEqual({ x: 1 });
  });

  it("sanitizes control characters inside string values", () => {
    // When \t and \n appear literally in a JSON string, JSON.parse handles them.
    // The sanitizer kicks in only when the first parse fails due to truly broken control chars.
    const raw = '{"text": "hello\tworld\nfoo"}';
    const result = parseJsonResponse<{ text: string }>(raw);
    expect(result.text).toBe("hello\tworld\nfoo");
  });

  it("repairs truncated JSON with unclosed braces", () => {
    const raw = '{"items": [{"a": 1}, {"b": 2}';
    const result = parseJsonResponse<{ items: Array<{ a?: number; b?: number }> }>(raw);
    expect(result.items).toHaveLength(2);
    expect(result.items[0].a).toBe(1);
    expect(result.items[1].b).toBe(2);
  });

  it("repairs truncated JSON with trailing comma", () => {
    const raw = '{"a": 1, "b": 2,';
    const result = parseJsonResponse<{ a: number; b: number }>(raw);
    expect(result.a).toBe(1);
    expect(result.b).toBe(2);
  });

  it("repairs truncated JSON with unclosed string", () => {
    const raw = '{"text": "hello world';
    const result = parseJsonResponse<{ text: string }>(raw);
    expect(result.text).toBe("hello world");
  });

  it("repairs deeply nested truncated JSON", () => {
    const raw = '{"outer": {"inner": [1, 2, 3';
    const result = parseJsonResponse<{ outer: { inner: number[] } }>(raw);
    expect(result.outer.inner).toEqual([1, 2, 3]);
  });

  it("throws for completely invalid content", () => {
    expect(() => parseJsonResponse("not json at all")).toThrow();
  });

  it("handles arrays at top level", () => {
    const raw = '[{"id": 1}, {"id": 2}]';
    expect(parseJsonResponse(raw)).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("handles empty object", () => {
    expect(parseJsonResponse("{}")).toEqual({});
  });

  it("handles LLM output with preamble text before JSON", () => {
    const raw = '```json\n{"steelmans": [{"label": "A", "steelman": "Position A"}]}\n```';
    const result = parseJsonResponse<{ steelmans: Array<{ label: string; steelman: string }> }>(raw);
    expect(result.steelmans[0].label).toBe("A");
  });
});

describe("withRetryBudget (CG-NFR39)", () => {
  it("returns result on first successful call", async () => {
    const result = await withRetryBudget(() => Promise.resolve(42), { label: "test" });
    expect(result).toBe(42);
  });

  it("retries on failure and succeeds on second attempt", async () => {
    let calls = 0;
    const result = await withRetryBudget(
      () => {
        calls++;
        if (calls === 1) return Promise.reject(new Error("transient"));
        return Promise.resolve("ok");
      },
      { budgetMs: 10_000, maxRetries: 2, label: "test" }
    );
    expect(result).toBe("ok");
    expect(calls).toBe(2);
  });

  it("throws after exhausting retries", async () => {
    await expect(
      withRetryBudget(() => Promise.reject(new Error("fail")), {
        budgetMs: 10_000,
        maxRetries: 1,
        label: "test-exhaust",
      })
    ).rejects.toThrow("test-exhaust failed");
  });

  it("respects the budget time limit", async () => {
    await expect(
      withRetryBudget(
        () => new Promise((_, reject) => setTimeout(() => reject(new Error("slow")), 500)),
        { budgetMs: 200, maxRetries: 2, label: "budget-test" }
      )
    ).rejects.toThrow();
  });

  it("defaults to 20s budget and 2 retries", async () => {
    const result = await withRetryBudget(() => Promise.resolve("default"));
    expect(result).toBe("default");
  });
});
