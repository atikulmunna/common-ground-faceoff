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
  const [deadline, setDeadline] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const response = await apiPost<CreateResponse>("/sessions", {
        topic,
        anonymousMode,
        // The field holds local time; the API stores an exact moment.
        ...(deadline ? { deadline: new Date(deadline).toISOString() } : {}),
      });
      router.push(`/session/${response.data.session.id}`);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "The conversation could not be started. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (status === "loading") {
    return <p className="quiet-status" role="status">Checking that you are signed in</p>;
  }

  if (status === "unauthenticated") {
    return (
      <section className="narrow-page">
        <h1>Start a conversation</h1>
        <p>Sign in to start a conversation and invite people into it.</p>
        <Link href="/sign-in" className="button-link">Sign in</Link>
      </section>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="narrow-page form-stack create-form">
      <div>
        <h1>What do you want to understand better?</h1>
        <p className="lede">Ask a question everyone can answer in their own words.</p>
      </div>

      <div className="field">
        <label htmlFor="topic">Conversation topic or question</label>
        <textarea
          id="topic"
          minLength={10}
          maxLength={500}
          value={topic}
          onChange={(event) => setTopic(event.target.value)}
          placeholder="For example: how many office days should our team keep?"
          rows={4}
          required
        />
        <p className="field__help">10 to 500 characters.</p>
      </div>

      <div className="field">
        <label htmlFor="deadline">Deadline for perspectives (optional)</label>
        <input
          id="deadline"
          type="datetime-local"
          value={deadline}
          onChange={(event) => setDeadline(event.target.value)}
          aria-describedby="deadline-help"
        />
        <p id="deadline-help" className="field__help">After this time nobody can add or change a perspective.</p>
      </div>

      <div className="field field--choice">
        <label className="choice">
          <input
            type="checkbox"
            checked={anonymousMode}
            onChange={(event) => setAnonymousMode(event.target.checked)}
            aria-describedby="anonymous-help"
          />
          <span>Keep participants anonymous</span>
        </label>
        <p id="anonymous-help" className="field__help" aria-live="polite">
          {anonymousMode
            ? "Nobody, you included, will see who wrote which perspective, before or after the results. People appear as Participant A, B and so on. You will still see the email addresses you invite."
            : "Everyone sees each other's names. Perspectives stay private until the results are ready, then everyone can read them."}
        </p>
      </div>

      {error ? <p className="notice notice--error" role="alert">{error}</p> : null}
      <div className="form-actions">
        <button type="submit" disabled={busy}>{busy ? "Starting conversation" : "Start conversation"}</button>
        <span className="field__help">You can invite people on the next page.</span>
      </div>
    </form>
  );
}
