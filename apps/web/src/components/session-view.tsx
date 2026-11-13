"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";

import { apiPost } from "../lib-api";
import { ConversationHeader } from "./conversation/conversation-header";
import { AnalysisProgress, NextStep, PauseNotice } from "./conversation/next-step";
import { ParticipantsPanel, PeopleChips, participantName } from "./conversation/participants-panel";
import { PerspectiveEditor } from "./conversation/perspective-editor";
import { FeedbackPanel, ResultsActions, RoundHistory } from "./conversation/results-footer";
import { ResultsView, type LabelOwner } from "./conversation/results-view";
import type { ResultsInteraction, SectionComment } from "./conversation/types";
import { useConversation } from "./conversation/use-conversation";

function formatDay(value: string | undefined): string | null {
  return value ? new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "long" }) : null;
}

export function SessionView({ sessionId }: { sessionId: string }) {
  const { data: authSession, status: authStatus } = useSession();
  const currentUserId = authSession?.user?.id;
  const role = authSession?.user?.role;
  const conversation = useConversation(sessionId, {
    ready: authStatus !== "loading",
    // The review queue is for moderators, so only they see how long reports have waited.
    isModerator: role === "moderator" || role === "institutional_admin",
  });
  const { session, analysis, status, isAnalyzing } = conversation;

  const [positionText, setPositionText] = useState("");
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [feedbackSaved, setFeedbackSaved] = useState(false);

  // CG-NFR08: keep an unsent draft across refreshes.
  const draftKey = `cg-draft-${sessionId}`;
  useEffect(() => {
    const saved = localStorage.getItem(draftKey);
    if (saved && !hasSubmitted) setPositionText(saved);
  }, [draftKey, hasSubmitted]);

  function updatePositionText(text: string) {
    setPositionText(text);
    if (!hasSubmitted) localStorage.setItem(draftKey, text);
  }

  // Show the viewer's saved perspective once; later refreshes must not overwrite an edit in progress.
  const positionHydrated = useRef(false);
  useEffect(() => {
    if (positionHydrated.current || !session || !currentUserId) return;
    positionHydrated.current = true;
    const self = session.participants.find((participant) => participant.userId === currentUserId);
    if (self?.positionText) {
      setPositionText(self.positionText);
      setHasSubmitted(true);
    }
  }, [session, currentUserId]);

  const self = session?.participants.find((participant) => participant.userId === currentUserId);
  const isCreator = session?.viewer?.isCreator ?? (Boolean(currentUserId) && currentUserId === session?.creatorUserId);
  const isParticipant = session?.viewer?.isParticipant ?? Boolean(self);
  const canShare = session?.viewer?.canShare ?? isCreator;
  const pause = session?.pause?.reason ?? null;
  const anonymous = Boolean(session?.anonymousMode);
  const deadlinePassed = session?.deadline ? new Date(session.deadline) < new Date() : false;
  const submittedCount = session?.participants.filter((participant) => Boolean(participant.positionSubmittedAt)).length ?? 0;
  const waitingCount = (session?.participants.length ?? 0) - submittedCount;
  const result = analysis?.result ?? null;
  const showResults = status === "completed" && Boolean(result);
  // D6: while a new round gathers perspectives, the previous round's results stay readable.
  const previousResult = !showResults && !isAnalyzing ? result : null;

  const owners = useMemo(() => {
    const byLabel: Record<string, LabelOwner> = {};
    for (const participant of session?.participants ?? []) {
      if (!participant.label) continue;
      byLabel[participant.label] = {
        name: participantName(participant, currentUserId, anonymous),
        mine: Boolean(currentUserId) && participant.userId === currentUserId,
      };
    }
    return byLabel;
  }, [session?.participants, currentUserId, anonymous]);

  // D6 and 4.6: a "Not quite" note on the viewer's restated view comes back in the next round's editor.
  const carryNote = useMemo(() => {
    if (!previousResult || !self?.label) return null;
    const notes = conversation.comments.filter((comment) => comment.mine && comment.section === `steelman:${self.label}`);
    const latest = notes[notes.length - 1];
    return latest ? { round: previousResult.roundNumber ?? 1, text: latest.text } : null;
  }, [previousResult, self?.label, conversation.comments]);

  const interaction: ResultsInteraction = {
    myReactions: conversation.myReactions,
    mutual: conversation.mutual,
    reactionErrors: conversation.reactionErrors,
    onReact: (section, reaction) => void conversation.react(section, reaction),
    comments: conversation.comments,
    commentErrors: conversation.commentErrors,
    onComment: conversation.comment,
    authorName: (comment: SectionComment) => {
      if (comment.mine) return "You";
      if (anonymous || !comment.userId) return "A participant";
      const author = session?.participants.find((participant) => participant.userId === comment.userId);
      return author?.user?.displayName ?? "A participant";
    },
    myLabel: self?.label ?? null,
  };

  async function submitPosition() {
    setBusy(true);
    setActionError(null);
    try {
      await apiPost(`/sessions/${sessionId}/positions`, { positionText, roundNumber: 1 });
      setHasSubmitted(true);
      setEditing(false);
      localStorage.removeItem(draftKey);
      await conversation.refreshSession();
    } catch (submitError) {
      setActionError(submitError instanceof Error ? submitError.message : "Your perspective was not saved. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function startAnalysis() {
    setBusy(true);
    setActionError(null);
    try {
      // The API queues the analysis and answers at once; the page then follows its progress.
      await apiPost(`/sessions/${sessionId}/analyze`, {});
      await conversation.refreshAnalysis();
    } catch (analyzeError) {
      setActionError(analyzeError instanceof Error ? analyzeError.message : "The analysis could not start. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function startNextRound() {
    setBusy(true);
    setActionError(null);
    try {
      await apiPost(`/sessions/${sessionId}/reenter`, {});
      setEditing(true);
      setFeedbackSaved(false);
      await Promise.all([conversation.refreshSession(), conversation.refreshAnalysis()]);
    } catch (reenterError) {
      setActionError(reenterError instanceof Error ? reenterError.message : "The next round could not start. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function submitFeedback(faithfulness: number, neutrality: number, comment: string) {
    await apiPost(`/sessions/${sessionId}/feedback`, { faithfulness, neutrality, comment: comment || undefined });
    setFeedbackSaved(true);
  }

  const roundNumber = result?.roundNumber ?? 1;
  const roundNote = showResults
    ? [`Round ${roundNumber} results`, formatDay(result?.createdAt)].filter(Boolean).join(", ")
    : previousResult
      ? `Round ${roundNumber + 1}`
      : null;

  if (!session) {
    return conversation.loadError ? (
      <p className="notice notice--error" role="alert">{conversation.loadError}</p>
    ) : (
      <p className="quiet-status" role="status">Loading the conversation</p>
    );
  }

  return (
    <div className="conversation">
      <ConversationHeader
        sessionId={sessionId}
        topic={session.topic}
        status={status}
        deadline={session.deadline}
        anonymous={anonymous}
        roundNote={roundNote}
        moderationSla={conversation.moderationSla}
      />

      {showResults && result ? (
        <>
          <PeopleChips session={session} viewerId={currentUserId} />
          <ResultsView result={result} owners={owners} interaction={isParticipant ? interaction : undefined} />
          <ResultsActions
            sessionId={sessionId}
            nextRound={roundNumber + 1}
            canStartRound={isCreator}
            canShare={canShare}
            canExport={isParticipant}
            busy={busy}
            onStartRound={startNextRound}
          />
          {isParticipant && <FeedbackPanel onSubmit={submitFeedback} saved={feedbackSaved} />}
          <RoundHistory rounds={conversation.rounds} />
          {positionText && (
            <details className="own-perspective">
              <summary>Your perspective, as you wrote it</summary>
              <blockquote className="own-words">{positionText}</blockquote>
            </details>
          )}
        </>
      ) : isAnalyzing ? (
        <AnalysisProgress estimatedCompletionAt={analysis?.estimatedCompletionAt ?? null} />
      ) : (
        <>
          <PauseNotice status={status} pause={pause} isCreator={isCreator} />
          <div className="conversation__columns">
            <div className="conversation__main">
              {isParticipant && (
                <PerspectiveEditor
                  text={positionText}
                  onChange={updatePositionText}
                  hasSubmitted={hasSubmitted}
                  editing={editing}
                  onEdit={() => setEditing(true)}
                  onCancel={() => setEditing(false)}
                  onSubmit={submitPosition}
                  busy={busy}
                  deadlinePassed={deadlinePassed}
                  removedByModerator={Boolean(self?.positionRemovedAt)}
                  anonymous={anonymous}
                  carryNote={carryNote}
                />
              )}
              {(isCreator || hasSubmitted) && (
                <NextStep
                  isCreator={isCreator}
                  pause={pause}
                  submittedCount={submittedCount}
                  waitingCount={waitingCount}
                  viewerSubmitted={hasSubmitted}
                  busy={busy}
                  onAnalyze={startAnalysis}
                />
              )}
            </div>
            <ParticipantsPanel
              session={session}
              viewerId={currentUserId}
              canInvite={isCreator}
              onInvited={conversation.refreshSession}
            />
          </div>
          {previousResult && (
            <details className="previous-round">
              <summary>Round {roundNumber} results, read only</summary>
              <ResultsView result={previousResult} owners={owners} />
            </details>
          )}
        </>
      )}

      {actionError && <p className="notice notice--error" role="alert">{actionError}</p>}
    </div>
  );
}
