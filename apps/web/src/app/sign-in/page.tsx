"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";

export default function SignInPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const result = await signIn("credentials", {
      redirect: false,
      email,
      password,
      action: mode,
      displayName: mode === "register" ? displayName : undefined
    });

    setBusy(false);

    if (result?.error) {
      setError(result.error);
    } else {
      router.push("/");
      router.refresh();
    }
  }

  return (
    <section className="card grid" style={{ maxWidth: "28rem", margin: "0 auto" }}>
      <h1>{mode === "login" ? "Sign In" : "Create Account"}</h1>

      <form onSubmit={handleSubmit} className="grid">
        {mode === "register" && (
          <>
            <label htmlFor="displayName">Display Name</label>
            <input
              id="displayName"
              type="text"
              required
              minLength={1}
              maxLength={100}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your name"
            />
          </>
        )}

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

        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          required
          minLength={mode === "register" ? 10 : 1}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={mode === "register" ? "Min 10 chars, uppercase, digit, special" : "Your password"}
          autoComplete={mode === "register" ? "new-password" : "current-password"}
        />

        {error && <p style={{ color: "#b91c1c" }}>{error}</p>}

        <button type="submit" disabled={busy}>
          {busy ? "Working..." : mode === "login" ? "Sign In" : "Create Account"}
        </button>
      </form>

      <button
        className="secondary"
        onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(null); }}
        type="button"
      >
        {mode === "login" ? "Need an account? Register" : "Already have an account? Sign In"}
      </button>

      {process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED === "true" && (
        <>
          <div className="oauth-divider" style={{ textAlign: "center", margin: "0.5rem 0", color: "#888" }}>
            — or —
          </div>
          <button
            className="secondary"
            onClick={() => signIn("google", { callbackUrl: "/" })}
            type="button"
          >
            Continue with Google
          </button>
        </>
      )}
    </section>
  );
}
