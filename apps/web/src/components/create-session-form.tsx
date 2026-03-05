"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { apiPost } from "../lib-api";

type CreateResponse = {
  success: boolean;
  data: { session: { id: string } };
};

export function CreateSessionForm() {
  const router = useRouter();
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

  return (
    <form onSubmit={handleSubmit} className="card grid">
      <h1>Create Session</h1>
      <label htmlFor="topic">Topic statement</label>
      <textarea
        id="topic"
        minLength={10}
        maxLength={500}
        value={topic}
        onChange={(event) => setTopic(event.target.value)}
        placeholder="Enter a debate topic"
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
        Enable anonymous mode
      </label>

      {error ? <p style={{ color: "#b91c1c" }}>{error}</p> : null}
      <button type="submit" disabled={busy}>{busy ? "Creating..." : "Create"}</button>
    </form>
  );
}
