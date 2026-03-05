"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPatch } from "../../lib-api";

type ProfileData = {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  notificationPrefs: { emailInvites?: boolean; emailAnalysisComplete?: boolean } | null;
  tier: string;
  role: string;
  createdAt: string;
};

export default function ProfilePage() {
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [emailInvites, setEmailInvites] = useState(true);
  const [emailAnalysis, setEmailAnalysis] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiGet<{ success: boolean; data: { user: ProfileData } | null }>("/profile");
      if (res.data?.user) {
        const u = res.data.user;
        setProfile(u);
        setDisplayName(u.displayName);
        setAvatarUrl(u.avatarUrl ?? "");
        setEmailInvites(u.notificationPrefs?.emailInvites ?? true);
        setEmailAnalysis(u.notificationPrefs?.emailAnalysisComplete ?? true);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load profile");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await apiPatch("/profile", {
        displayName,
        avatarUrl: avatarUrl || undefined,
        notificationPreferences: {
          emailInvites,
          emailAnalysisComplete: emailAnalysis,
        },
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  if (!profile) return <p>Loading profile…</p>;

  return (
    <section className="card grid" style={{ maxWidth: "32rem", margin: "0 auto" }}>
      <h1>Profile Settings</h1>

      <form onSubmit={handleSave} className="grid">
        <label htmlFor="prof-email">Email</label>
        <input id="prof-email" type="email" value={profile.email} disabled />

        <label htmlFor="prof-name">Display Name</label>
        <input
          id="prof-name"
          type="text"
          required
          minLength={1}
          maxLength={100}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />

        <label htmlFor="prof-avatar">Avatar URL</label>
        <input
          id="prof-avatar"
          type="url"
          maxLength={500}
          placeholder="https://example.com/avatar.png"
          value={avatarUrl}
          onChange={(e) => setAvatarUrl(e.target.value)}
        />

        <fieldset style={{ border: "1px solid var(--border, #e5e7eb)", padding: "0.75rem", borderRadius: "0.5rem" }}>
          <legend>Notification Preferences</legend>
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <input
              type="checkbox"
              checked={emailInvites}
              onChange={(e) => setEmailInvites(e.target.checked)}
            />
            Email me when invited to a session
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.25rem" }}>
            <input
              type="checkbox"
              checked={emailAnalysis}
              onChange={(e) => setEmailAnalysis(e.target.checked)}
            />
            Email me when analysis completes
          </label>
        </fieldset>

        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <span>Tier: <strong>{profile.tier}</strong></span>
          <span>Role: <strong>{profile.role}</strong></span>
        </div>

        {error && <p style={{ color: "#b91c1c" }}>{error}</p>}
        {saved && <p style={{ color: "#16a34a" }}>Profile saved.</p>}

        <button type="submit" disabled={busy}>
          {busy ? "Saving..." : "Save Changes"}
        </button>
      </form>
    </section>
  );
}
