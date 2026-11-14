"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { apiGet, apiPatch, apiPost } from "../../lib-api";
import { ChangePasswordForm } from "../../components/change-password-form";

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
  passwordChangeRequired?: boolean;
  createdAt: string;
};

const SMS_MFA_ENABLED = process.env.NEXT_PUBLIC_ENABLE_SMS_MFA === "true";

const PLAN_NAMES: Record<string, string> = { free: "Free", pro: "Pro", enterprise: "Enterprise" };
const ROLE_NAMES: Record<string, string> = {
  individual_user: "Member",
  institutional_admin: "Organization administrator",
  moderator: "Moderator",
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
      setError(e instanceof Error ? e.message : "Your profile could not be loaded. Reload the page to try again.");
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
      setError(err instanceof Error ? err.message : "Your changes were not saved. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!profile) {
    return error
      ? <p className="notice notice--error" role="alert">{error}</p>
      : <p className="quiet-status" role="status">Loading your profile</p>;
  }

  return (
    <section className="narrow-page settings">
      <h1>Profile and settings</h1>
      {profile.passwordChangeRequired && (
        <p className="notice notice--warn" role="status">
          You signed in with a temporary password. Choose your own under Password below.
        </p>
      )}

      <form onSubmit={handleSave} className="form-stack">
        <div className="field">
          <label htmlFor="prof-email">Email</label>
          <input id="prof-email" type="email" value={profile.email} disabled />
        </div>

        <div className="field">
          <label htmlFor="prof-name">Display name</label>
          <input
            id="prof-name"
            type="text"
            required
            minLength={1}
            maxLength={100}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="prof-avatar">Profile picture URL</label>
          <input
            id="prof-avatar"
            type="url"
            maxLength={500}
            placeholder="https://example.com/avatar.png"
            value={avatarUrl}
            onChange={(e) => setAvatarUrl(e.target.value)}
          />
        </div>

        <fieldset className="choice-group">
          <legend>Email notifications</legend>
          <label className="choice">
            <input type="checkbox" checked={emailInvites} onChange={(e) => setEmailInvites(e.target.checked)} />
            <span>Email me when someone invites me to a conversation</span>
          </label>
          <label className="choice">
            <input type="checkbox" checked={emailAnalysis} onChange={(e) => setEmailAnalysis(e.target.checked)} />
            <span>Email me when results are ready</span>
          </label>
        </fieldset>

        <p className="field__help">
          Plan: <strong>{PLAN_NAMES[profile.tier] ?? profile.tier}</strong>. Account type: <strong>{ROLE_NAMES[profile.role] ?? profile.role}</strong>.
        </p>

        {error && <p className="notice notice--error" role="alert">{error}</p>}
        {saved && <p className="notice notice--ok" role="status">Profile saved.</p>}

        <div className="form-actions">
          <button type="submit" disabled={busy}>{busy ? "Saving" : "Save changes"}</button>
        </div>
      </form>

      <section className="settings__section">
        <ChangePasswordForm onChanged={() => void load()} />
      </section>

      {/* MFA Settings (CG-FR06) */}
      <section className="settings__section" aria-labelledby="totp-heading">
        <h2 id="totp-heading">Two-step sign-in with an authenticator app</h2>
        {profile.mfaEnabled ? (
          <>
            <p className="notice notice--ok">Two-step sign-in is on.</p>
            <div className="inline-row">
              <label htmlFor="totp-disable" className="visually-hidden">Code from your authenticator app</label>
              <input
                id="totp-disable"
                className="code-input"
                type="text"
                inputMode="numeric"
                maxLength={6}
                placeholder="6 digit code"
                value={mfaToken}
                onChange={(e) => setMfaToken(e.target.value.replace(/\D/g, "").slice(0, 6))}
              />
              <button
                type="button"
                className="secondary"
                disabled={mfaToken.length !== 6}
                onClick={async () => {
                  setMfaMsg(null);
                  try {
                    await apiPost("/mfa/disable", { token: mfaToken });
                    setMfaMsg("Two-step sign-in is off.");
                    setMfaToken("");
                    await load();
                  } catch { setMfaMsg("That code did not work. Check your app and try again."); }
                }}
              >
                Turn off
              </button>
            </div>
          </>
        ) : mfaQr ? (
          <>
            <p>Scan this code with your authenticator app, then enter the 6 digit code it shows.</p>
            <Image src={mfaQr} alt="QR code for your authenticator app" width={200} height={200} unoptimized />
            <div className="inline-row">
              <label htmlFor="totp-setup" className="visually-hidden">Code from your authenticator app</label>
              <input
                id="totp-setup"
                className="code-input"
                type="text"
                inputMode="numeric"
                maxLength={6}
                placeholder="6 digit code"
                value={mfaToken}
                onChange={(e) => setMfaToken(e.target.value.replace(/\D/g, "").slice(0, 6))}
              />
              <button
                type="button"
                disabled={mfaToken.length !== 6}
                onClick={async () => {
                  setMfaMsg(null);
                  try {
                    await apiPost("/mfa/verify-setup", { token: mfaToken });
                    setMfaMsg("Two-step sign-in is on.");
                    setMfaQr(null);
                    setMfaToken("");
                    await load();
                  } catch { setMfaMsg("That code did not work. Check your app and try again."); }
                }}
              >
                Turn on
              </button>
            </div>
          </>
        ) : (
          <button
            type="button"
            onClick={async () => {
              setMfaMsg(null);
              try {
                const res = await apiPost<{ success: boolean; data: { qrCode: string } | null }>("/mfa/setup", {});
                if (res.data?.qrCode) setMfaQr(res.data.qrCode);
              } catch { setMfaMsg("Setup could not start. Try again."); }
            }}
          >
            Set up two-step sign-in
          </button>
        )}
        {mfaMsg && <p className="field__help" role="status">{mfaMsg}</p>}
      </section>

      {/* SMS MFA Settings (CG-FR06) */}
      {SMS_MFA_ENABLED && <section className="settings__section" aria-labelledby="sms-heading">
        <h2 id="sms-heading">Two-step sign-in by text message</h2>
        {profile.smsMfaEnabled ? (
          <>
            <p className="notice notice--ok">
              Text message codes are on{profile.smsPhone ? ` for ${profile.smsPhone}` : ""}.
            </p>
            {!smsDisableSent ? (
              <button
                type="button"
                className="secondary"
                onClick={async () => {
                  setSmsMsg(null);
                  try {
                    await apiPost("/mfa/sms/send-disable-code", {});
                    setSmsDisableSent(true);
                    setSmsMsg("We sent a code to your phone.");
                  } catch {
                    setSmsMsg("The code could not be sent. Try again.");
                  }
                }}
              >
                Send a code to turn this off
              </button>
            ) : (
              <div className="inline-row">
                <label htmlFor="sms-disable" className="visually-hidden">Code from the text message</label>
                <input
                  id="sms-disable"
                  className="code-input"
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="6 digit code"
                  value={smsCode}
                  onChange={(e) => setSmsCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                />
                <button
                  type="button"
                  className="secondary"
                  disabled={smsCode.length !== 6}
                  onClick={async () => {
                    setSmsMsg(null);
                    try {
                      await apiPost("/mfa/sms/disable", { code: smsCode });
                      setSmsMsg("Text message codes are off.");
                      setSmsCode("");
                      setSmsDisableSent(false);
                      await load();
                    } catch {
                      setSmsMsg("That code did not work. Try again.");
                    }
                  }}
                >
                  Turn off
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            <p>Get a sign-in code by text message.</p>
            <div className="inline-row">
              <label htmlFor="sms-phone" className="visually-hidden">Mobile number</label>
              <input
                id="sms-phone"
                type="tel"
                autoComplete="tel"
                placeholder="+15551234567"
                value={smsPhone}
                onChange={(e) => setSmsPhone(e.target.value)}
              />
              <button
                type="button"
                disabled={smsPhone.trim().length < 8}
                onClick={async () => {
                  setSmsMsg(null);
                  try {
                    await apiPost("/mfa/sms/setup", { phone: smsPhone });
                    setSmsSetupSent(true);
                    setSmsMsg("We sent a code by text message.");
                  } catch {
                    setSmsMsg("The text message could not be sent. Check the number and try again.");
                  }
                }}
              >
                Send a code
              </button>
            </div>
            {smsSetupSent && (
              <div className="inline-row">
                <label htmlFor="sms-setup" className="visually-hidden">Code from the text message</label>
                <input
                  id="sms-setup"
                  className="code-input"
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="6 digit code"
                  value={smsCode}
                  onChange={(e) => setSmsCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                />
                <button
                  type="button"
                  disabled={smsCode.length !== 6}
                  onClick={async () => {
                    setSmsMsg(null);
                    try {
                      await apiPost("/mfa/sms/verify-setup", { code: smsCode });
                      setSmsMsg("Text message codes are on.");
                      setSmsCode("");
                      setSmsSetupSent(false);
                      await load();
                    } catch {
                      setSmsMsg("That code did not work. Try again.");
                    }
                  }}
                >
                  Turn on
                </button>
              </div>
            )}
          </>
        )}
        {smsMsg && <p className="field__help" role="status">{smsMsg}</p>}
      </section>}
    </section>
  );
}
