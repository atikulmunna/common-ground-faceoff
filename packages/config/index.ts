import { z } from "zod";

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PROCESS_ROLE: z.enum(["all", "api", "worker"]).default("all"),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),
  NEXTAUTH_SECRET: z.string().min(32),
  NEXTAUTH_URL: z.string().url().optional(),
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  API_BASE_URL: z.string().url().optional(),
  CORS_ORIGIN: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
  MISTRAL_API_KEY: z.string().min(1).optional(),
  GROQ_API_KEY: z.string().min(1).optional(),
  OPENROUTER_API_KEY: z.string().min(1).optional(),
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
  ENABLE_SAML: z.enum(["true", "false"]).default("false"),
  ENABLE_BILLING: z.enum(["true", "false"]).default("false"),
  ENABLE_SMS_MFA: z.enum(["true", "false"]).default("false"),
  ENABLE_EXTERNAL_EXPORT_STORAGE: z.enum(["true", "false"]).default("false"),
  ENABLE_DATADOG: z.enum(["true", "false"]).default("false")
}).superRefine((env, ctx) => {
  if (env.NODE_ENV === "production" && env.ENABLE_SAML === "true") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["ENABLE_SAML"],
      message: "SAML is experimental and must remain disabled in production",
    });
  }
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
