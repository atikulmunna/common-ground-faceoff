"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useState } from "react";
import { apiGet } from "../lib-api";
import { OverprintHeading } from "../components/overprint-heading";
import { stageLabel } from "../lib/conversation-stage";

type SessionRow = {
  id: string;
  topic: string;
  status: string;
  createdAt: string;
  analyzedAt: string | null;
  participantCount: number;
};

type DashboardResponse = {
  success: boolean;
  data: { sessions: SessionRow[]; total: number; page: number; pageSize: number } | null;
};

const STAGE_FILTERS = [
  { value: "all", label: "All stages" },
  { value: "collecting_positions", label: "Gathering perspectives" },
  { value: "running", label: "Finding common ground" },
  { value: "completed", label: "Results ready" },
  { value: "failed", label: "Needs attention" },
  { value: "draft", label: "Not started" },
];

export default function HomePage() {
  const { data: authSession, status: authStatus } = useSession();

  if (authStatus === "loading") {
    return <p className="page-loading" role="status">Opening Common Ground</p>;
  }

  if (!authSession?.user) return <LandingPage />;
  return <Dashboard />;
}

function LandingPage() {
  return (
    <div className="landing">
      <section className="hero">
        <div className="hero__copy">
          <OverprintHeading className="hero__title">Find the ground you share.</OverprintHeading>
          <p className="hero__lede">
            Everyone writes what they think, in their own words. Common Ground restates each view fairly,
            then shows the points you share and the few you really differ on.
          </p>
          <div className="hero__actions">
            <Link href="/sign-in" className="button-link">Start a conversation</Link>
            <a href="#how-it-works" className="text-link">See how it works</a>
          </div>
        </div>

        <figure
          className="hero-sheets"
          aria-label="Two perspectives overlapping. Casey: office days help new people learn fast. Val: remote days protect time for deep work. Where they overlap: both want the team to do its best work."
        >
          <div className="hero-sheets__canvas" aria-hidden="true">
            <div className="hero-sheets__sheet hero-sheets__sheet--first" />
            <div className="hero-sheets__sheet hero-sheets__sheet--second" />
            <div className="hero-sheets__voice hero-sheets__voice--first">
              <span className="hero-sheets__name">Casey</span>
              <span className="hero-sheets__words">Office days help new people learn fast.</span>
            </div>
            <div className="hero-sheets__voice hero-sheets__voice--both">
              <span className="hero-sheets__name">Both</span>
              <span className="hero-sheets__words">want the team to do its best work.</span>
            </div>
            <div className="hero-sheets__voice hero-sheets__voice--second">
              <span className="hero-sheets__name">Val</span>
              <span className="hero-sheets__words">Remote days protect time for deep work.</span>
            </div>
          </div>
        </figure>
      </section>

      <section id="how-it-works" className="how">
        <h2>Three steps, and nobody has to win.</h2>
        <ol className="how__steps">
          <li>
            <span className="how__marker how__marker--first" aria-hidden="true">1</span>
            <h3>Everyone writes</h3>
            <p>Each person explains what they believe and why, without seeing anyone else&apos;s answer first.</p>
          </li>
          <li>
            <span className="how__marker how__marker--second" aria-hidden="true">2</span>
            <h3>Each view is restated</h3>
            <p>Every perspective is rewritten in its clearest, fairest form, and its author can say whether it got them right.</p>
          </li>
          <li>
            <span className="how__marker how__marker--shared" aria-hidden="true">3</span>
            <h3>You see the overlap</h3>
            <p>The points you share, and the differences that are still worth talking about.</p>
          </li>
        </ol>
      </section>
    </div>
  );
}

function Dashboard() {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [statusFilter, setStatusFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [temporaryPassword, setTemporaryPassword] = useState(false);

  // People whose account an admin created start with a temporary password; remind them to change it.
  useEffect(() => {
    apiGet<{ data: { user: { passwordChangeRequired?: boolean } } | null }>("/profile")
      .then((response) => setTemporaryPassword(Boolean(response.data?.user.passwordChangeRequired)))
      .catch(() => setTemporaryPassword(false));
  }, []);

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (query) params.set("q", query);
      params.set("page", String(page));
      const response = await apiGet<DashboardResponse>(`/sessions?${params.toString()}`);
      setSessions(response.data?.sessions ?? []);
      setTotal(response.data?.total ?? 0);
      setPageSize(response.data?.pageSize ?? 20);
    } catch {
      setSessions([]);
      setLoadError("Your conversations could not be loaded. Check your connection and reload the page.");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, query, page]);

  useEffect(() => { void fetchSessions(); }, [fetchSessions]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const filtered = statusFilter !== "all" || query !== "";

  return (
    <section className="dashboard">
      <div className="page-heading">
        <h1>Your conversations</h1>
        <Link href="/create" className="button-link">New conversation</Link>
      </div>

      {temporaryPassword && (
        <p className="notice notice--warn temporary-password" role="status">
          You are using a temporary password. <Link href="/profile">Choose your own in your profile.</Link>
        </p>
      )}

      <form
        className="dashboard__filters"
        role="search"
        onSubmit={(event) => { event.preventDefault(); setPage(1); setQuery(searchInput); }}
      >
        <input
          type="search"
          placeholder="Search by question"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          aria-label="Search conversations by question"
        />
        <select
          value={statusFilter}
          onChange={(event) => { setStatusFilter(event.target.value); setPage(1); }}
          aria-label="Show conversations at this stage"
        >
          {STAGE_FILTERS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <button type="submit" className="secondary">Search</button>
      </form>

      {loading ? (
        <p className="quiet-status" role="status">Loading your conversations</p>
      ) : loadError ? (
        <p className="notice notice--error" role="alert">{loadError}</p>
      ) : sessions.length === 0 ? (
        <div className="empty-state">
          <h2>{filtered ? "No conversations match" : "No conversations yet"}</h2>
          <p>
            {filtered
              ? "Try another search, or show all stages."
              : "Start with a question where understanding each other matters more than winning."}
          </p>
          {!filtered && <Link href="/create" className="button-link">Start your first conversation</Link>}
        </div>
      ) : (
        <ol className="conversation-list">
          {sessions.map((conversation) => {
            const stage = stageLabel(conversation.status);
            return (
              <li key={conversation.id} className={`conversation-row conversation-row--${stage.tone}`}>
                <Link href={`/session/${conversation.id}`} className="conversation-row__topic">{conversation.topic}</Link>
                <div className="conversation-row__meta">
                  <span className="conversation-row__stage">{stage.label}</span>
                  <span>{conversation.participantCount} {conversation.participantCount === 1 ? "person" : "people"}</span>
                  <span>
                    Started {new Date(conversation.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {totalPages > 1 && (
        <nav className="pagination" aria-label="Pages">
          <button type="button" className="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous page</button>
          <span>Page {page} of {totalPages}</span>
          <button type="button" className="secondary" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next page</button>
        </nav>
      )}
    </section>
  );
}
