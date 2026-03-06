import { z } from "zod";

export const analysisStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
  "needs_input"
]);

export const roleSchema = z.enum([
  "individual_user",
  "session_creator",
  "session_participant",
  "institutional_admin",
  "moderator"
]);

export const severitySchema = z.enum(["low", "medium", "high", "critical"]);

// CG-FR05: min 10 chars, uppercase, digit, special character
export const passwordSchema = z
  .string()
  .min(10, "Password must be at least 10 characters")
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
  .regex(/\d/, "Password must contain at least one digit")
  .regex(/[^A-Za-z0-9]/, "Password must contain at least one special character");

export const registerSchema = z.object({
  email: z.string().email(),
  password: passwordSchema,
  displayName: z.string().min(1).max(100)
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1)
});

export const createSessionSchema = z.object({
  topic: z.string().min(10).max(500),
  anonymousMode: z.boolean().default(false),
  deadline: z.string().datetime().optional()
});

export const inviteParticipantSchema = z.object({
  email: z.string().email(),
  role: z.enum(["participant", "observer"]).default("participant")
});

export const submitPositionSchema = z.object({
  positionText: z.string().min(100).max(5000),
  roundNumber: z.number().int().positive().default(1)
});

export const analyzeSessionSchema = z.object({
  analysisVersion: z.string().min(1),
  promptTemplateVersion: z.string().min(1),
  runMetadata: z.record(z.string(), z.unknown()).optional()
});

export const feedbackRatingSchema = z.object({
  faithfulness: z.number().int().min(1).max(5),
  neutrality: z.number().int().min(1).max(5),
  comment: z.string().max(1000).optional()
});

export const createShareLinkSchema = z.object({
  expiresAt: z.string().datetime().optional(),
  scope: z.enum(["read_only"]).default("read_only")
});

export const sectionReactionSchema = z.object({
  section: z.string().min(1).max(200),
  reaction: z.enum(["represents", "misrepresents", "neutral"])
});

export const sectionCommentSchema = z.object({
  section: z.string().min(1).max(200),
  text: z.string().min(1).max(2000),
});

export const updateProfileSchema = z.object({
  displayName: z.string().min(1).max(100).optional(),
  avatarUrl: z.string().url().max(500).optional(),
  notificationPreferences: z
    .object({
      emailInvites: z.boolean().optional(),
      emailAnalysisComplete: z.boolean().optional(),
    })
    .optional(),
});

export const oauthExchangeSchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(1).max(100),
  provider: z.enum(["google", "microsoft"])
});

export const mfaSetupVerifySchema = z.object({
  token: z.string().length(6)
});

export const mfaLoginVerifySchema = z.object({
  email: z.string().email(),
  token: z.string().length(6),
  tempTicket: z.string().min(1)
});

export const reportContentSchema = z.object({
  reason: z.string().min(10).max(1000),
  section: z.string().max(200).optional(),
});

export const moderationActionSchema = z.object({
  action: z.enum(["approve", "edit", "delete"]),
  notes: z.string().max(2000).optional(),
  editedContent: z.string().max(5000).optional(),
});

export const apiErrorCodeSchema = z.enum([
  "validation_error",
  "auth_error",
  "authz_error",
  "provider_error",
  "async_state_error",
  "not_found",
  "rate_limited",
  "limit_reached",
  "mfa_required",
  "duplicate_request",
  "internal_error"
]);

export const apiEnvelopeSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    success: z.boolean(),
    data: dataSchema.nullable(),
    error: z
      .object({
        code: apiErrorCodeSchema,
        message: z.string(),
        details: z.unknown().optional()
      })
      .nullable()
  });

export type AnalysisStatus = z.infer<typeof analysisStatusSchema>;
export type Role = z.infer<typeof roleSchema>;
export type Severity = z.infer<typeof severitySchema>;
export type CreateSessionInput = z.infer<typeof createSessionSchema>;
export type InviteParticipantInput = z.infer<typeof inviteParticipantSchema>;
export type SubmitPositionInput = z.infer<typeof submitPositionSchema>;
export type AnalyzeSessionInput = z.infer<typeof analyzeSessionSchema>;
export type FeedbackRatingInput = z.infer<typeof feedbackRatingSchema>;
export type CreateShareLinkInput = z.infer<typeof createShareLinkSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type MfaLoginVerifyInput = z.infer<typeof mfaLoginVerifySchema>;
export type ReportContentInput = z.infer<typeof reportContentSchema>;
export type ModerationActionInput = z.infer<typeof moderationActionSchema>;

/* ------------------------------------------------------------------ */
/*  Batch 4: SAML, Institutional Admin, PII pipeline                   */
/* ------------------------------------------------------------------ */

export const samlLoginSchema = z.object({
  orgSlug: z.string().min(1).max(100),
});

export const createOrganizationSchema = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/, "Slug must be lowercase alphanumeric with hyphens"),
  samlEntryPoint: z.string().url().optional(),
  samlCert: z.string().optional(),
  samlIssuer: z.string().optional(),
  forceAnonymous: z.boolean().default(false),
});

export const createCohortSchema = z.object({
  name: z.string().min(1).max(200),
});

export const cohortMemberSchema = z.object({
  email: z.string().email(),
});

export const adminCreateSessionSchema = z.object({
  topic: z.string().min(10).max(500),
  participantEmails: z.array(z.string().email()).min(2).max(6),
  anonymousMode: z.boolean().default(false),
  deadline: z.string().datetime().optional(),
});

export const analyticsExportSchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export const sessionHeartbeatSchema = z.object({
  sessionId: z.string().min(1),
});

export type SamlLoginInput = z.infer<typeof samlLoginSchema>;
export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
export type CreateCohortInput = z.infer<typeof createCohortSchema>;
export type CohortMemberInput = z.infer<typeof cohortMemberSchema>;
export type AdminCreateSessionInput = z.infer<typeof adminCreateSessionSchema>;
export type AnalyticsExportInput = z.infer<typeof analyticsExportSchema>;

export interface AnalysisResultDto {
  sessionId: string;
  pipelineRunId: string;
  analysisVersion: string;
  promptTemplateVersion: string;
  inputHash: string;
  roundNumber: number;
  parentSessionOrRoundId: string | null;
  status: AnalysisStatus;
  sharedFoundations: string;
  trueDisagreements: string;
  conflictMap: Record<string, unknown>;
  steelmans: Record<string, unknown>;
  confidenceScores: Record<string, number>;
  modelVersion: string;
  llmProvider: string;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/*  Batch 5: Stripe Billing, Email Invitations, Async ETA             */
/* ------------------------------------------------------------------ */

export const emailInvitationSchema = z.object({
  email: z.string().email(),
  message: z.string().max(500).optional(),
});

export const billingCheckoutSchema = z.object({
  priceId: z.string().min(1),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
});

export const billingPortalSchema = z.object({
  returnUrl: z.string().url(),
});

export const stripeWebhookEventSchema = z.object({
  id: z.string(),
  type: z.string(),
  data: z.object({
    object: z.record(z.unknown()),
  }),
});

export type EmailInvitationInput = z.infer<typeof emailInvitationSchema>;
export type BillingCheckoutInput = z.infer<typeof billingCheckoutSchema>;
export type BillingPortalInput = z.infer<typeof billingPortalSchema>;
