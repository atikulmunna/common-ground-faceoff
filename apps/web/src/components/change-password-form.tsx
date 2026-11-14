"use client";

import { useId, useState } from "react";

import { apiPost } from "../lib-api";

/** Change your own password. Used on the profile page, and required after a temporary password. */
export function ChangePasswordForm({ onChanged }: { onChanged?: () => void }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);
  const id = useId();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setChanged(false);
    if (newPassword !== confirm) {
      setError("The new passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      await apiPost("/profile/password", { currentPassword, newPassword });
      setChanged(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirm("");
      onChanged?.();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Your password was not changed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form-stack" onSubmit={submit} aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`}>Password</h2>
      <div className="field">
        <label htmlFor={`${id}-current`}>Current password</label>
        <input id={`${id}-current`} type="password" required autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
      </div>
      <div className="field">
        <label htmlFor={`${id}-new`}>New password</label>
        <input id={`${id}-new`} type="password" required minLength={10} autoComplete="new-password" aria-describedby={`${id}-rules`} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
        <p id={`${id}-rules`} className="field__help">At least 10 characters, with an uppercase letter, a digit and a symbol.</p>
      </div>
      <div className="field">
        <label htmlFor={`${id}-confirm`}>New password again</label>
        <input id={`${id}-confirm`} type="password" required autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} />
      </div>
      {error && <p className="field-error" role="alert">{error}</p>}
      {changed && <p className="notice notice--ok" role="status">Password changed.</p>}
      <div className="form-actions">
        <button type="submit" disabled={busy}>{busy ? "Saving" : "Change password"}</button>
      </div>
    </form>
  );
}
