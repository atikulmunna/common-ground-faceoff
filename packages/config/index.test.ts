import { describe, expect, it } from "vitest";

import { featureEnabled, parseEnv } from "./index";

const requiredEnv = {
  DATABASE_URL: "postgresql://user:password@localhost:5432/common_ground",
  NEXTAUTH_SECRET: "test-secret",
};

describe("parseEnv", () => {
  it("applies defaults and accepts the required production-independent values", () => {
    expect(parseEnv(requiredEnv)).toMatchObject({
      ...requiredEnv,
      NODE_ENV: "development",
    });
  });

  it("treats empty optional values as absent", () => {
    expect(parseEnv({ ...requiredEnv, REDIS_URL: "" }).REDIS_URL).toBeUndefined();
  });

  it("rejects malformed URLs", () => {
    expect(() => parseEnv({ ...requiredEnv, DATABASE_URL: "not-a-url" })).toThrow();
  });

  it("keeps optional launch features disabled by default", () => {
    const env = parseEnv(requiredEnv);

    expect(env.ENABLE_SAML).toBe("false");
    expect(env.ENABLE_BILLING).toBe("false");
    expect(featureEnabled(env.ENABLE_SAML)).toBe(false);
    expect(featureEnabled("true")).toBe(true);
  });
});
