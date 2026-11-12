import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApp } from "./app.js";

describe("client IP behind the reverse proxy", () => {
  const RATE_LIMIT = 100;

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("gives each client its own rate-limit bucket", async () => {
    const app = createApp();

    for (let i = 0; i < RATE_LIMIT; i++) {
      await request(app).get("/health").set("X-Forwarded-For", "203.0.113.10").expect(200);
    }

    await request(app).get("/health").set("X-Forwarded-For", "203.0.113.10").expect(429);
    await request(app).get("/health").set("X-Forwarded-For", "203.0.113.20").expect(200);
  });

  it("ignores entries a client adds in front of the proxy's own", async () => {
    const app = createApp();

    for (let i = 0; i < RATE_LIMIT; i++) {
      await request(app).get("/health").set("X-Forwarded-For", `198.51.100.${i}, 203.0.113.10`).expect(200);
    }

    await request(app).get("/health").set("X-Forwarded-For", "198.51.100.250, 203.0.113.10").expect(429);
  });

  it("can be told not to trust any proxy", () => {
    vi.stubEnv("TRUST_PROXY_HOPS", "0");

    expect(createApp().get("trust proxy")).toBe(0);
  });
});

describe("API application", () => {
  const app = createApp();

  it("serves liveness without opening a network port", async () => {
    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: { status: "alive" },
      error: null,
    });
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("protects authenticated routes", async () => {
    const response = await request(app).get("/sessions");

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("auth_error");
  });

  it("rejects public OAuth exchange requests", async () => {
    const response = await request(app)
      .post("/auth/oauth-exchange")
      .send({ email: "attacker@example.test", displayName: "Attacker", provider: "google" });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("auth_error");
  });

  it("keeps public registration closed by default", async () => {
    const response = await request(app)
      .post("/auth/register")
      .send({
        email: "uninvited@example.test",
        displayName: "Uninvited User",
        password: "SecurePassword!234",
      });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("auth_error");
  });
});
