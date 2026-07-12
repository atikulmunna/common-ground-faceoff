import { afterEach, describe, expect, it } from "vitest";

import { getJwtSecret, getSmsMfaSecret } from "./runtimeSecrets.js";

const jwtSecret = process.env.NEXTAUTH_SECRET;
const smsSecret = process.env.SMS_MFA_SECRET;

afterEach(() => {
  process.env.NEXTAUTH_SECRET = jwtSecret;
  process.env.SMS_MFA_SECRET = smsSecret;
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
});
