import { describe, expect, it, vi } from "vitest";

import { checkReadiness } from "./readinessService.js";

describe("readiness checks", () => {
  it("is ready when the database answers", async () => {
    const result = await checkReadiness({ checkDatabase: vi.fn().mockResolvedValue(undefined) });

    expect(result).toEqual({ ready: true, checks: { database: "ok" } });
  });

  it("is unavailable when the database check fails", async () => {
    const result = await checkReadiness({
      checkDatabase: vi.fn().mockRejectedValue(new Error("offline")),
    });

    expect(result).toEqual({ ready: false, checks: { database: "unavailable" } });
  });
});
