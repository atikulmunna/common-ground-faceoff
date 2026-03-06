import { describe, it, expect } from "vitest";
import {
  registerSchema,
  loginSchema,
  createSessionSchema,
  submitPositionSchema,
  feedbackRatingSchema,
  sectionReactionSchema,
  oauthExchangeSchema,
  samlLoginSchema,
  createOrganizationSchema,
  createCohortSchema,
  cohortMemberSchema,
  adminCreateSessionSchema,
  emailInvitationSchema,
  billingCheckoutSchema,
  billingPortalSchema,
  stripeWebhookEventSchema,
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

  describe("samlLoginSchema", () => {
    it("accepts valid org slug", () => {
      const result = samlLoginSchema.safeParse({ orgSlug: "acme-corp" });
      expect(result.success).toBe(true);
    });

    it("rejects empty org slug", () => {
      const result = samlLoginSchema.safeParse({ orgSlug: "" });
      expect(result.success).toBe(false);
    });
  });

  describe("createOrganizationSchema", () => {
    it("accepts valid organization", () => {
      const result = createOrganizationSchema.safeParse({
        name: "Acme Corp",
        slug: "acme-corp",
      });
      expect(result.success).toBe(true);
    });

    it("rejects slug with uppercase", () => {
      const result = createOrganizationSchema.safeParse({
        name: "Acme",
        slug: "Acme-Corp",
      });
      expect(result.success).toBe(false);
    });

    it("rejects slug with spaces", () => {
      const result = createOrganizationSchema.safeParse({
        name: "Test Org",
        slug: "test org",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("createCohortSchema", () => {
    it("accepts valid cohort name", () => {
      const result = createCohortSchema.safeParse({ name: "Fall 2026 Cohort" });
      expect(result.success).toBe(true);
    });

    it("rejects empty name", () => {
      const result = createCohortSchema.safeParse({ name: "" });
      expect(result.success).toBe(false);
    });
  });

  describe("cohortMemberSchema", () => {
    it("accepts valid email", () => {
      const result = cohortMemberSchema.safeParse({ email: "student@uni.edu" });
      expect(result.success).toBe(true);
    });

    it("rejects invalid email", () => {
      const result = cohortMemberSchema.safeParse({ email: "not-an-email" });
      expect(result.success).toBe(false);
    });
  });

  describe("adminCreateSessionSchema", () => {
    it("accepts valid admin session", () => {
      const result = adminCreateSessionSchema.safeParse({
        topic: "A topic that is at least ten chars",
        participantEmails: ["a@b.com", "c@d.com"],
      });
      expect(result.success).toBe(true);
    });

    it("rejects fewer than 2 participant emails", () => {
      const result = adminCreateSessionSchema.safeParse({
        topic: "A topic that is at least ten chars",
        participantEmails: ["a@b.com"],
      });
      expect(result.success).toBe(false);
    });

    it("rejects more than 6 participant emails", () => {
      const result = adminCreateSessionSchema.safeParse({
        topic: "A topic that is at least ten chars",
        participantEmails: Array.from({ length: 7 }, (_, i) => `u${i}@b.com`),
      });
      expect(result.success).toBe(false);
    });
  });

  /* ---- Batch 5 schemas ---- */

  describe("emailInvitationSchema", () => {
    it("accepts valid email with optional message", () => {
      const result = emailInvitationSchema.safeParse({
        email: "invite@example.com",
        message: "Please join!",
      });
      expect(result.success).toBe(true);
    });

    it("accepts email without message", () => {
      const result = emailInvitationSchema.safeParse({ email: "invite@example.com" });
      expect(result.success).toBe(true);
    });

    it("rejects invalid email", () => {
      const result = emailInvitationSchema.safeParse({ email: "not-email" });
      expect(result.success).toBe(false);
    });

    it("rejects message exceeding 500 chars", () => {
      const result = emailInvitationSchema.safeParse({
        email: "a@b.com",
        message: "x".repeat(501),
      });
      expect(result.success).toBe(false);
    });
  });

  describe("billingCheckoutSchema", () => {
    it("accepts valid checkout payload", () => {
      const result = billingCheckoutSchema.safeParse({
        priceId: "price_abc123",
        successUrl: "https://example.com/success",
        cancelUrl: "https://example.com/cancel",
      });
      expect(result.success).toBe(true);
    });

    it("rejects missing priceId", () => {
      const result = billingCheckoutSchema.safeParse({
        priceId: "",
        successUrl: "https://example.com/success",
        cancelUrl: "https://example.com/cancel",
      });
      expect(result.success).toBe(false);
    });

    it("rejects non-URL successUrl", () => {
      const result = billingCheckoutSchema.safeParse({
        priceId: "price_abc123",
        successUrl: "not-a-url",
        cancelUrl: "https://example.com/cancel",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("billingPortalSchema", () => {
    it("accepts valid return URL", () => {
      const result = billingPortalSchema.safeParse({
        returnUrl: "https://example.com/billing",
      });
      expect(result.success).toBe(true);
    });

    it("rejects non-URL", () => {
      const result = billingPortalSchema.safeParse({ returnUrl: "bad" });
      expect(result.success).toBe(false);
    });
  });

  describe("stripeWebhookEventSchema", () => {
    it("accepts valid webhook event", () => {
      const result = stripeWebhookEventSchema.safeParse({
        id: "evt_abc123",
        type: "checkout.session.completed",
        data: { object: { id: "cs_test_123" } },
      });
      expect(result.success).toBe(true);
    });

    it("rejects missing data", () => {
      const result = stripeWebhookEventSchema.safeParse({
        id: "evt_abc123",
        type: "checkout.session.completed",
      });
      expect(result.success).toBe(false);
    });
  });
});
