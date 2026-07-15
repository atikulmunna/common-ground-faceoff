import { defineConfig, devices } from "@playwright/test";

const databaseUrl = process.env.E2E_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("E2E_DATABASE_URL is required; run E2E through npm run test:e2e");
}

const sharedSecret = "e2e-nextauth-secret-at-least-32-characters";
const oauthExchangeSecret = "e2e-oauth-exchange-secret-at-least-32-characters";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: "http://127.0.0.1:3310",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: [
    {
      command: "npm -w @common-ground/api run dev",
      url: "http://127.0.0.1:4310/health",
      timeout: 60_000,
      reuseExistingServer: false,
      env: {
        DATABASE_URL: databaseUrl,
        NEXTAUTH_SECRET: sharedSecret,
        OAUTH_EXCHANGE_SECRET: oauthExchangeSecret,
        NODE_ENV: "test",
        API_PROCESS_ROLE: "api",
        HOST: "127.0.0.1",
        PORT: "4310",
        CORS_ORIGIN: "http://127.0.0.1:3310",
        REDIS_URL: "",
        UPSTASH_REDIS_REST_URL: "",
        UPSTASH_REDIS_REST_TOKEN: "",
        ENABLE_SAML: "false",
        ENABLE_BILLING: "false",
        ENABLE_SMS_MFA: "false",
        ENABLE_EXTERNAL_EXPORT_STORAGE: "false",
        RESEND_API_KEY: "",
        SENDGRID_API_KEY: "",
      },
    },
    {
      command: "npm -w @common-ground/web run dev -- --hostname 127.0.0.1 --port 3310",
      url: "http://127.0.0.1:3310/sign-in",
      timeout: 60_000,
      reuseExistingServer: false,
      env: {
        NEXTAUTH_SECRET: sharedSecret,
        OAUTH_EXCHANGE_SECRET: oauthExchangeSecret,
        NEXTAUTH_URL: "http://127.0.0.1:3310",
        API_BASE_URL: "http://127.0.0.1:4310",
        NEXT_PUBLIC_API_BASE_URL: "http://127.0.0.1:4310",
      },
    },
  ],
});
