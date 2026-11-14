import { z } from "zod";

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PROCESS_ROLE: z.enum(["all", "api", "worker"]).default("all"),
  DATABASE_URL: z.string().url(),
  NEXTAUTH_SECRET: z.string().min(32),
  NEXTAUTH_URL: z.string().url().optional(),
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  API_BASE_URL: z.string().url().optional(),
  CORS_ORIGIN: z.string().optional(),
  // Reverse proxies in front of the API (Caddy = 1). Use 0 only if the API is reached directly.
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
  OPENROUTER_API_KEY: z.string().min(1).optional(),
  // Defaults to the Auto Router ("openrouter/auto"); set a model id to pin one model instead.
  OPENROUTER_MODEL: z.string().min(1).optional(),
  // Auto Router only: cost percentile band (low 0-20, medium 20-40, high 40-60, ...). Default medium.
  OPENROUTER_COST_TIER: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
  // Auto Router only: comma-separated model patterns it may choose from, e.g. "openai/*,google/*".
  OPENROUTER_ALLOWED_MODELS: z.string().min(1).optional(),
  RESEND_API_KEY: z.string().min(1).optional(),
  RESEND_FROM_EMAIL: z.string().min(1).optional(),
  TWILIO_ACCOUNT_SID: z.string().min(1).optional(),
  TWILIO_AUTH_TOKEN: z.string().min(1).optional(),
  TWILIO_FROM_PHONE: z.string().min(1).optional(),
  SMS_MFA_SECRET: z.string().min(32).optional(),
  SENDGRID_API_KEY: z.string().min(1).optional(),
  STRIPE_SECRET_KEY: z.string().min(1).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
  STRIPE_PRICE_PRO: z.string().min(1).optional(),
  STRIPE_PRICE_ENTERPRISE: z.string().min(1).optional(),
  SENTRY_DSN: z.string().min(1).optional(),
  ENABLE_PUBLIC_REGISTRATION: z.enum(["true", "false"]).default("false"),
  ENABLE_BILLING: z.enum(["true", "false"]).default("false"),
  ENABLE_SMS_MFA: z.enum(["true", "false"]).default("false"),
  ENABLE_EXTERNAL_EXPORT_STORAGE: z.enum(["true", "false"]).default("false"),
  ENABLE_DATADOG: z.enum(["true", "false"]).default("false")
});

export type AppEnv = z.infer<typeof envSchema>;

export function parseEnv(input: Record<string, string | undefined>): AppEnv {
  // Treat empty strings as undefined so optional .min(1) fields don't fail
  const cleaned: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(input)) {
    cleaned[key] = value === "" ? undefined : value;
  }
  return envSchema.parse(cleaned);
}

export function featureEnabled(value: string | undefined): boolean {
  return value === "true";
}
