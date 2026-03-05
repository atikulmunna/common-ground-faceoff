import Link from "next/link";
import { apiGet } from "../lib-api";

type SessionSummary = {
  id: string;
  topic: string;
  status: string;
  createdAt: string;
};

type SessionListResponse = {
  success: boolean;
  data: { sessions?: SessionSummary[] } | null;
};

async function getSessions(): Promise<SessionSummary[]> {
  try {
    const response = await apiGet<SessionListResponse>("/sessions/demo-list");
    return response.data?.sessions ?? [];
  } catch {
    return [];
  }
}

export default async function HomePage() {
  const sessions = await getSessions();

  return (
    <section className="grid">
      <article className="card">
        <h1>Session Dashboard</h1>
        <p>Core flow MVP: create session, submit positions, trigger analysis, view map.</p>
      </article>

      <article className="card">
        <h2>Sessions</h2>
        {sessions.length === 0 ? (
          <p>No sessions found yet. Create one to start.</p>
        ) : (
          <ul>
            {sessions.map((session) => (
              <li key={session.id} style={{ marginBottom: "0.5rem" }}>
                <Link href={`/session/${session.id}`}>{session.topic}</Link> - {session.status}
              </li>
            ))}
          </ul>
        )}
        <Link href="/create">Create New Session</Link>
      </article>
    </section>
  );
}
