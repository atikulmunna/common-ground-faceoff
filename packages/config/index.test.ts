import { describe, expect, it } from "vitest";

import { featureEnabled, parseEnv } from "./index";

const requiredEnv = {
  DATABASE_URL: "postgresql://user:password@localhost:5432/common_ground",
  NEXTAUTH_SECRET: "test-nextauth-secret-at-least-32-characters",
};

describe("parseEnv", () => {
  it("applies defaults and accepts the required production-independent values", () => {
    expect(parseEnv(requiredEnv)).toMatchObject({
      ...requiredEnv,
      NODE_ENV: "development",
    });
  });

  it("treats empty optional values as absent", () => {
    expect(parseEnv({ ...requiredEnv, SENTRY_DSN: "" }).SENTRY_DSN).toBeUndefined();
  });

  it("rejects malformed URLs", () => {
    expect(() => parseEnv({ ...requiredEnv, DATABASE_URL: "not-a-url" })).toThrow();
  });

  it("keeps optional launch features disabled by default", () => {
    const env = parseEnv(requiredEnv);

    expect(env.ENABLE_SAML).toBe("false");
    expect(env.ENABLE_PUBLIC_REGISTRATION).toBe("false");
    expect(env.ENABLE_BILLING).toBe("false");
    expect(featureEnabled(env.ENABLE_SAML)).toBe(false);
    expect(featureEnabled("true")).toBe(true);
  });

  it("trusts one reverse proxy by default and accepts an explicit hop count", () => {
    expect(parseEnv(requiredEnv).TRUST_PROXY_HOPS).toBe(1);
    expect(parseEnv({ ...requiredEnv, TRUST_PROXY_HOPS: "0" }).TRUST_PROXY_HOPS).toBe(0);
    expect(() => parseEnv({ ...requiredEnv, TRUST_PROXY_HOPS: "-1" })).toThrow();
  });

  it("accepts only OpenRouter's cost tiers", () => {
    expect(parseEnv({ ...requiredEnv, OPENROUTER_COST_TIER: "medium" }).OPENROUTER_COST_TIER).toBe("medium");
    expect(() => parseEnv({ ...requiredEnv, OPENROUTER_COST_TIER: "balanced" })).toThrow();
  });

  it("refuses to enable experimental SAML in production", () => {
    expect(() => parseEnv({
      ...requiredEnv,
      NODE_ENV: "production",
      ENABLE_SAML: "true",
    })).toThrow(/SAML is experimental/);
  });

  it("allows experimental SAML only outside production", () => {
    expect(parseEnv({
      ...requiredEnv,
      NODE_ENV: "development",
      ENABLE_SAML: "true",
    }).ENABLE_SAML).toBe("true");
  });
});
