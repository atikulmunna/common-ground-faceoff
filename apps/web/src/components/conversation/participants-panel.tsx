"use client";

import { useState } from "react";

import { apiPost } from "../../lib-api";
import { inkClass } from "./results-view";
import type { Participant, SessionData } from "./types";

/** The viewer is "You"; others go by name, or by their label when the conversation is anonymous. */
export function participantName(participant: Participant, viewerId: string | undefined, anonymous: boolean): string {
  if (participant.userId && participant.userId === viewerId) return "You";
  if (anonymous || !participant.user?.displayName) return participant.label ?? "Anonymous participant";
  return participant.user.displayName;
}

/** A compact row of who took part, in their inks, shown above the results. */
export function PeopleChips({ session, viewerId }: { session: SessionData; viewerId: string | undefined }) {
  return (
    <ul className="people people--inline" aria-label="People in this conversation">
      {session.participants.map((participant) => (
        <li key={participant.id} className={`person ${inkClass(participant.label)}`}>
          <span className="ink-dot" aria-hidden="true" />
          <span className="person__name">{participantName(participant, viewerId, session.anonymousMode)}</span>
        </li>
      ))}
    </ul>
  );
}

export function ParticipantsPanel({
  session,
  viewerId,
  canInvite,
  onInvited,
}: {
  session: SessionData;
  viewerId: string | undefined;
  /** The creator, before the analysis has started. */
  canInvite: boolean;
  onInvited: () => Promise<void>;
}) {
  const submitted = session.participants.filter((participant) => Boolean(participant.positionSubmittedAt)).length;
  const unsentInvitations = (session.invitations ?? []).filter((invitation) => invitation.status === "pending");

  return (
    <section className="panel" aria-labelledby="people-heading">
      <h2 id="people-heading">Who is taking part</h2>
      {/* Others' text stays hidden until results exist, so count submissions by timestamp. */}
      <p className="section-help">{submitted} of {session.participants.length} perspectives submitted</p>
      <ul className="people">
        {session.participants.map((participant) => {
          const done = Boolean(participant.positionSubmittedAt);
          return (
            <li key={participant.id} className={`person ${inkClass(participant.label)}`}>
              <span className="ink-dot" aria-hidden="true" />
              <span className="person__name">
                {participantName(participant, viewerId, session.anonymousMode)}
                {participant.role === "session_creator" && <span className="person__role"> (host)</span>}
              </span>
              <span className={`state-chip${done ? " state-chip--done" : ""}`}>{done ? "Submitted" : "Not submitted yet"}</span>
            </li>
          );
        })}
      </ul>
      {unsentInvitations.length > 0 && (
        <p className="field__help">
          The invitation email to {unsentInvitations.map((invitation) => invitation.email).join(", ")} could not be sent.
          Try inviting them again.
        </p>
      )}
      {canInvite && (
        <InviteForm
          sessionId={session.id}
          used={session.participants.length}
          limit={session.participantLimit ?? null}
          onInvited={onInvited}
        />
      )}
    </section>
  );
}

function InviteForm({
  sessionId,
  used,
  limit,
  onInvited,
}: {
  sessionId: string;
  used: number;
  limit: number | null;
  onInvited: () => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const full = limit !== null && used >= limit;

  async function handleInvite(event: React.FormEvent) {
    event.preventDefault();
    if (!email) return;
    setSending(true);
    setResult(null);
    try {
      const response = await apiPost<{ data: { status: string } | null }>(`/sessions/${sessionId}/email-invite`, {
        email,
        message: message || undefined,
      });
      setResult({
        ok: true,
        text: response?.data?.status === "pending"
          ? `${email} was added, but the invitation email could not be sent.`
          : `Invitation sent to ${email}`,
      });
      setEmail("");
      setMessage("");
      await onInvited();
    } catch (error) {
      setResult({ ok: false, text: error instanceof Error ? error.message : "The invitation was not sent. Try again." });
    } finally {
      setSending(false);
    }
  }

  return (
    <form onSubmit={handleInvite} className="invite-form">
      <h3>Invite someone</h3>
      {limit !== null && (
        <p className="field__help">
          {full
            ? `This conversation is full: ${limit} of ${limit} places are taken.`
            : `${used} of ${limit} places taken.`}
        </p>
      )}
      <div className="invite-form__fields">
        <div className="field">
          <label htmlFor="invite-email">Email address</label>
          <input
            id="invite-email"
            type="email"
            placeholder="name@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            disabled={full}
            aria-label="Participant email address"
          />
        </div>
        <div className="field">
          <label htmlFor="invite-message">Message (optional)</label>
          <input
            id="invite-message"
            type="text"
            placeholder="Why you would like their view"
            maxLength={500}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            disabled={full}
            aria-label="Personal message for invitation"
          />
        </div>
        <button type="submit" disabled={sending || !email || full}>
          {sending ? "Sending" : "Send invitation"}
        </button>
      </div>
      {result && (
        <p className={result.ok ? "field-ok" : "field-error"} role={result.ok ? "status" : "alert"}>{result.text}</p>
      )}
    </form>
  );
}
