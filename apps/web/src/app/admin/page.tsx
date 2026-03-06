"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { apiGet, apiPost } from "../../lib-api";

type Analytics = {
  totalSessions: number;
  completedSessions: number;
  completionRate: number;
  conflictTypeDistribution: Record<string, number>;
  steelmanAcceptanceCount: number;
  feedbackSummary: {
    count: number;
    avgFaithfulness: number | null;
    avgNeutrality: number | null;
  };
};

type Cohort = {
  id: string;
  name: string;
  _count: { members: number };
  members: Array<{
    id: string;
    user: { id: string; email: string; displayName: string };
  }>;
};

type Organization = {
  id: string;
  name: string;
  slug: string;
  forceAnonymous: boolean;
  _count: { users: number };
  cohorts: Cohort[];
};

export default function AdminDashboardPage() {
  const { data: session } = useSession();
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [org, setOrg] = useState<Organization | null>(null);
  const [cohorts, setCohorts] = useState<Cohort[]>([]);
  const [newCohortName, setNewCohortName] = useState("");
  const [addMemberEmail, setAddMemberEmail] = useState("");
  const [selectedCohort, setSelectedCohort] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [analyticsRes, orgRes, cohortsRes] = await Promise.all([
        apiGet<{ success: boolean; data: { analytics: Analytics } | null }>("/admin/analytics").catch(() => null),
        apiGet<{ success: boolean; data: { organization: Organization } | null }>("/admin/org").catch(() => null),
        apiGet<{ success: boolean; data: { cohorts: Cohort[] } | null }>("/admin/cohorts").catch(() => null),
      ]);
      setAnalytics(analyticsRes?.data?.analytics ?? null);
      setOrg(orgRes?.data?.organization ?? null);
      setCohorts(cohortsRes?.data?.cohorts ?? []);
    } catch {
      setError("Failed to load admin data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  async function handleCreateCohort(e: React.FormEvent) {
    e.preventDefault();
    if (!newCohortName.trim()) return;
    try {
      await apiPost("/admin/cohorts", { name: newCohortName.trim() });
      setNewCohortName("");
      void fetchData();
    } catch {
      setError("Failed to create cohort");
    }
  }

  async function handleAddMember(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedCohort || !addMemberEmail.trim()) return;
    try {
      await apiPost(`/admin/cohorts/${selectedCohort}/members`, { email: addMemberEmail.trim() });
      setAddMemberEmail("");
      void fetchData();
    } catch {
      setError("Failed to add member");
    }
  }

  async function handleExportCSV() {
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000"}/admin/analytics/export`,
        { headers: { authorization: `Bearer ${session?.user?.accessToken}` } }
      );
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "analytics-export.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("Failed to export CSV");
    }
  }

  if (session?.user?.role !== "institutional_admin") {
    return (
      <section className="grid">
        <article className="card">
          <h1>Admin Dashboard</h1>
          <p>You must be an institutional admin to access this page.</p>
        </article>
      </section>
    );
  }

  if (loading) {
    return (
      <section className="grid">
        <article className="card"><p>Loading admin dashboard...</p></article>
      </section>
    );
  }

  return (
    <section className="grid">
      {error && (
        <article className="card" style={{ borderColor: "#ef4444" }}>
          <p style={{ color: "#ef4444" }}>{error}</p>
          <button onClick={() => setError(null)}>Dismiss</button>
        </article>
      )}

      {/* Organization Info */}
      <article className="card">
        <h1>Admin Dashboard</h1>
        {org && (
          <div>
            <p><strong>Organization:</strong> {org.name} ({org.slug})</p>
            <p><strong>Members:</strong> {org._count.users}</p>
            <p><strong>Force Anonymous:</strong> {org.forceAnonymous ? "Yes" : "No"}</p>
          </div>
        )}
      </article>

      {/* Analytics (CG-FR48) */}
      {analytics && (
        <article className="card">
          <h2>Analytics</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "1rem" }}>
            <div>
              <strong>{analytics.totalSessions}</strong>
              <p>Total Sessions</p>
            </div>
            <div>
              <strong>{analytics.completedSessions}</strong>
              <p>Completed</p>
            </div>
            <div>
              <strong>{Math.round(analytics.completionRate * 100)}%</strong>
              <p>Completion Rate</p>
            </div>
            <div>
              <strong>{analytics.steelmanAcceptanceCount}</strong>
              <p>Steelman Accepts</p>
            </div>
            {analytics.feedbackSummary.avgFaithfulness != null && (
              <div>
                <strong>{analytics.feedbackSummary.avgFaithfulness.toFixed(1)}/5</strong>
                <p>Avg Faithfulness</p>
              </div>
            )}
            {analytics.feedbackSummary.avgNeutrality != null && (
              <div>
                <strong>{analytics.feedbackSummary.avgNeutrality.toFixed(1)}/5</strong>
                <p>Avg Neutrality</p>
              </div>
            )}
          </div>

          <h3>Conflict Type Distribution</h3>
          <ul>
            {Object.entries(analytics.conflictTypeDistribution).map(([type, count]) => (
              <li key={type}>{type}: {count}</li>
            ))}
          </ul>

          {/* CG-FR49: CSV Export */}
          <button onClick={handleExportCSV} style={{ marginTop: "0.5rem" }}>
            Export as CSV
          </button>
        </article>
      )}

      {/* Cohort Management (CG-FR45) */}
      <article className="card">
        <h2>Cohort Management</h2>

        <form onSubmit={handleCreateCohort} style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
          <input
            type="text"
            placeholder="New cohort name"
            value={newCohortName}
            onChange={(e) => setNewCohortName(e.target.value)}
          />
          <button type="submit">Create Cohort</button>
        </form>

        {cohorts.map((cohort) => (
          <div key={cohort.id} style={{ border: "1px solid #e5e7eb", borderRadius: "0.25rem", padding: "0.75rem", marginBottom: "0.5rem" }}>
            <strong>{cohort.name}</strong> ({cohort._count.members} members)
            <ul style={{ marginTop: "0.25rem" }}>
              {cohort.members.map((m) => (
                <li key={m.id}>{m.user.displayName} ({m.user.email})</li>
              ))}
            </ul>
            <button
              onClick={() => setSelectedCohort(cohort.id)}
              style={{ fontSize: "0.875rem", marginTop: "0.25rem" }}
            >
              Add Member
            </button>
          </div>
        ))}

        {selectedCohort && (
          <form onSubmit={handleAddMember} style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
            <input
              type="email"
              placeholder="Member email"
              value={addMemberEmail}
              onChange={(e) => setAddMemberEmail(e.target.value)}
            />
            <button type="submit">Add</button>
            <button type="button" onClick={() => setSelectedCohort(null)}>Cancel</button>
          </form>
        )}
      </article>
    </section>
  );
}
