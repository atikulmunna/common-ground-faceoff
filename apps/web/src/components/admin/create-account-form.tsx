"use client";

import { useId, useState } from "react";

import { apiPost } from "../../lib-api";

type Created = { account: { email: string; displayName: string }; temporaryPassword: string };

/**
 * Gives someone an account (or activates the one a conversation invitation made) and shows their
 * temporary password once, ready to send. They choose their own password after signing in.
 */
export function CreateAccountForm() {
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);
  const [copied, setCopied] = useState(false);
  const id = useId();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const response = await apiPost<{ data: Created }>("/admin/accounts", { email, displayName });
      setCreated(response.data);
      setDisplayName("");
      setEmail("");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "The account was not created. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const signInUrl = typeof window === "undefined" ? "/sign-in" : `${window.location.origin}/sign-in`;
  const details = created
    ? `Sign in to Common Ground at ${signInUrl}\nEmail: ${created.account.email}\nTemporary password: ${created.temporaryPassword}\nYou will be asked to choose your own password after signing in.`
    : "";

  async function copy() {
    try {
      await navigator.clipboard.writeText(details);
      setCopied(true);
    } catch {
      setError("Copying is blocked in this browser. Select the details and copy them.");
    }
  }

  return (
    <section className="panel" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`}>Give someone an account</h2>
      <p className="section-help">
        For people you want to bring in, including anyone you invited to a conversation. They get a temporary password and choose their own after signing in.
      </p>
      <form className="form-stack" onSubmit={submit}>
        <div className="field">
          <label htmlFor={`${id}-name`}>Name</label>
          <input id={`${id}-name`} type="text" required maxLength={100} value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={`${id}-email`}>Email</label>
          <input id={`${id}-email`} type="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
        </div>
        {error && <p className="field-error" role="alert">{error}</p>}
        <div className="form-actions">
          <button type="submit" disabled={busy || !displayName.trim() || !email.trim()}>{busy ? "Creating" : "Create account"}</button>
        </div>
      </form>

      {created && (
        <div className="notice notice--ok account-ready" role="status">
          <p><strong>{created.account.displayName} can sign in now.</strong> Send them these details privately. The password is shown only this once.</p>
          <pre className="account-ready__details">{details}</pre>
          <button type="button" className="secondary" onClick={copy}>{copied ? "Copied" : "Copy sign-in details"}</button>
        </div>
      )}
    </section>
  );
}
