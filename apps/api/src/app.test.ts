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
});
