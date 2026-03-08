"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { apiGet, apiPatch, apiPost } from "../../lib-api";

type ProfileData = {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  notificationPrefs: { emailInvites?: boolean; emailAnalysisComplete?: boolean } | null;
  tier: string;
  role: string;
  mfaEnabled: boolean;
  smsMfaEnabled: boolean;
  smsPhone: string | null;
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
  const [mfaQr, setMfaQr] = useState<string | null>(null);
  const [mfaToken, setMfaToken] = useState("");
  const [mfaMsg, setMfaMsg] = useState<string | null>(null);
  const [smsPhone, setSmsPhone] = useState("");
  const [smsCode, setSmsCode] = useState("");
  const [smsMsg, setSmsMsg] = useState<string | null>(null);
  const [smsSetupSent, setSmsSetupSent] = useState(false);
  const [smsDisableSent, setSmsDisableSent] = useState(false);

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
        setSmsPhone(u.smsPhone ?? "");
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

      {/* MFA Settings (CG-FR06) */}
      <div style={{ marginTop: "1.5rem", borderTop: "1px solid var(--border, #e5e7eb)", paddingTop: "1rem" }}>
        <h2>Two-Factor Authentication (TOTP)</h2>
        {profile.mfaEnabled ? (
          <>
            <p style={{ color: "#16a34a" }}>MFA is <strong>enabled</strong>.</p>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <input
                type="text"
                maxLength={6}
                placeholder="Enter TOTP code to disable"
                value={mfaToken}
                onChange={(e) => setMfaToken(e.target.value.replace(/\D/g, "").slice(0, 6))}
                style={{ width: "10rem" }}
              />
              <button
                className="secondary"
                disabled={mfaToken.length !== 6}
                onClick={async () => {
                  setMfaMsg(null);
                  try {
                    await apiPost("/mfa/disable", { token: mfaToken });
                    setMfaMsg("MFA disabled.");
                    setMfaToken("");
                    await load();
                  } catch { setMfaMsg("Invalid code."); }
                }}
              >
                Disable MFA
              </button>
            </div>
          </>
        ) : mfaQr ? (
          <>
            <p>Scan this QR code with your authenticator app:</p>
            <Image
              src={mfaQr}
              alt="MFA QR Code"
              width={200}
              height={200}
              unoptimized
            />
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginTop: "0.5rem" }}>
              <input
                type="text"
                maxLength={6}
                placeholder="Enter 6-digit code"
                value={mfaToken}
                onChange={(e) => setMfaToken(e.target.value.replace(/\D/g, "").slice(0, 6))}
                style={{ width: "10rem" }}
              />
              <button
                disabled={mfaToken.length !== 6}
                onClick={async () => {
                  setMfaMsg(null);
                  try {
                    await apiPost("/mfa/verify-setup", { token: mfaToken });
                    setMfaMsg("MFA enabled successfully!");
                    setMfaQr(null);
                    setMfaToken("");
                    await load();
                  } catch { setMfaMsg("Invalid code. Try again."); }
                }}
              >
                Verify &amp; Enable
              </button>
            </div>
          </>
        ) : (
          <button
            onClick={async () => {
              setMfaMsg(null);
              try {
                const res = await apiPost<{ success: boolean; data: { qrCode: string } | null }>("/mfa/setup", {});
                if (res.data?.qrCode) setMfaQr(res.data.qrCode);
              } catch { setMfaMsg("Failed to set up MFA."); }
            }}
          >
            Enable MFA
          </button>
        )}
        {mfaMsg && <p style={{ marginTop: "0.5rem" }}>{mfaMsg}</p>}
      </div>

      {/* SMS MFA Settings (CG-FR06) */}
      <div style={{ marginTop: "1.5rem", borderTop: "1px solid var(--border, #e5e7eb)", paddingTop: "1rem" }}>
        <h2>Two-Factor Authentication (SMS)</h2>
        {profile.smsMfaEnabled ? (
          <>
            <p style={{ color: "#16a34a" }}>
              SMS MFA is <strong>enabled</strong>{profile.smsPhone ? ` (${profile.smsPhone})` : ""}.
            </p>
            {!smsDisableSent ? (
              <button
                className="secondary"
                onClick={async () => {
                  setSmsMsg(null);
                  try {
                    await apiPost("/mfa/sms/send-disable-code", {});
                    setSmsDisableSent(true);
                    setSmsMsg("Disable code sent to your phone.");
                  } catch {
                    setSmsMsg("Failed to send disable code.");
                  }
                }}
              >
                Send Disable Code
              </button>
            ) : (
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <input
                  type="text"
                  maxLength={6}
                  placeholder="Enter SMS code"
                  value={smsCode}
                  onChange={(e) => setSmsCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  style={{ width: "10rem" }}
                />
                <button
                  className="secondary"
                  disabled={smsCode.length !== 6}
                  onClick={async () => {
                    setSmsMsg(null);
                    try {
                      await apiPost("/mfa/sms/disable", { code: smsCode });
                      setSmsMsg("SMS MFA disabled.");
                      setSmsCode("");
                      setSmsDisableSent(false);
                      await load();
                    } catch {
                      setSmsMsg("Invalid SMS code.");
                    }
                  }}
                >
                  Disable SMS MFA
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            <p>Enable SMS MFA with your mobile number.</p>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
              <input
                type="tel"
                placeholder="+15551234567"
                value={smsPhone}
                onChange={(e) => setSmsPhone(e.target.value)}
                style={{ minWidth: "14rem" }}
              />
              <button
                disabled={smsPhone.trim().length < 8}
                onClick={async () => {
                  setSmsMsg(null);
                  try {
                    await apiPost("/mfa/sms/setup", { phone: smsPhone });
                    setSmsSetupSent(true);
                    setSmsMsg("Verification code sent by SMS.");
                  } catch {
                    setSmsMsg("Failed to send verification SMS.");
                  }
                }}
              >
                Send Setup Code
              </button>
            </div>
            {smsSetupSent && (
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginTop: "0.5rem" }}>
                <input
                  type="text"
                  maxLength={6}
                  placeholder="Enter SMS code"
                  value={smsCode}
                  onChange={(e) => setSmsCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  style={{ width: "10rem" }}
                />
                <button
                  disabled={smsCode.length !== 6}
                  onClick={async () => {
                    setSmsMsg(null);
                    try {
                      await apiPost("/mfa/sms/verify-setup", { code: smsCode });
                      setSmsMsg("SMS MFA enabled.");
                      setSmsCode("");
                      setSmsSetupSent(false);
                      await load();
                    } catch {
                      setSmsMsg("Invalid SMS code.");
                    }
                  }}
                >
                  Verify &amp; Enable
                </button>
              </div>
            )}
          </>
        )}
        {smsMsg && <p style={{ marginTop: "0.5rem" }}>{smsMsg}</p>}
      </div>
    </section>
  );
}
