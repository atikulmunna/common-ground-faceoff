"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useSession } from "next-auth/react";

import { apiPost } from "../lib-api";

type CreateResponse = {
  success: boolean;
  data: { session: { id: string } };
};

export function CreateSessionForm() {
  const router = useRouter();
  const { status } = useSession();
  const [topic, setTopic] = useState("");
  const [anonymousMode, setAnonymousMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const response = await apiPost<CreateResponse>("/sessions", {
        topic,
        anonymousMode
      });
      router.push(`/session/${response.data.session.id}`);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to create session");
    } finally {
      setBusy(false);
    }
  }

  if (status === "loading") {
    return (
      <section className="card grid">
        <h1>Start a conversation</h1>
        <p>Checking your session...</p>
      </section>
    );
  }

  if (status === "unauthenticated") {
    return (
      <section className="card grid">
        <h1>Start a conversation</h1>
        <p>Sign in to create a conversation and invite other perspectives.</p>
        <Link href="/sign-in">Go to sign in</Link>
      </section>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="card grid create-conversation">
      <div><span className="eyebrow">New conversation</span><h1>What would you like to understand better?</h1><p>Frame a question or disagreement clearly enough that every participant knows what they are responding to.</p></div>
      <label htmlFor="topic">Conversation topic or question</label>
      <textarea
        id="topic"
        minLength={10}
        maxLength={500}
        value={topic}
        onChange={(event) => setTopic(event.target.value)}
        placeholder="For example: How should our team balance remote flexibility with collaboration?"
        rows={5}
        required
      />

      <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <input
          type="checkbox"
          checked={anonymousMode}
          onChange={(event) => setAnonymousMode(event.target.checked)}
          style={{ width: "auto" }}
        />
        Let participants contribute anonymously
      </label>

      <p className="form-helper">You can invite participants after creating the conversation.</p>

      {error ? <p style={{ color: "#b91c1c" }}>{error}</p> : null}
      <button type="submit" disabled={busy}>{busy ? "Starting conversation…" : "Start conversation"}</button>
    </form>
  );
}
