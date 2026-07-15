import { afterEach, describe, expect, it } from "vitest";

import { getJwtSecret, getOAuthExchangeSecret, getSmsMfaSecret } from "./runtimeSecrets.js";

const jwtSecret = process.env.NEXTAUTH_SECRET;
const smsSecret = process.env.SMS_MFA_SECRET;
const oauthExchangeSecret = process.env.OAUTH_EXCHANGE_SECRET;

afterEach(() => {
  process.env.NEXTAUTH_SECRET = jwtSecret;
  process.env.SMS_MFA_SECRET = smsSecret;
  process.env.OAUTH_EXCHANGE_SECRET = oauthExchangeSecret;
});

describe("runtime secrets", () => {
  it("rejects missing and short JWT secrets", () => {
    delete process.env.NEXTAUTH_SECRET;
    expect(() => getJwtSecret()).toThrow(/NEXTAUTH_SECRET/);

    process.env.NEXTAUTH_SECRET = "too-short";
    expect(() => getJwtSecret()).toThrow(/at least 32/);
  });

  it("requires a separate SMS MFA secret", () => {
    delete process.env.SMS_MFA_SECRET;
    expect(() => getSmsMfaSecret()).toThrow(/SMS_MFA_SECRET/);
  });

  it("requires a separate OAuth exchange secret", () => {
    delete process.env.OAUTH_EXCHANGE_SECRET;
    expect(() => getOAuthExchangeSecret()).toThrow(/OAUTH_EXCHANGE_SECRET/);
  });
});
