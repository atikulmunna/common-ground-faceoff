"use client";

import { Suspense, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { getPublicApiBaseUrl } from "../../lib/api-base";
import { parseMfaChallenge, type MfaChallenge } from "../../lib/mfa-challenge";

const REGISTRATION_ENABLED = process.env.NEXT_PUBLIC_ENABLE_REGISTRATION === "true";

export default function SignInPage() {
  return (
    <Suspense fallback={<p className="quiet-status" role="status">Loading</p>}>
      <SignInPageContent />
    </Suspense>
  );
}

function extractRegistrationError(json: unknown): string {
  const fallback = "Registration failed";
  if (!json || typeof json !== "object") return fallback;

  const payload = json as {
    error?: {
      message?: string;
      details?: {
        fieldErrors?: Record<string, string[] | undefined>;
      };
    };
  };

  const fieldErrors = payload.error?.details?.fieldErrors;
  if (fieldErrors) {
    const passwordError = fieldErrors.password?.[0];
    if (passwordError) return passwordError;
    const emailError = fieldErrors.email?.[0];
    if (emailError) return emailError;
    const displayNameError = fieldErrors.displayName?.[0];
    if (displayNameError) return displayNameError;
  }

  return payload.error?.message ?? fallback;
}

function SignInPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [info, setInfo] = useState<string | null>(() => {
    const verified = searchParams.get("verified");
    if (verified === "1") return "Email verified. You can now sign in.";
    if (verified === "0") return searchParams.get("reason") ?? "Email verification failed.";
    return null;
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mfa, setMfa] = useState<MfaChallenge | null>(null);
  const [code, setCode] = useState("");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);

    if (mode === "register") {
      const res = await fetch(`${getPublicApiBaseUrl()}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, displayName })
      });
      const json = await res.json();
      setBusy(false);

      if (!res.ok || !json.success) {
        setError(extractRegistrationError(json));
        return;
      }

      setInfo(json.data?.message ?? "Registration successful. Please verify your email before signing in.");
      setMode("login");
      setPassword("");
      return;
    }

    const result = await signIn("credentials", {
      redirect: false,
      email,
      password,
      action: "login"
    });

    setBusy(false);

    const challenge = parseMfaChallenge(result?.error);
    if (challenge) {
      setMfa(challenge);
      setPassword("");
    } else if (result?.error) {
      setError(result.error);
    } else {
      router.push("/");
      router.refresh();
    }
  }

  async function handleVerify(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mfa) return;
    setBusy(true);
    setError(null);

    const result = await signIn("credentials", {
      redirect: false,
      mfaTicket: mfa.mfaTicket,
      mfaCode: code,
      mfaType: mfa.mfaType
    });

    setBusy(false);

    if (result?.error) {
      setError(result.error);
      setCode("");
    } else {
      router.push("/");
      router.refresh();
    }
  }

  function leaveVerification() {
    setMfa(null);
    setCode("");
    setError(null);
  }

  if (mfa) {
    return (
      <section className="auth-panel">
        <h1>Enter your verification code</h1>
        <p className="lede">
          {mfa.mfaType === "sms"
            ? "We sent a 6 digit code to your phone."
            : "Open your authenticator app and enter the 6 digit code for Common Ground."}
        </p>

        <form onSubmit={handleVerify} className="form-stack">
          <div className="field">
            <label htmlFor="mfa-code">Verification code</label>
            <input
              id="mfa-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            />
          </div>

          {error && <p role="alert" className="notice notice--error">{error}</p>}

          <button type="submit" disabled={busy || code.length !== 6}>
            {busy ? "Checking the code" : "Verify"}
          </button>
        </form>

        <button type="button" className="link-button" onClick={leaveVerification}>
          Back to sign in
        </button>
      </section>
    );
  }

  const oauthEnabled =
    process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED === "true" || process.env.NEXT_PUBLIC_MICROSOFT_AUTH_ENABLED === "true";

  return (
    <section className="auth-panel">
      <h1>{mode === "login" ? "Sign in" : "Create an account"}</h1>

      <form onSubmit={handleSubmit} className="form-stack">
        {mode === "register" && (
          <div className="field">
            <label htmlFor="displayName">Your name</label>
            <input
              id="displayName"
              type="text"
              required
              minLength={1}
              maxLength={100}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              autoComplete="name"
            />
          </div>
        )}

        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
          />
        </div>

        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            required
            minLength={mode === "register" ? 10 : 1}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "register" ? "new-password" : "current-password"}
            aria-describedby={mode === "register" ? "password-help" : undefined}
          />
          {mode === "register" && (
            <p id="password-help" className="field__help">At least 10 characters, with an uppercase letter, a digit and a symbol.</p>
          )}
        </div>

        {error && <p role="alert" className="notice notice--error">{error}</p>}
        {info && <p role="status" className="notice notice--ok">{info}</p>}

        <button type="submit" disabled={busy}>
          {busy ? "Working on it" : mode === "login" ? "Sign in" : "Create account"}
        </button>
      </form>

      {REGISTRATION_ENABLED ? (
        <button
          className="link-button"
          onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(null); }}
          type="button"
        >
          {mode === "login" ? "New here? Create an account" : "Already have an account? Sign in"}
        </button>
      ) : (
        <p className="field__help">Common Ground is invite only for now. The project owner sends access details.</p>
      )}

      {oauthEnabled && (
        <div className="auth-panel__providers">
          <p className="divider-text"><span>or</span></p>
          {process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED === "true" && (
            <button className="secondary" onClick={() => signIn("google", { callbackUrl: "/" })} type="button">
              Continue with Google
            </button>
          )}
          {process.env.NEXT_PUBLIC_MICROSOFT_AUTH_ENABLED === "true" && (
            <button className="secondary" onClick={() => signIn("azure-ad", { callbackUrl: "/" })} type="button">
              Continue with Microsoft
            </button>
          )}
        </div>
      )}
    </section>
  );
}
