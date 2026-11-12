import { afterEach, describe, expect, it, vi } from "vitest";

import { authOptions } from "./auth-options";

type Authorize = (
  credentials: Record<string, string>,
  req: { headers: Record<string, string> },
) => Promise<unknown>;

function credentialsAuthorize(): Authorize {
  const provider = authOptions.providers.find((entry) => entry.id === "credentials");
  return (provider as unknown as { options: { authorize: Authorize } }).options.authorize;
}

function mockApiSignIn() {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      success: true,
      data: {
        user: { id: "user-1", email: "user@example.test", displayName: "User", role: "individual_user" },
        accessToken: "access",
        refreshToken: "refresh",
      },
    }),
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function sentHeaders(fetchMock: ReturnType<typeof vi.fn>): Record<string, string> {
  return (fetchMock.mock.calls[0][1] as { headers: Record<string, string> }).headers;
}

describe("credentials sign-in", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("passes the visitor's forwarded IP to the API on the password step", async () => {
    const fetchMock = mockApiSignIn();

    await credentialsAuthorize()(
      { email: "user@example.test", password: "secret" },
      { headers: { "x-forwarded-for": "203.0.113.10" } },
    );

    expect(sentHeaders(fetchMock)).toMatchObject({ "X-Forwarded-For": "203.0.113.10" });
  });

  it("passes the visitor's forwarded IP to the API on the code step", async () => {
    const fetchMock = mockApiSignIn();

    await credentialsAuthorize()(
      { mfaTicket: "ticket", mfaCode: "123456", mfaType: "totp" },
      { headers: { "x-forwarded-for": "203.0.113.10" } },
    );

    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/mfa\/verify-login$/);
    expect(sentHeaders(fetchMock)).toMatchObject({ "X-Forwarded-For": "203.0.113.10" });
  });

  it("sends no forwarding header when the request has none", async () => {
    const fetchMock = mockApiSignIn();

    await credentialsAuthorize()({ email: "user@example.test", password: "secret" }, { headers: {} });

    expect(sentHeaders(fetchMock)).not.toHaveProperty("X-Forwarded-For");
  });
});
