import { describe, expect, it, vi } from "vitest";

import { checkReadiness } from "./readinessService.js";

describe("readiness checks", () => {
  it("is ready when the database succeeds and Redis is not configured", async () => {
    const result = await checkReadiness({ checkDatabase: vi.fn().mockResolvedValue(undefined) });

    expect(result).toEqual({
      ready: true,
      checks: { database: "ok", redis: "not_configured" },
    });
  });

  it("is unavailable when the database check fails", async () => {
    const result = await checkReadiness({
      checkDatabase: vi.fn().mockRejectedValue(new Error("offline")),
    });

    expect(result.ready).toBe(false);
    expect(result.checks.database).toBe("unavailable");
  });

  it("requires Redis when a Redis check is supplied", async () => {
    const result = await checkReadiness({
      checkDatabase: vi.fn().mockResolvedValue(undefined),
      checkRedis: vi.fn().mockRejectedValue(new Error("offline")),
    });

    expect(result).toEqual({
      ready: false,
      checks: { database: "ok", redis: "unavailable" },
    });
  });
});
