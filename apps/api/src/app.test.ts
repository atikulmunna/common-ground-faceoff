import request from "supertest";
import { describe, expect, it } from "vitest";

import { createApp } from "./app.js";

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
