import { afterEach, describe, expect, it } from "vitest";

import { verifyOAuthExchangeSecret } from "./internalAuth.js";

const originalSecret = process.env.OAUTH_EXCHANGE_SECRET;

afterEach(() => {
  process.env.OAUTH_EXCHANGE_SECRET = originalSecret;
});

describe("OAuth exchange internal authentication", () => {
  it("accepts only the configured secret", () => {
    process.env.OAUTH_EXCHANGE_SECRET = "oauth-exchange-test-secret-at-least-32-characters";

    expect(verifyOAuthExchangeSecret(undefined)).toBe(false);
    expect(verifyOAuthExchangeSecret("wrong-secret-with-a-different-length")).toBe(false);
    expect(verifyOAuthExchangeSecret("x".repeat(48))).toBe(false);
    expect(verifyOAuthExchangeSecret(process.env.OAUTH_EXCHANGE_SECRET)).toBe(true);
  });
});
