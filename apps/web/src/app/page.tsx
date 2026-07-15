"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useState } from "react";
import { apiGet } from "../lib-api";

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

const STATUS_OPTIONS = [
  { value: "all", label: "All stages" },
  { value: "draft", label: "Draft" },
  { value: "collecting_positions", label: "Gathering perspectives" },
  { value: "queued", label: "Queued" },
  { value: "running", label: "Finding common ground" },
  { value: "completed", label: "Ready to review" },
  { value: "failed", label: "Needs attention" },
];

const STATUS_META: Record<string, { label: string; badge: string; action: string }> = {
  draft: { label: "Draft", badge: "badge--muted", action: "Continue setup" },
  collecting_positions: { label: "Gathering perspectives", badge: "badge--info", action: "Add perspective" },
  queued: { label: "Analysis queued", badge: "badge--warn", action: "View progress" },
  running: { label: "Finding common ground", badge: "badge--warn", action: "View progress" },
  completed: { label: "Ready to review", badge: "badge--ok", action: "Explore results" },
  failed: { label: "Needs attention", badge: "badge--err", action: "Review conversation" },
  needs_input: { label: "Needs more input", badge: "badge--warn", action: "Add input" },
};

export default function HomePage() {
  const { data: authSession, status: authStatus } = useSession();

  if (authStatus === "loading") {
    return <div className="page-loading" role="status">Opening Common Ground…</div>;
  }

  if (!authSession?.user) return <LandingPage />;
  return <Dashboard />;
}

function LandingPage() {
  return (
    <div className="landing">
      <section className="landing-hero">
        <div className="landing-hero__copy">
          <span className="eyebrow">Better conversations, clearer outcomes</span>
          <h1>Turn disagreement into shared understanding.</h1>
          <p>
            Common Ground helps people express their perspectives, understand the strongest version
            of each other&apos;s views, and discover where meaningful agreement is possible.
          </p>
          <div className="landing-actions">
            <Link href="/sign-in" className="button-link button-link--primary">Start a conversation</Link>
            <a href="#how-it-works" className="button-link button-link--secondary">See how it works</a>
          </div>
          <p className="landing-note">Designed for thoughtful discussion—not scoring points.</p>
        </div>
        <div className="landing-preview" aria-label="Example common ground summary">
          <div className="landing-preview__top">
            <span className="preview-dot preview-dot--blue" />
            <span className="preview-dot preview-dot--amber" />
            <span>Conversation insight</span>
          </div>
          <div className="landing-preview__section">
            <span className="landing-preview__icon" aria-hidden="true">✓</span>
            <div><strong>Shared foundation</strong><p>Both sides value a fair outcome and long-term trust.</p></div>
          </div>
          <div className="landing-preview__section landing-preview__section--soft">
            <span className="landing-preview__icon" aria-hidden="true">↔</span>
            <div><strong>Important difference</strong><p>The disagreement is about approach, not the desired result.</p></div>
          </div>
          <div className="landing-preview__confidence"><span>Common ground identified</span><strong>High confidence</strong></div>
        </div>
      </section>

      <section id="how-it-works" className="landing-section">
        <span className="eyebrow">How it works</span>
        <h2>A clear path through difficult conversations</h2>
        <div className="landing-steps">
          <article><span>01</span><h3>Start with a question</h3><p>Frame the topic and invite the people whose perspectives matter.</p></article>
          <article><span>02</span><h3>Share perspectives</h3><p>Everyone explains what they believe, why it matters, and what could change their mind.</p></article>
          <article><span>03</span><h3>Find common ground</h3><p>Review shared foundations, genuine differences, and possible ways forward.</p></article>
        </div>
      </section>

      <section className="landing-cta">
        <div><span className="eyebrow">Ready when you are</span><h2>Make the next disagreement more constructive.</h2></div>
        <Link href="/sign-in" className="button-link button-link--light">Get started</Link>
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

  const fetchSessions = useCallback(async () => {
    setLoading(true);
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
    } finally {
      setLoading(false);
    }
  }, [statusFilter, query, page]);

  useEffect(() => { void fetchSessions(); }, [fetchSessions]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <section className="dashboard-page">
      <div className="dashboard-welcome">
        <div><span className="eyebrow">Your workspace</span><h1>Your conversations</h1><p>Continue an active discussion or create space for a new one.</p></div>
        <Link href="/create" className="button-link button-link--primary">New conversation</Link>
      </div>

      <details className="dash-filter-panel">
        <summary>Search and filters</summary>
        <div className="dash-controls">
          <form onSubmit={(event) => { event.preventDefault(); setPage(1); setQuery(searchInput); }} className="dash-search">
            <input type="search" placeholder="Search conversation topics" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} aria-label="Search conversations by topic" />
            <button type="submit">Search</button>
          </form>
          <select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1); }} aria-label="Filter by conversation stage">
            {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>
      </details>

      {loading ? (
        <div className="conversation-empty" role="status">Loading your conversations…</div>
      ) : sessions.length === 0 ? (
        <div className="conversation-empty">
          <span className="conversation-empty__mark" aria-hidden="true">◎</span>
          <h2>No conversations here yet</h2>
          <p>Start with a question where understanding matters more than winning.</p>
          <Link href="/create" className="button-link button-link--primary">Start your first conversation</Link>
        </div>
      ) : (
        <div className="conversation-grid">
          {sessions.map((conversation) => {
            const meta = STATUS_META[conversation.status] ?? STATUS_META.draft;
            return (
              <article key={conversation.id} className="conversation-card">
                <div className="conversation-card__meta">
                  <span className={`badge ${meta.badge}`}>{meta.label}</span>
                  <span>{conversation.participantCount} {conversation.participantCount === 1 ? "participant" : "participants"}</span>
                </div>
                <h2><Link href={`/session/${conversation.id}`}>{conversation.topic}</Link></h2>
                <p>Created {new Date(conversation.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</p>
                <Link href={`/session/${conversation.id}`} className="conversation-card__action">{meta.action} <span aria-hidden="true">→</span></Link>
              </article>
            );
          })}
        </div>
      )}

      {totalPages > 1 && <div className="dash-pagination"><button disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page} of {totalPages}</span><button disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</button></div>}
    </section>
  );
}
