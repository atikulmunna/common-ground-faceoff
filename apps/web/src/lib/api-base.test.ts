import { afterEach, describe, expect, it } from "vitest";

import { getPublicApiBaseUrl, getServerApiBaseUrl } from "./api-base";

const originalApiBase = process.env.API_BASE_URL;
const originalPublicApiBase = process.env.NEXT_PUBLIC_API_BASE_URL;

afterEach(() => {
  process.env.API_BASE_URL = originalApiBase;
  process.env.NEXT_PUBLIC_API_BASE_URL = originalPublicApiBase;
});

describe("API base URL configuration", () => {
  it("uses a stable local default", () => {
    delete process.env.API_BASE_URL;
    delete process.env.NEXT_PUBLIC_API_BASE_URL;

    expect(getPublicApiBaseUrl()).toBe("http://localhost:4100");
    expect(getServerApiBaseUrl()).toBe("http://localhost:4100");
  });

  it("keeps server-only configuration out of the public resolver", () => {
    process.env.API_BASE_URL = "http://api.internal:4100/";
    process.env.NEXT_PUBLIC_API_BASE_URL = "https://api.example.com/";

    expect(getServerApiBaseUrl()).toBe("http://api.internal:4100");
    expect(getPublicApiBaseUrl()).toBe("https://api.example.com");
  });
});
