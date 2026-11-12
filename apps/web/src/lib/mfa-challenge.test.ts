import { describe, expect, it } from "vitest";

import { encodeMfaChallenge, parseMfaChallenge } from "./mfa-challenge";

describe("MFA challenge hand-off", () => {
  it("round-trips a challenge through the sign-in error string", () => {
    const challenge = { mfaType: "totp" as const, mfaTicket: "Abc_123-xyz" };

    expect(parseMfaChallenge(encodeMfaChallenge(challenge))).toEqual(challenge);
  });

  it("supports SMS challenges", () => {
    expect(parseMfaChallenge(encodeMfaChallenge({ mfaType: "sms", mfaTicket: "ticket" }))).toEqual({
      mfaType: "sms",
      mfaTicket: "ticket",
    });
  });

  it("ignores ordinary sign-in errors", () => {
    expect(parseMfaChallenge("Invalid email or password")).toBeNull();
    expect(parseMfaChallenge(undefined)).toBeNull();
    expect(parseMfaChallenge(null)).toBeNull();
  });

  it("rejects malformed challenges", () => {
    expect(parseMfaChallenge("MFA_REQUIRED:email:ticket")).toBeNull();
    expect(parseMfaChallenge("MFA_REQUIRED:totp:")).toBeNull();
  });
});
