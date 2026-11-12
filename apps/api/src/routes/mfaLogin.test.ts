import { createHash } from "node:crypto";
import * as OTPAuth from "otpauth";
import request from "supertest";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

// In-memory stand-in for the Prisma calls made by the login and MFA routes.
const db = vi.hoisted(() => {
  const users: Row[] = [];
  const refreshTokens: Row[] = [];
  const auditLogs: Row[] = [];

  const matches = (row: Row, where: Row) =>
    Object.entries(where).every(([key, value]) => row[key] === value);

  const apply = (row: Row, data: Row) => {
    for (const [key, value] of Object.entries(data)) {
      if (value && typeof value === "object" && "increment" in value) {
        row[key] = Number(row[key] ?? 0) + Number((value as { increment: number }).increment);
      } else {
        row[key] = value;
      }
    }
  };

  const prisma = {
    user: {
      findUnique: async ({ where }: { where: Row }) => {
        const row = users.find((user) => matches(user, where));
        return row ? { ...row } : null;
      },
      update: async ({ where, data }: { where: Row; data: Row }) => {
        const row = users.find((user) => matches(user, where));
        if (!row) throw new Error("Record to update not found");
        apply(row, data);
        return { ...row };
      },
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        const rows = users.filter((user) => matches(user, where));
        rows.forEach((row) => apply(row, data));
        return { count: rows.length };
      },
    },
    refreshToken: {
      create: async ({ data }: { data: Row }) => {
        refreshTokens.push(data);
        return data;
      },
    },
    auditLog: {
      create: async ({ data }: { data: Row }) => {
        auditLogs.push(data);
        return data;
      },
    },
  };

  return { users, refreshTokens, auditLogs, prisma };
});

vi.mock("../lib/prisma.js", () => ({ prisma: db.prisma }));

import { createApp } from "../app.js";
import { hashPassword } from "../lib/auth.js";

const PASSWORD = "Correct-Horse-Battery-9";
// Long enough to pass ticket validation, so the test proves the id itself is rejected.
const USER_ID = "user-id-that-is-public-to-co-participants";
const totpSecret = new OTPAuth.Secret({ size: 20 }).base32;
let passwordHash = "";

function totpCode(offsetSteps = 0): string {
  return new OTPAuth.TOTP({
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(totpSecret),
  }).generate({ timestamp: Date.now() + offsetSteps * 30_000 });
}

function wrongCode(): string {
  const accepted = new Set([-1, 0, 1].map(totpCode));
  const candidate = ["000000", "111111", "222222", "333333"].find((code) => !accepted.has(code));
  if (!candidate) throw new Error("No wrong code available");
  return candidate;
}

function seedUser(overrides: Row = {}): Row {
  const user: Row = {
    id: USER_ID,
    email: "mfa-user@example.test",
    displayName: "MFA User",
    role: "individual_user",
    passwordHash,
    emailVerified: true,
    mfaEnabled: true,
    mfaSecret: totpSecret,
    smsMfaEnabled: false,
    smsPhone: null,
    failedLoginCount: 0,
    lockedUntil: null,
    mfaTicketHash: null,
    mfaTicketExpiresAt: null,
    ...overrides,
  };
  db.users.push(user);
  return user;
}

describe("MFA login", () => {
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    passwordHash = await hashPassword(PASSWORD);
  });

  beforeEach(() => {
    db.users.length = 0;
    db.refreshTokens.length = 0;
    db.auditLogs.length = 0;
    app = createApp();
  });

  async function passwordStep(): Promise<string> {
    const response = await request(app)
      .post("/auth/login")
      .send({ email: "mfa-user@example.test", password: PASSWORD })
      .expect(200);
    return response.body.data.mfaTicket as string;
  }

  function verify(mfaTicket: string, token: string) {
    return request(app).post("/mfa/verify-login").send({ mfaTicket, token, mfaType: "totp" });
  }

  it("answers the password step with a random ticket and no tokens", async () => {
    const user = seedUser();

    const response = await request(app)
      .post("/auth/login")
      .send({ email: "mfa-user@example.test", password: PASSWORD })
      .expect(200);

    const { data } = response.body;
    expect(data).toMatchObject({ mfaRequired: true, mfaType: "totp" });
    expect(data.accessToken).toBeUndefined();
    expect(data.mfaTicket).toEqual(expect.any(String));
    expect(data.mfaTicket).not.toBe(USER_ID);
    expect(data.mfaTicket.length).toBeGreaterThanOrEqual(32);
    // Only a hash of the ticket is stored.
    expect(user.mfaTicketHash).toBe(createHash("sha256").update(data.mfaTicket).digest("hex"));
    expect((user.mfaTicketExpiresAt as Date).getTime()).toBeGreaterThan(Date.now());
  });

  it("does not accept the user's id as a ticket", async () => {
    seedUser();
    await passwordStep();

    const response = await verify(USER_ID, totpCode());

    expect(response.status).toBe(401);
    expect(db.refreshTokens).toHaveLength(0);
  });

  it("signs in with the ticket and a valid code, and the ticket works only once", async () => {
    const user = seedUser({ failedLoginCount: 2 });
    const ticket = await passwordStep();

    const response = await verify(ticket, totpCode()).expect(200);

    expect(response.body.data).toMatchObject({
      user: { id: USER_ID, email: "mfa-user@example.test" },
      accessToken: expect.any(String),
      refreshToken: expect.any(String),
    });
    expect(user.failedLoginCount).toBe(0);
    expect(user.mfaTicketHash).toBeNull();

    await verify(ticket, totpCode()).expect(401);
    expect(db.refreshTokens).toHaveLength(1);
  });

  it("rejects an expired ticket", async () => {
    const user = seedUser();
    const ticket = await passwordStep();
    user.mfaTicketExpiresAt = new Date(Date.now() - 1000);

    const response = await verify(ticket, totpCode());

    expect(response.status).toBe(401);
    expect(response.body.error.message).toMatch(/sign in again/i);
    expect(db.refreshTokens).toHaveLength(0);
  });

  it("locks the account after five wrong codes", async () => {
    const user = seedUser();
    const ticket = await passwordStep();

    for (let attempt = 1; attempt <= 4; attempt++) {
      await verify(ticket, wrongCode()).expect(401);
    }
    await verify(ticket, wrongCode()).expect(423);

    expect(user.lockedUntil).toBeInstanceOf(Date);
    expect(user.mfaTicketHash).toBeNull();
    // Even the right code no longer works, and the password step is locked too.
    await verify(ticket, totpCode()).expect(401);
    await request(app)
      .post("/auth/login")
      .send({ email: "mfa-user@example.test", password: PASSWORD })
      .expect(423);
    expect(db.refreshTokens).toHaveLength(0);
  });

  it("keeps earlier MFA failures when the password is entered again", async () => {
    const user = seedUser({ failedLoginCount: 3 });

    await passwordStep();

    expect(user.failedLoginCount).toBe(3);
  });

  it("still signs in users without MFA in one step", async () => {
    const user = seedUser({ mfaEnabled: false, mfaSecret: null, failedLoginCount: 2 });

    const response = await request(app)
      .post("/auth/login")
      .send({ email: "mfa-user@example.test", password: PASSWORD })
      .expect(200);

    expect(response.body.data.accessToken).toEqual(expect.any(String));
    expect(response.body.data.mfaRequired).toBeUndefined();
    expect(user.failedLoginCount).toBe(0);
  });
});
