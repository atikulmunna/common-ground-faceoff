import { describe, it, expect } from "vitest";
import {
  registerSchema,
  loginSchema,
  createSessionSchema,
  submitPositionSchema,
  feedbackRatingSchema,
  sectionReactionSchema,
  oauthExchangeSchema,
} from "@common-ground/shared";

describe("shared contracts", () => {
  describe("registerSchema", () => {
    it("accepts valid registration", () => {
      const result = registerSchema.safeParse({
        email: "user@example.com",
        password: "MyStr0ng!Pass",
        displayName: "Test User",
      });
      expect(result.success).toBe(true);
    });

    it("rejects weak password", () => {
      const result = registerSchema.safeParse({
        email: "user@example.com",
        password: "weak",
        displayName: "Test User",
      });
      expect(result.success).toBe(false);
    });

    it("rejects invalid email", () => {
      const result = registerSchema.safeParse({
        email: "not-an-email",
        password: "MyStr0ng!Pass",
        displayName: "Test User",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("loginSchema", () => {
    it("accepts valid login", () => {
      const result = loginSchema.safeParse({ email: "a@b.com", password: "x" });
      expect(result.success).toBe(true);
    });

    it("rejects empty password", () => {
      const result = loginSchema.safeParse({ email: "a@b.com", password: "" });
      expect(result.success).toBe(false);
    });
  });

  describe("createSessionSchema", () => {
    it("accepts valid topic", () => {
      const result = createSessionSchema.safeParse({ topic: "A topic that is at least ten chars" });
      expect(result.success).toBe(true);
    });

    it("rejects short topic", () => {
      const result = createSessionSchema.safeParse({ topic: "short" });
      expect(result.success).toBe(false);
    });
  });

  describe("submitPositionSchema", () => {
    it("rejects position shorter than 100 chars", () => {
      const result = submitPositionSchema.safeParse({ positionText: "Too short" });
      expect(result.success).toBe(false);
    });

    it("accepts position of 100+ chars", () => {
      const result = submitPositionSchema.safeParse({ positionText: "A".repeat(100) });
      expect(result.success).toBe(true);
    });
  });

  describe("feedbackRatingSchema", () => {
    it("accepts valid ratings", () => {
      const result = feedbackRatingSchema.safeParse({ faithfulness: 4, neutrality: 3 });
      expect(result.success).toBe(true);
    });

    it("rejects out of range rating", () => {
      const result = feedbackRatingSchema.safeParse({ faithfulness: 0, neutrality: 6 });
      expect(result.success).toBe(false);
    });
  });

  describe("sectionReactionSchema", () => {
    it("accepts valid reaction", () => {
      const result = sectionReactionSchema.safeParse({ section: "steelman:A", reaction: "represents" });
      expect(result.success).toBe(true);
    });

    it("rejects invalid reaction value", () => {
      const result = sectionReactionSchema.safeParse({ section: "steelman:A", reaction: "bad" });
      expect(result.success).toBe(false);
    });
  });

  describe("oauthExchangeSchema", () => {
    it("accepts valid Google exchange payload", () => {
      const result = oauthExchangeSchema.safeParse({
        email: "user@gmail.com",
        displayName: "Google User",
        provider: "google",
      });
      expect(result.success).toBe(true);
    });

    it("rejects unsupported provider", () => {
      const result = oauthExchangeSchema.safeParse({
        email: "user@example.com",
        displayName: "User",
        provider: "facebook",
      });
      expect(result.success).toBe(false);
    });
  });
});
