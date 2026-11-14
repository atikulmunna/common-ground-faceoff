"use client";

import { useId, useState } from "react";
import { signOut } from "next-auth/react";

import { apiPost } from "../../lib-api";

/**
 * Makes the first organization admin. While no admin exists, the API writes a one-time code to the
 * server log when it starts; whoever can read that log can enter it here.
 */
export function AdminSetupForm() {
  const [code, setCode] = useState("");
  const [organizationName, setOrganizationName] = useState("Common Ground");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const id = useId();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiPost("/admin-setup/claim", { code, organizationName });
      setDone(true);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Setup did not work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="notice notice--ok" role="status">
        <p><strong>You are the administrator now.</strong> Sign in again to open Administration.</p>
        <button type="button" onClick={() => signOut({ callbackUrl: "/sign-in" })}>Sign out and sign in again</button>
      </div>
    );
  }

  return (
    <section className="panel" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`}>Set up administration</h2>
      <p className="section-help">
        If nobody administers this site yet, the server wrote a one-time setup code to its log when it started. Enter it to become the administrator.
      </p>
      <form className="form-stack" onSubmit={submit}>
        <div className="field">
          <label htmlFor={`${id}-code`}>Setup code</label>
          <input id={`${id}-code`} type="text" required autoComplete="off" spellCheck={false} value={code} onChange={(event) => setCode(event.target.value)} />
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
