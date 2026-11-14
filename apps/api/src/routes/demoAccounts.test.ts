import bcrypt from "bcrypt";
import request from "supertest";
import { passwordSchema } from "@common-ground/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

// In-memory stand-in for the Prisma calls behind admin account creation, password changes and the
// first-admin setup.
const db = vi.hoisted(() => {
  const state = { users: [] as Row[], organizations: [] as Row[], audit: [] as Row[] };
  const find = (where: Row) =>
    state.users.find((user) => (where.id ? user.id === where.id : user.email === where.email)) ?? null;
  const prisma = {
    user: {
      findUnique: async ({ where }: { where: Row }) => {
        const user = find(where);
        return user ? { accountDeletedAt: null, ...user } : null;
      },
      count: async ({ where }: { where: Row }) => state.users.filter((user) => user.role === where.role && !user.accountDeletedAt).length,
      upsert: async ({ where, create, update }: { where: Row; create: Row; update: Row }) => {
        const existing = find(where);
        if (existing) return Object.assign(existing, update);
        const row = { id: `user-${state.users.length + 1}`, role: "individual_user", ...create };
        state.users.push(row);
        return row;
      },
      update: async ({ where, data }: { where: Row; data: Row }) => Object.assign(find(where) ?? {}, data),
    },
    organization: {
      create: async ({ data }: { data: Row }) => {
        const row = { id: `org-${state.organizations.length + 1}`, ...data };
        state.organizations.push(row);
        return row;
      },
    },
    auditLog: {
      create: async ({ data }: { data: Row }) => {
        state.audit.push(data);
        return data;
      },
    },
  };
  return { state, prisma };
});

vi.mock("../lib/prisma.js", () => ({ prisma: db.prisma }));

import { createApp } from "../app.js";
import { signAccessToken } from "../lib/auth.js";
import { prepareAdminSetup } from "../services/adminSetup.js";

const tokenFor = (id: string, role = "individual_user") =>
  `Bearer ${signAccessToken({ sub: id, email: `${id}@example.test`, role })}`;

beforeEach(() => {
  db.state.users = [
    { id: "admin", email: "admin@example.test", role: "institutional_admin", organizationId: "org-a", passwordHash: "x", emailVerified: true },
    { id: "member", email: "member@example.test", role: "individual_user", organizationId: null, passwordHash: "x", emailVerified: true },
  ];
  db.state.organizations = [];
  db.state.audit = [];
});

describe("POST /admin/accounts", () => {
  const create = (body: Row, role = "institutional_admin", id = "admin") =>
    request(createApp()).post("/admin/accounts").set("Authorization", tokenFor(id, role)).send(body);

  it("is for organization admins only", async () => {
    await create({ email: "guest@example.test", displayName: "Guest" }, "individual_user", "member").expect(403);
  });

  it("gives a new person a verified account in the admin's organization, with a one-time password", async () => {
    const response = await create({ email: " Guest@Example.test ", displayName: "Guest" }).expect(201);

    const password = response.body.data.temporaryPassword as string;
    expect(passwordSchema.safeParse(password).success).toBe(true);
    const account = db.state.users.find((user) => user.email === "guest@example.test")!;
    expect(account).toMatchObject({ displayName: "Guest", emailVerified: true, passwordChangeRequired: true, organizationId: "org-a" });
    expect(await bcrypt.compare(password, account.passwordHash as string)).toBe(true);
    expect(JSON.stringify(db.state.audit)).not.toContain(password);
    expect(db.state.audit.at(-1)).toMatchObject({ eventType: "admin_created_account", actorId: "admin" });
  });

  it("activates the account a conversation invitation created", async () => {
    db.state.users.push({ id: "invited", email: "invited@example.test", displayName: "invited", passwordHash: null, emailVerified: false, organizationId: null });

    const response = await create({ email: "invited@example.test", displayName: "Val" }).expect(200);

    expect(db.state.users.find((user) => user.id === "invited")).toMatchObject({ displayName: "Val", emailVerified: true, passwordChangeRequired: true });
    expect(response.body.data.account.id).toBe("invited");
  });

  it("leaves alone someone who can already sign in, or who belongs to another organization", async () => {
    await create({ email: "member@example.test", displayName: "Member" }).expect(409);
    db.state.users.push({ id: "other", email: "other@example.test", passwordHash: null, organizationId: "org-b" });
    await create({ email: "other@example.test", displayName: "Other" }).expect(409);
  });
});

describe("POST /profile/password", () => {
  beforeEach(async () => {
    db.state.users.push({
      id: "guest",
      email: "guest@example.test",
      role: "individual_user",
      passwordHash: await bcrypt.hash("Temporary9!pass", 4),
      emailVerified: true,
      passwordChangeRequired: true,
    });
  });
  const change = (body: Row) =>
    request(createApp()).post("/profile/password").set("Authorization", tokenFor("guest")).send(body);

  it("needs the current password", async () => {
    const response = await change({ currentPassword: "wrong", newPassword: "MyOwn9!password" }).expect(400);
    expect(response.body.error.message).toBe("Your current password is not right.");
  });

  it("applies the password rules to the new one", async () => {
    const response = await change({ currentPassword: "Temporary9!pass", newPassword: "short" }).expect(400);
    expect(response.body.error.message).toMatch(/at least 10 characters/);
  });

  it("changes the password and clears the temporary flag", async () => {
    await change({ currentPassword: "Temporary9!pass", newPassword: "MyOwn9!password" }).expect(200);

    const guest = db.state.users.find((user) => user.id === "guest")!;
    expect(guest.passwordChangeRequired).toBe(false);
    expect(await bcrypt.compare("MyOwn9!password", guest.passwordHash as string)).toBe(true);
  });
});

describe("first organization admin", () => {
  const PASSWORD = "Admin-pass-2026!";
  const claim = (code: string, email = "member@example.test") =>
    request(createApp())
      .post("/admin-setup/claim")
      .send({ code, displayName: "Munna", email, password: PASSWORD, organizationName: "Demo team" });
  const withoutAdmin = () => {
    db.state.users = db.state.users.filter((user) => user.role !== "institutional_admin");
  };

  it("logs no code while an admin exists", async () => {
    const log = vi.fn();
    await expect(prepareAdminSetup(log)).resolves.toBeNull();
    expect(log).not.toHaveBeenCalled();
  });

  it("makes an existing account the admin of a new organization with a new password, once, without signing in", async () => {
    withoutAdmin();
    const log = vi.fn();
    const code = (await prepareAdminSetup(log))!;
    expect(log.mock.calls[0][0]).toContain(code);

    await claim("WRONG-CODE-0000").expect(403);
    await claim(code.toLowerCase()).expect(200);

    const member = db.state.users.find((user) => user.id === "member")!;
    expect(member).toMatchObject({ role: "institutional_admin", organizationId: "org-1", passwordChangeRequired: false });
    await expect(bcrypt.compare(PASSWORD, member.passwordHash as string)).resolves.toBe(true);
    expect(db.state.organizations[0]).toMatchObject({ name: "Demo team" });
    expect(JSON.stringify(db.state.audit)).not.toContain(PASSWORD);
    await claim(code).expect(409);
  });

  it("creates the admin account when the email is new", async () => {
    withoutAdmin();
    const code = (await prepareAdminSetup(vi.fn()))!;

    await claim(code, "New.Person@Example.test").expect(200);

    expect(db.state.users.find((user) => user.email === "new.person@example.test")).toMatchObject({
      displayName: "Munna",
      role: "institutional_admin",
      emailVerified: true,
    });
  });

  it("applies the password rules and refuses a deleted account", async () => {
    withoutAdmin();
    const code = (await prepareAdminSetup(vi.fn()))!;

    const weak = await request(createApp())
      .post("/admin-setup/claim")
      .send({ code, displayName: "Munna", email: "member@example.test", password: "short", organizationName: "Demo team" })
      .expect(400);
    expect(weak.body.error.message).toMatch(/at least 10 characters/);

    db.state.users.find((user) => user.id === "member")!.accountDeletedAt = new Date();
    await claim(code).expect(409);
  });

  it("finds the code in pasted log text, including a trailing \n", async () => {
    withoutAdmin();
    const code = (await prepareAdminSetup(vi.fn()))!;

    await claim(`${code}\n`).expect(200);
  });

  it("accepts the whole log line as pasted", async () => {
    withoutAdmin();
    const log = vi.fn();
    await prepareAdminSetup(log);
    const line = `{"log":"${log.mock.calls[0][0]}\n","stream":"stdout"}`;

    await claim(line).expect(200);
  });
});

describe("signed-out requests", () => {
  it("are told to sign in, in plain words", async () => {
    const response = await request(createApp()).post("/admin/accounts").send({}).expect(401);
    expect(response.body.error.message).toBe("You are not signed in. Sign in and try again.");
  });
});
