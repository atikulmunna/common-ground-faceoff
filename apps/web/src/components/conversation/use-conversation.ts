"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { apiGet, apiPost } from "../../lib-api";
import { useLiveRefresh } from "../../lib/use-live-refresh";
import type { AnalysisState, ReactionValue, RoundSummary, SectionComment, SessionData } from "./types";

/** Check a running analysis often; check a conversation that is still gathering perspectives rarely. */
const ANALYSIS_POLL_MS = 3_000;
const GATHERING_POLL_MS = 30_000;

type Envelope<T> = { success: boolean; data: T | null };

export type ModerationSla = { summary: { pendingCount: number; breachedCount: number; nextDueAt: string | null } };

/**
 * Loads a conversation and keeps it current: often while an analysis runs, rarely while
 * perspectives are gathered, and not at all once results exist.
 */
export function useConversation(sessionId: string, options: { ready: boolean; isModerator: boolean }) {
  const { ready, isModerator } = options;
  const [session, setSession] = useState<SessionData | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rounds, setRounds] = useState<RoundSummary[]>([]);
  const [myReactions, setMyReactions] = useState<Record<string, ReactionValue>>({});
  const [mutual, setMutual] = useState<Record<string, boolean>>({});
  const [reactionErrors, setReactionErrors] = useState<Record<string, string>>({});
  const [comments, setComments] = useState<SectionComment[]>([]);
  const [commentErrors, setCommentErrors] = useState<Record<string, string>>({});
  const [moderationSla, setModerationSla] = useState<ModerationSla | null>(null);

  const refreshSession = useCallback(async () => {
    try {
      const response = await apiGet<Envelope<{ session: SessionData }>>(`/sessions/${sessionId}`);
      setSession(response.data?.session ?? null);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "This conversation could not be loaded.");
    }
  }, [sessionId]);

  const refreshAnalysis = useCallback(async () => {
    try {
      const response = await apiGet<Envelope<AnalysisState>>(`/sessions/${sessionId}/analysis`);
      setAnalysis(response.data ?? null);
    } catch {
      // A missed poll is retried on the next one, so it does not need a visible error.
    }
  }, [sessionId]);

  const refreshReactions = useCallback(async () => {
    try {
      const response = await apiGet<Envelope<{
        reactions: Array<{ mine?: boolean; section: string; reaction: ReactionValue }>;
        mutualAcknowledgments: Record<string, boolean>;
      }>>(`/sessions/${sessionId}/reactions`);
      if (!response.data) return;
      const mine: Record<string, ReactionValue> = {};
      for (const reaction of response.data.reactions) {
        if (reaction.mine) mine[reaction.section] = reaction.reaction;
      }
      setMyReactions(mine);
      setMutual(response.data.mutualAcknowledgments);
    } catch {
      // Keep what is on screen; the viewer's own answers are already shown.
    }
  }, [sessionId]);

  const fetchComments = useCallback(async () => {
    try {
      const response = await apiGet<Envelope<{ comments: SectionComment[] }>>(`/sessions/${sessionId}/comments`);
      setComments(response.data?.comments ?? []);
    } catch {
      // Keep what is on screen.
    }
  }, [sessionId]);

  const fetchRounds = useCallback(async () => {
    try {
      const response = await apiGet<Envelope<{ rounds: RoundSummary[] }>>(`/sessions/${sessionId}/rounds`);
      setRounds(response.data?.rounds ?? []);
    } catch {
      // Round history is optional.
    }
  }, [sessionId]);

  const fetchModerationSla = useCallback(async () => {
    try {
      const response = await apiGet<Envelope<ModerationSla>>(`/moderation/session/${sessionId}/sla`);
      setModerationSla(response.data ?? null);
    } catch {
      // Optional for moderators, and never shown to anyone else.
    }
  }, [sessionId]);

  // Initial load. Rounds, reactions and comments follow once results exist (see below).
  useEffect(() => {
    if (!ready) return;
    void refreshSession();
    void refreshAnalysis();
    if (isModerator) void fetchModerationSla();
  }, [ready, isModerator, refreshSession, refreshAnalysis, fetchModerationSla]);

  // CG-FR07: inactivity should reflect real activity, so send a heartbeat on activity, at most once a minute.
  useEffect(() => {
    if (!ready) return;
    let lastHeartbeatAt = 0;
    const sendHeartbeat = () => {
      const now = Date.now();
      if (now - lastHeartbeatAt < 60_000) return;
      lastHeartbeatAt = now;
      void apiPost(`/sessions/${sessionId}/heartbeat`, {}).catch(() => {});
    };
    sendHeartbeat();
    const activityEvents = ["mousedown", "keydown", "scroll", "touchstart"] as const;
    for (const event of activityEvents) window.addEventListener(event, sendHeartbeat, { passive: true });
    return () => {
      for (const event of activityEvents) window.removeEventListener(event, sendHeartbeat);
    };
  }, [ready, sessionId]);

  const status = analysis?.status ?? session?.status ?? "draft";
  const isAnalyzing = status === "queued" || status === "running";

  // When results appear (on load, or when an analysis finishes while the page is open), load what
  // goes with them. Others' perspectives also become visible at that point.
  const loadedStatus = analysis?.status ?? session?.status ?? null;
  const previousStatus = useRef<string | null>(null);
  useEffect(() => {
    const previous = previousStatus.current;
    previousStatus.current = loadedStatus;
    if (loadedStatus !== "completed" || previous === "completed") return;
    void fetchRounds();
    void refreshReactions();
    void fetchComments();
    if (previous !== null) void refreshSession();
  }, [loadedStatus, fetchRounds, refreshReactions, fetchComments, refreshSession]);

  const refreshLive = useCallback(async () => {
    if (status === "completed") {
      await Promise.all([refreshReactions(), fetchComments()]);
    } else if (isAnalyzing) {
      await refreshAnalysis();
    } else {
      await Promise.all([refreshSession(), refreshAnalysis()]);
    }
  }, [status, isAnalyzing, refreshReactions, fetchComments, refreshAnalysis, refreshSession]);

  // No timer once results exist; reactions and comments then refresh when the viewer returns to the tab.
  useLiveRefresh(refreshLive, !ready || status === "completed" ? null : isAnalyzing ? ANALYSIS_POLL_MS : GATHERING_POLL_MS);

  /** Shows the answer at once, and puts the old one back with an error if it is not saved. */
  const react = useCallback(async (section: string, reaction: ReactionValue) => {
    const before = myReactions[section];
    setMyReactions((current) => ({ ...current, [section]: reaction }));
    setReactionErrors(({ [section]: _cleared, ...rest }) => rest);
    try {
      await apiPost(`/sessions/${sessionId}/reactions`, { section, reaction });
      await refreshReactions();
    } catch {
      setMyReactions(({ [section]: _failed, ...rest }) => (before ? { ...rest, [section]: before } : rest));
      setReactionErrors((current) => ({ ...current, [section]: "Your answer was not saved. Try again." }));
    }
  }, [myReactions, sessionId, refreshReactions]);

  /** Shows the comment at once; returns false, and removes it, if it is not saved. */
  const comment = useCallback(async (section: string, text: string): Promise<boolean> => {
    const pendingId = `pending-${Date.now()}`;
    setComments((current) => [
      ...current,
      { id: pendingId, userId: null, mine: true, section, text, createdAt: new Date().toISOString(), pending: true },
    ]);
    setCommentErrors(({ [section]: _cleared, ...rest }) => rest);
    try {
      await apiPost(`/sessions/${sessionId}/comments`, { section, text });
      await fetchComments();
      return true;
    } catch {
      setComments((current) => current.filter((item) => item.id !== pendingId));
      setCommentErrors((current) => ({ ...current, [section]: "Your comment was not posted. Try again." }));
      return false;
    }
  }, [sessionId, fetchComments]);

  return {
    session,
    analysis,
    setAnalysis,
    loadError,
    status,
    isAnalyzing,
    rounds,
    fetchRounds,
    myReactions,
    mutual,
    reactionErrors,
    react,
    comments,
    commentErrors,
    comment,
    moderationSla,
    refreshSession,
    refreshAnalysis,
  };
}
