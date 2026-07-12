import { describe, expect, it } from "vitest";

import {
  createSessionSchema,
  passwordSchema,
  submitPositionSchema,
} from "./contracts";

describe("shared contracts", () => {
  it("enforces the password policy", () => {
    expect(passwordSchema.safeParse("StrongPass1!").success).toBe(true);
    expect(passwordSchema.safeParse("weakpassword").success).toBe(false);
  });

  it("applies session defaults", () => {
    expect(createSessionSchema.parse({ topic: "A sufficiently long topic" })).toEqual({
      topic: "A sufficiently long topic",
      anonymousMode: false,
    });
  });

  it("rejects positions outside the documented length bounds", () => {
    expect(submitPositionSchema.safeParse({ positionText: "short" }).success).toBe(false);
    expect(
      submitPositionSchema.safeParse({ positionText: "x".repeat(100) }).success,
    ).toBe(true);
  });
});
