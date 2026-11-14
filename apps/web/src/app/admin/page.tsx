"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { apiGet, apiPost } from "../../lib-api";
import { getPublicApiBaseUrl } from "../../lib/api-base";
import { AdminSetupForm } from "../../components/admin/admin-setup-form";
import { CreateAccountForm } from "../../components/admin/create-account-form";

type Analytics = {
  totalSessions: number;
  completedSessions: number;
  completionRate: number;
  conflictTypeDistribution: Record<string, number>;
  steelmanAcceptanceCount: number;
  feedbackSummary: {
    count: number;
    fairness?: { yes: number; somewhat: number; no: number };
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

const KIND_NAMES: Record<string, string> = {
  empirical: "Facts",
  value: "Values",
  semantic: "Definitions",
  policy: "Approach",
  procedural: "Approach",
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
      setError("The administration data could not be loaded. Reload the page to try again.");
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
      setError("The cohort was not created. Try again.");
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
      setError("The member was not added. Check the email address and try again.");
    }
  }

  async function handleExportCSV() {
    try {
      const res = await fetch(
        `${getPublicApiBaseUrl()}/admin/analytics/export`,
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
      setError("The CSV export failed. Try again.");
    }
  }

  if (session?.user?.role !== "institutional_admin") {
    return (
      <section className="narrow-page">
        <h1>Administration</h1>
        <p>This page is for organization administrators.</p>
        <AdminSetupForm />
      </section>
    );
  }

  if (loading) {
    return <p className="quiet-status" role="status">Loading the administration page</p>;
  }

  return (
    <section className="admin">
      <h1>Administration</h1>

      {error && (
        <div className="notice notice--error" role="alert">
          <p>{error}</p>
          <button type="button" className="link-button" onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      {org && (
        <dl className="facts">
          <div><dt>Organization</dt><dd>{org.name} ({org.slug})</dd></div>
          <div><dt>Members</dt><dd>{org._count.users}</dd></div>
          <div><dt>Anonymous by default</dt><dd>{org.forceAnonymous ? "Yes, for every conversation" : "No"}</dd></div>
        </dl>
      )}

      {/* Analytics (CG-FR48) */}
      {analytics && (
        <section className="panel" aria-labelledby="analytics-heading">
          <h2 id="analytics-heading">How conversations are going</h2>
          <dl className="stats">
            <div><dt>Conversations</dt><dd>{analytics.totalSessions}</dd></div>
            <div><dt>With results</dt><dd>{analytics.completedSessions}</dd></div>
            <div><dt>Reach results</dt><dd>{Math.round(analytics.completionRate * 100)}%</dd></div>
            <div><dt>Restated views accepted</dt><dd>{analytics.steelmanAcceptanceCount}</dd></div>
            {analytics.feedbackSummary.fairness && analytics.feedbackSummary.count > 0 && (
              <div>
                <dt>Felt fair</dt>
                <dd>{analytics.feedbackSummary.fairness.yes} yes, {analytics.feedbackSummary.fairness.somewhat} somewhat, {analytics.feedbackSummary.fairness.no} no</dd>
              </div>
            )}
            {analytics.feedbackSummary.avgFaithfulness != null && (
              <div><dt>Restated views felt faithful</dt><dd>{analytics.feedbackSummary.avgFaithfulness.toFixed(1)} of 5</dd></div>
            )}
            {analytics.feedbackSummary.avgNeutrality != null && (
              <div><dt>Summaries felt neutral</dt><dd>{analytics.feedbackSummary.avgNeutrality.toFixed(1)} of 5</dd></div>
            )}
          </dl>

          <h3>Kinds of difference found</h3>
          <ul className="plain-list">
            {Object.entries(analytics.conflictTypeDistribution).map(([type, count]) => (
              <li key={type}>{KIND_NAMES[type] ?? type}: {count}</li>
            ))}
          </ul>

          {/* CG-FR49: CSV Export */}
          <button type="button" className="secondary" onClick={handleExportCSV}>
            Export as CSV
          </button>
        </section>
      )}

      <CreateAccountForm />

      {/* Cohort Management (CG-FR45) */}
      <section className="panel" aria-labelledby="cohorts-heading">
        <h2 id="cohorts-heading">Cohorts</h2>

        <form onSubmit={handleCreateCohort} className="inline-row">
          <label htmlFor="cohort-name" className="visually-hidden">New cohort name</label>
          <input
            id="cohort-name"
            type="text"
            placeholder="New cohort name"
            value={newCohortName}
            onChange={(e) => setNewCohortName(e.target.value)}
          />
          <button type="submit">Create cohort</button>
        </form>

        <ul className="cohorts">
          {cohorts.map((cohort) => (
            <li key={cohort.id} className="cohort">
              <h3>{cohort.name} <span className="field__help">({cohort._count.members} {cohort._count.members === 1 ? "member" : "members"})</span></h3>
              <ul className="plain-list">
                {cohort.members.map((m) => (
                  <li key={m.id}>{m.user.displayName} ({m.user.email})</li>
                ))}
              </ul>
              <button type="button" className="link-button" onClick={() => setSelectedCohort(cohort.id)}>
                Add a member
              </button>
            </li>
          ))}
        </ul>

        {selectedCohort && (
          <form onSubmit={handleAddMember} className="inline-row">
            <label htmlFor="member-email" className="visually-hidden">Member email</label>
            <input
              id="member-email"
              type="email"
              placeholder="Member email"
              value={addMemberEmail}
              onChange={(e) => setAddMemberEmail(e.target.value)}
            />
            <button type="submit">Add</button>
            <button type="button" className="link-button" onClick={() => setSelectedCohort(null)}>Cancel</button>
          </form>
        )}
      </section>
    </section>
  );
}
