"use client";

import Link from "next/link";
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
  data: {
    sessions: SessionRow[];
    total: number;
    page: number;
    pageSize: number;
  } | null;
};

const STATUS_OPTIONS = [
  { value: "all", label: "All Statuses" },
  { value: "draft", label: "Draft" },
  { value: "collecting_positions", label: "Collecting" },
  { value: "queued", label: "Queued" },
  { value: "running", label: "Running" },
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" },
];

const STATUS_BADGES: Record<string, string> = {
  draft: "badge--muted",
  collecting_positions: "badge--info",
  queued: "badge--warn",
  running: "badge--warn",
  completed: "badge--ok",
  failed: "badge--err",
  needs_input: "badge--warn",
};

export default function DashboardPage() {
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
      const qs = params.toString();
      const res = await apiGet<DashboardResponse>(`/sessions${qs ? `?${qs}` : ""}`);
      setSessions(res.data?.sessions ?? []);
      setTotal(res.data?.total ?? 0);
      setPageSize(res.data?.pageSize ?? 20);
    } catch {
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, query, page]);

  useEffect(() => {
    void fetchSessions();
  }, [fetchSessions]);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    setQuery(searchInput);
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <section className="grid">
      <article className="card">
        <div className="dash-header">
          <h1>Session Dashboard</h1>
          <Link href="/create" className="dash-create-btn">+ New Session</Link>
        </div>
      </article>

      <article className="card">
        <div className="dash-controls">
          <form onSubmit={handleSearch} className="dash-search">
            <input
              type="search"
              placeholder="Search topics…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              aria-label="Search sessions by topic"
            />
            <button type="submit">Search</button>
          </form>

          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            aria-label="Filter by status"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        {loading ? (
          <p className="dash-empty">Loading…</p>
        ) : sessions.length === 0 ? (
          <p className="dash-empty">No sessions found. <Link href="/create">Create one</Link> to get started.</p>
        ) : (
          <>
            <table className="dash-table" role="grid">
              <thead>
                <tr>
                  <th>Topic</th>
                  <th>Status</th>
                  <th>Participants</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id}>
                    <td><Link href={`/session/${s.id}`}>{s.topic}</Link></td>
                    <td>
                      <span className={`badge ${STATUS_BADGES[s.status] ?? ""}`}>
                        {s.status.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td>{s.participantCount}</td>
                    <td>{new Date(s.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {totalPages > 1 && (
              <div className="dash-pagination">
                <button disabled={page <= 1} onClick={() => setPage(page - 1)}>← Prev</button>
                <span>Page {page} of {totalPages} ({total} sessions)</span>
                <button disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next →</button>
              </div>
            )}
          </>
        )}
      </article>
    </section>
  );
}
