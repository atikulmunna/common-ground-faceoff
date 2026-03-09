/* ------------------------------------------------------------------ */
/*  Email service — Resend integration (CG-FR10, CG-FR13)              */
/*  Sends session invitations and notification emails.                 */
/* ------------------------------------------------------------------ */

import { withRetryBudget } from "./llmProvider.js";

interface EmailPayload {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface EmailSendResult {
  ok: boolean;
  status?: number;
  providerMessageId?: string;
  error?: string;
}

const RESEND_API_URL = "https://api.resend.com/emails";
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? "Common Ground <onboarding@resend.dev>";

function sanitizeSubjectText(input: string): string {
  // Resend rejects CR/LF in subject fields.
  return input.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
}

async function sendEmail(payload: EmailPayload): Promise<EmailSendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    const error = "RESEND_API_KEY not set";
    console.warn("[Email] Send skipped:", { to: payload.to, error });
    return { ok: false, error };
  }

  const body = {
    from: FROM_EMAIL,
    to: [payload.to],
    subject: payload.subject,
    text: payload.text,
    html: payload.html,
  };

  // CG-NFR39: Bounded retry with 20s total budget
  return withRetryBudget(
    async () => {
      const response = await fetch(RESEND_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Resend ${response.status}: ${errText}`);
      }

      const json = (await response.json().catch(() => null)) as { id?: string } | null;
      return { ok: true, status: response.status, providerMessageId: json?.id };
    },
    { budgetMs: 20_000, label: "resend-email" }
  ).catch((err) => {
    const error = err instanceof Error ? err.message : String(err);
    console.error("[Email] Send failed:", { to: payload.to, subject: payload.subject, error });
    return { ok: false, error };
  });
}

/* ------------------------------------------------------------------ */
/*  Invitation email (CG-FR10, CG-FR13)                                */
/* ------------------------------------------------------------------ */

export async function sendSessionInvitation(options: {
  recipientEmail: string;
  inviterName: string;
  sessionTopic: string;
  sessionId: string;
  message?: string;
}): Promise<boolean> {
  const appUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const joinLink = `${appUrl}/session/${encodeURIComponent(options.sessionId)}`;
  const normalizedTopic = sanitizeSubjectText(options.sessionTopic);

  const subject = `You're invited to a Common Ground session: ${normalizedTopic}`;

  const text = [
    `Hi,`,
    ``,
    `${options.inviterName} has invited you to a Common Ground session.`,
    ``,
    `Topic: ${normalizedTopic}`,
    options.message ? `Message: ${options.message}` : "",
    ``,
    `Join the session: ${joinLink}`,
    ``,
    `Common Ground is an AI-mediated platform for productive discourse.`,
    `If you don't have an account, you'll be prompted to create one.`,
  ]
    .filter(Boolean)
    .join("\n");

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #1a1a2e;">You're Invited to Common Ground</h2>
      <p><strong>${escapeHtml(options.inviterName)}</strong> has invited you to share your perspective on:</p>
      <blockquote style="border-left: 4px solid #6366f1; padding: 12px 16px; margin: 16px 0; background: #f8f9fa; border-radius: 4px;">
        ${escapeHtml(normalizedTopic)}
      </blockquote>
      ${options.message ? `<p style="color: #555;"><em>"${escapeHtml(options.message)}"</em></p>` : ""}
      <p>
        <a href="${escapeHtml(joinLink)}" style="display: inline-block; padding: 12px 24px; background: #6366f1; color: #fff; text-decoration: none; border-radius: 6px; font-weight: 600;">
          Join Session
        </a>
      </p>
      <p style="color: #888; font-size: 14px; margin-top: 24px;">
        Common Ground is an AI-mediated platform for productive discourse. 
        If you don't have an account, you'll be prompted to create one.
      </p>
    </div>
  `;

  const result = await sendEmail({ to: options.recipientEmail, subject, text, html });
  return result.ok;
}

/* ------------------------------------------------------------------ */
/*  Analysis complete notification                                     */
/* ------------------------------------------------------------------ */

export async function sendAnalysisCompleteNotificationDetailed(options: {
  recipientEmail: string;
  sessionTopic: string;
  sessionId: string;
}): Promise<EmailSendResult> {
  const appUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const viewLink = `${appUrl}/session/${encodeURIComponent(options.sessionId)}`;
  const normalizedTopic = sanitizeSubjectText(options.sessionTopic);

  const subject = `Analysis complete: ${normalizedTopic}`;

  const text = [
    `Hi,`,
    ``,
    `The AI analysis for "${normalizedTopic}" is now complete.`,
    `View the Common Ground Map: ${viewLink}`,
  ].join("\n");

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #1a1a2e;">Analysis Complete</h2>
      <p>The AI analysis for <strong>${escapeHtml(normalizedTopic)}</strong> is ready.</p>
      <p>
        <a href="${escapeHtml(viewLink)}" style="display: inline-block; padding: 12px 24px; background: #6366f1; color: #fff; text-decoration: none; border-radius: 6px; font-weight: 600;">
          View Common Ground Map
        </a>
      </p>
    </div>
  `;

  return sendEmail({ to: options.recipientEmail, subject, text, html });
}

export async function sendAnalysisCompleteNotification(options: {
  recipientEmail: string;
  sessionTopic: string;
  sessionId: string;
}): Promise<boolean> {
  const result = await sendAnalysisCompleteNotificationDetailed(options);
  return result.ok;
}

/* ------------------------------------------------------------------ */
/*  Email verification (CG-FR01)                                       */
/* ------------------------------------------------------------------ */

export async function sendEmailVerification(options: {
  recipientEmail: string;
  displayName: string;
  verifyUrl: string;
}): Promise<boolean> {
  const subject = "Verify your email for Common Ground";
  const text = [
    `Hi ${options.displayName},`,
    ``,
    `Please verify your email to activate your account.`,
    `Verification link: ${options.verifyUrl}`,
    ``,
    `If you did not create this account, you can ignore this email.`,
  ].join("\n");

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #1a1a2e;">Verify Your Email</h2>
      <p>Hi <strong>${escapeHtml(options.displayName)}</strong>, please verify your email to activate your Common Ground account.</p>
      <p>
        <a href="${escapeHtml(options.verifyUrl)}" style="display: inline-block; padding: 12px 24px; background: #334155; color: #fff; text-decoration: none; border-radius: 6px; font-weight: 600;">
          Verify Email
        </a>
      </p>
      <p style="color: #666; font-size: 14px;">If you did not create this account, you can ignore this email.</p>
    </div>
  `;

  const result = await sendEmail({ to: options.recipientEmail, subject, text, html });
  return result.ok;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
