import type { Request } from "express";
import { describe, expect, it, vi } from "vitest";

const auditLogs = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock("../lib/prisma.js", () => ({
  prisma: {
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        auditLogs.push(data);
        return data;
      },
    },
  },
}));

import { logDeniedAction } from "./authorization.js";

describe("logDeniedAction", () => {
  it("records the client IP resolved through the trusted proxy, not a client-supplied header", async () => {
    const req = {
      ip: "203.0.113.10",
      headers: { "x-forwarded-for": "6.6.6.6, 203.0.113.10" },
      user: { id: "user-1", email: "user@example.test", role: "individual_user" },
      method: "POST",
      path: "/sessions/s1/analyze",
      params: { id: "s1" },
    } as unknown as Request;

    await logDeniedAction(req, "trigger_analysis", "s1");

    expect(auditLogs[0]).toMatchObject({ eventType: "authz_denied", ip: "203.0.113.10" });
  });
});
