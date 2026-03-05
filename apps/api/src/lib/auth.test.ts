import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword, signAccessToken, verifyAccessToken, generateRefreshToken } from "../lib/auth.js";

describe("auth helpers", () => {
  describe("password hashing", () => {
    it("hash and verify round-trip works", async () => {
      const password = "MyS3cureP@ss!";
      const hash = await hashPassword(password);
      expect(hash).not.toBe(password);
      expect(await verifyPassword(password, hash)).toBe(true);
    });

    it("verifyPassword returns false for wrong password", async () => {
      const hash = await hashPassword("CorrectP@ss1");
      expect(await verifyPassword("WrongP@ss1", hash)).toBe(false);
    });
  });

  describe("JWT tokens", () => {
    it("signAccessToken produces verifiable token", () => {
      const payload = { sub: "user-1", email: "test@example.com", role: "individual_user" };
      const token = signAccessToken(payload);
      expect(typeof token).toBe("string");

      const decoded = verifyAccessToken(token);
      expect(decoded.sub).toBe("user-1");
      expect(decoded.email).toBe("test@example.com");
      expect(decoded.role).toBe("individual_user");
    });

    it("verifyAccessToken throws for invalid token", () => {
      expect(() => verifyAccessToken("invalid.token.here")).toThrow();
    });
  });

  describe("refresh tokens", () => {
    it("generateRefreshToken returns unique token and future expiry", () => {
      const result = generateRefreshToken();
      expect(typeof result.token).toBe("string");
      expect(result.token.length).toBeGreaterThan(0);
      expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());

      // Two calls should produce different tokens
      const result2 = generateRefreshToken();
      expect(result2.token).not.toBe(result.token);
    });
  });
});
