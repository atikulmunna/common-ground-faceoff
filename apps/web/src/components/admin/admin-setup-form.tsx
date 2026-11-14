"use client";

import { useId, useState } from "react";
import { signOut } from "next-auth/react";

import { apiPost } from "../../lib-api";

/**
 * Makes the first organization admin. While no admin exists, the API writes a one-time code to the
 * server log when it starts; whoever can read that log enters it here with the details for their
 * administrator account. Works signed out, so it doubles as recovery for a forgotten password.
 */
export function AdminSetupForm() {
  const [code, setCode] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [organizationName, setOrganizationName] = useState("Common Ground");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneEmail, setDoneEmail] = useState<string | null>(null);
  const id = useId();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("The passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      await apiPost("/admin-setup/claim", { code, displayName, email, password, organizationName });
      setDoneEmail(email.trim().toLowerCase());
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Setup did not work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (doneEmail) {
    return (
      <div className="notice notice--ok" role="status">
        <p><strong>You are the administrator now.</strong> Sign in as {doneEmail} with the password you chose.</p>
        <button type="button" onClick={() => signOut({ callbackUrl: "/sign-in" })}>Go to sign in</button>
      </div>
    );
  }

  return (
    <section className="panel" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`}>Set up administration</h2>
      <p className="section-help">
        While nobody administers this site, the server writes a one-time setup code to its log when it starts. Enter it with the details for your administrator account. If an account with this email already exists, it becomes the administrator and gets this password.
      </p>
      <form className="form-stack" onSubmit={submit}>
        <div className="field">
          <label htmlFor={`${id}-code`}>Setup code</label>
          <input id={`${id}-code`} type="text" required autoComplete="off" spellCheck={false} value={code} onChange={(event) => setCode(event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={`${id}-name`}>Your name</label>
          <input id={`${id}-name`} type="text" required maxLength={100} autoComplete="name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={`${id}-email`}>Email</label>
          <input id={`${id}-email`} type="email" required autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={`${id}-password`}>Password</label>
          <input id={`${id}-password`} type="password" required minLength={10} autoComplete="new-password" aria-describedby={`${id}-rules`} value={password} onChange={(event) => setPassword(event.target.value)} />
          <p id={`${id}-rules`} className="field__help">At least 10 characters, with an uppercase letter, a digit and a symbol.</p>
        </div>
        <div className="field">
          <label htmlFor={`${id}-confirm`}>Password again</label>
          <input id={`${id}-confirm`} type="password" required autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={`${id}-org`}>Organization name</label>
          <input id={`${id}-org`} type="text" required maxLength={200} value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} />
        </div>
        {error && <p className="field-error" role="alert">{error}</p>}
        <div className="form-actions">
          <button type="submit" disabled={busy || code.trim().length < 8}>{busy ? "Checking" : "Become administrator"}</button>
        </div>
      </form>
    </section>
  );
}
