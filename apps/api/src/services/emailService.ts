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

const RESEND_API_URL = "https://api.resend.com/emails";
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? "Common Ground <onboarding@resend.dev>";

async function sendEmail(payload: EmailPayload): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("[Email] RESEND_API_KEY not set — email not sent to", payload.to);
    return false;
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

      return true;
    },
    { budgetMs: 20_000, label: "resend-email" }
  ).catch((err) => {
    console.error("[Email] Send failed:", err instanceof Error ? err.message : err);
    return false;
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

  const subject = `You're invited to a Common Ground session: ${options.sessionTopic}`;

  const text = [
    `Hi,`,
    ``,
    `${options.inviterName} has invited you to a Common Ground session.`,
    ``,
    `Topic: ${options.sessionTopic}`,
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
        ${escapeHtml(options.sessionTopic)}
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

  return sendEmail({ to: options.recipientEmail, subject, text, html });
}

/* ------------------------------------------------------------------ */
/*  Analysis complete notification                                     */
/* ------------------------------------------------------------------ */

export async function sendAnalysisCompleteNotification(options: {
  recipientEmail: string;
  sessionTopic: string;
  sessionId: string;
}): Promise<boolean> {
  const appUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const viewLink = `${appUrl}/session/${encodeURIComponent(options.sessionId)}`;

  const subject = `Analysis complete: ${options.sessionTopic}`;

  const text = [
    `Hi,`,
    ``,
    `The AI analysis for "${options.sessionTopic}" is now complete.`,
    `View the Common Ground Map: ${viewLink}`,
  ].join("\n");

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #1a1a2e;">Analysis Complete</h2>
      <p>The AI analysis for <strong>${escapeHtml(options.sessionTopic)}</strong> is ready.</p>
      <p>
        <a href="${escapeHtml(viewLink)}" style="display: inline-block; padding: 12px 24px; background: #6366f1; color: #fff; text-decoration: none; border-radius: 6px; font-weight: 600;">
          View Common Ground Map
        </a>
      </p>
    </div>
  `;

  return sendEmail({ to: options.recipientEmail, subject, text, html });
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
