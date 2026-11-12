import { createHash } from "node:crypto";
import request from "supertest";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

// In-memory stand-in for the Prisma calls made by login, refresh, logout and email verification.
const db = vi.hoisted(() => {
  const users: Row[] = [];
  const refreshTokens: Row[] = [];
  const verificationTokens: Row[] = [];
  let nextId = 1;

  const matches = (row: Row, where: Row) => Object.entries(where).every(([key, value]) => row[key] === value);
  const withUser = (row: Row | undefined) =>
    row ? { ...row, user: users.find((user) => user.id === row.userId) } : null;

  const prisma = {
    user: {
      findUnique: async ({ where }: { where: Row }) => {
        const user = users.find((row) => matches(row, where));
        return user ? { ...user } : null;
      },
      create: async ({ data }: { data: Row }) => {
        const user = { id: `user-${nextId++}`, failedLoginCount: 0, lockedUntil: null, mfaEnabled: false, smsMfaEnabled: false, ...data };
        users.push(user);
        return { ...user };
      },
      update: async ({ where, data }: { where: Row; data: Row }) => {
        const user = users.find((row) => matches(row, where));
        if (!user) throw new Error("Record to update not found");
        Object.assign(user, data);
        return { ...user };
      },
    },
    refreshToken: {
      create: async ({ data }: { data: Row }) => {
        const row = { id: `refresh-${nextId++}`, ...data };
        refreshTokens.push(row);
        return row;
      },
      findUnique: async ({ where }: { where: Row }) => withUser(refreshTokens.find((row) => matches(row, where))),
      delete: async ({ where }: { where: Row }) => {
        const index = refreshTokens.findIndex((row) => matches(row, where));
        return refreshTokens.splice(index, 1)[0];
      },
      deleteMany: async ({ where }: { where: Row }) => {
        const before = refreshTokens.length;
        for (let i = refreshTokens.length - 1; i >= 0; i--) {
          if (matches(refreshTokens[i], where)) refreshTokens.splice(i, 1);
        }
        return { count: before - refreshTokens.length };
      },
    },
    emailVerificationToken: {
      create: async ({ data }: { data: Row }) => {
        const row = { id: `verify-${nextId++}`, ...data };
        verificationTokens.push(row);
        return row;
      },
      findUnique: async ({ where }: { where: Row }) => withUser(verificationTokens.find((row) => matches(row, where))),
      delete: async () => ({}),
      deleteMany: async ({ where }: { where: Row }) => {
        for (let i = verificationTokens.length - 1; i >= 0; i--) {
          if (matches(verificationTokens[i], where)) verificationTokens.splice(i, 1);
        }
        return {};
      },
    },
    auditLog: { create: async ({ data }: { data: Row }) => data },
    $transaction: async (operations: Promise<unknown>[]) => Promise.all(operations),
  };

  return { users, refreshTokens, verificationTokens, prisma };
});

vi.mock("../lib/prisma.js", () => ({ prisma: db.prisma }));

const sentVerificationUrls = vi.hoisted(() => [] as string[]);
vi.mock("../services/emailService.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/emailService.js")>()),
  sendEmailVerification: async ({ verifyUrl }: { verifyUrl: string }) => {
    sentVerificationUrls.push(verifyUrl);
    return true;
  },
}));

import { createApp } from "../app.js";
import { hashPassword } from "../lib/auth.js";

const PASSWORD = "Correct-Horse-Battery-9";
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
let passwordHash = "";

describe("stored login and verification tokens", () => {
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    passwordHash = await hashPassword(PASSWORD);
  });

  beforeEach(() => {
    db.users.length = 0;
    db.refreshTokens.length = 0;
    db.verificationTokens.length = 0;
    sentVerificationUrls.length = 0;
    db.users.push({
      id: "user-0",
      email: "member@example.test",
      displayName: "Member",
      role: "individual_user",
      passwordHash,
      emailVerified: true,
      mfaEnabled: false,
      smsMfaEnabled: false,
      failedLoginCount: 0,
      lockedUntil: null,
    });
    app = createApp();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function login(): Promise<string> {
    const response = await request(app)
      .post("/auth/login")
      .send({ email: "member@example.test", password: PASSWORD })
      .expect(200);
    return response.body.data.refreshToken as string;
  }

  it("stores only a hash of the refresh token it hands out", async () => {
    const refreshToken = await login();

    expect(db.refreshTokens).toHaveLength(1);
    expect(db.refreshTokens[0].tokenHash).toBe(sha256(refreshToken));
    expect(JSON.stringify(db.refreshTokens)).not.toContain(refreshToken);
  });

  it("rotates a refresh token presented in full, again storing only the hash", async () => {
    const original = await login();

    const response = await request(app).post("/auth/refresh").send({ refreshToken: original }).expect(200);
    const rotated = response.body.data.refreshToken as string;

    expect(rotated).not.toBe(original);
    expect(db.refreshTokens.map((row) => row.tokenHash)).toEqual([sha256(rotated)]);
    await request(app).post("/auth/refresh").send({ refreshToken: original }).expect(401);
  });

  it("does not accept a stored hash in place of the token", async () => {
    await login();
    const storedHash = db.refreshTokens[0].tokenHash as string;

    await request(app).post("/auth/refresh").send({ refreshToken: storedHash }).expect(401);
  });

  it("revokes the presented refresh token on logout", async () => {
    const refreshToken = await login();

    await request(app).post("/auth/logout").send({ refreshToken }).expect(200);

    expect(db.refreshTokens).toHaveLength(0);
  });

  it("stores only a hash of the email verification token, and the emailed link still verifies", async () => {
    vi.stubEnv("ENABLE_PUBLIC_REGISTRATION", "true");

    await request(app)
      .post("/auth/register")
      .send({ email: "new@example.test", displayName: "New Person", password: PASSWORD })
      .expect(201);

    const token = new URL(sentVerificationUrls[0]).searchParams.get("token") ?? "";
    expect(db.verificationTokens[0].tokenHash).toBe(sha256(token));
    expect(JSON.stringify(db.verificationTokens)).not.toContain(token);

    await request(app).post("/auth/verify-email").send({ token }).expect(200);
    expect(db.users.find((user) => user.email === "new@example.test")?.emailVerified).toBe(true);
  });
});
