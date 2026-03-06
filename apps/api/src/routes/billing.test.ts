import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { verifyStripeSignature } from "./billing.js";

function buildSignature(payload: string, secret: string, timestampOverride?: number): string {
  const timestamp = timestampOverride ?? Math.floor(Date.now() / 1000);
  const signedPayload = `${timestamp}.${payload}`;
  const hmac = createHmac("sha256", secret).update(signedPayload).digest("hex");
  return `t=${timestamp},v1=${hmac}`;
}

describe("verifyStripeSignature (CG-FR67)", () => {
  const secret = "whsec_test_secret_123";
  const payload = '{"id":"evt_1","type":"test"}';

  it("accepts valid signature", () => {
    const sig = buildSignature(payload, secret);
    expect(verifyStripeSignature(payload, sig, secret)).toBe(true);
  });

  it("rejects invalid signature", () => {
    const sig = `t=${Math.floor(Date.now() / 1000)},v1=invalidsignature`;
    expect(verifyStripeSignature(payload, sig, secret)).toBe(false);
  });

  it("rejects wrong secret", () => {
    const sig = buildSignature(payload, secret);
    expect(verifyStripeSignature(payload, sig, "wrong_secret")).toBe(false);
  });

  it("rejects tampered payload", () => {
    const sig = buildSignature(payload, secret);
    expect(verifyStripeSignature('{"id":"evt_2","type":"test"}', sig, secret)).toBe(false);
  });

  it("rejects replay attack (timestamp > 5 min old)", () => {
    const oldTimestamp = Math.floor(Date.now() / 1000) - 400; // 6+ minutes ago
    const sig = buildSignature(payload, secret, oldTimestamp);
    expect(verifyStripeSignature(payload, sig, secret)).toBe(false);
  });

  it("rejects missing header parts", () => {
    expect(verifyStripeSignature(payload, "v1=abc", secret)).toBe(false);
    expect(verifyStripeSignature(payload, "t=123", secret)).toBe(false);
  });
});
