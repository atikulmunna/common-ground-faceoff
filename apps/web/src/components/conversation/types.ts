import type { GroundedPoint, ParticipantValues, Verification } from "@common-ground/shared";

export type Participant = {
  id: string;
  /** Null for other participants while anonymous mode hides identities. */
  userId: string | null;
  role: string;
  /** The label the analysis uses for this person, such as "Participant B". */
  label?: string;
  positionText: string | null;
  /** The viewer's own answer to "What could change your mind?"; null for others before results. */
  positionChangeMind?: string | null;
  positionSubmittedAt: string | null;
  /** Set on the viewer's own entry when a moderator removed their perspective. */
  positionRemovedAt?: string | null;
  user?: { id: string | null; displayName: string; email?: string };
};

export type PauseReason = "moderation_review" | "awaiting_rewrite";

export type SessionData = {
  id: string;
  topic: string;
  status: string;
  creatorUserId: string;
  anonymousMode: boolean;
  deadline: string | null;
  participants: Participant[];
  viewer?: { isCreator: boolean; isParticipant: boolean; canShare: boolean };
  participantLimit?: number;
  pause?: { reason: PauseReason } | null;
  /** Only sent to the creator. */
  invitations?: Array<{ email: string; status: string }>;
};

export type AnalysisResult = {
  roundNumber?: number;
  createdAt?: string;
  /** Joined text; the only content of results saved before points were kept. */
  sharedFoundations: string;
  trueDisagreements: string;
  steelmans: Record<string, string>;
  conflictMap: Record<string, string[] | string>;
  /** Each point with its supporting quotes. Null or absent on older results. */
  sharedFoundationPoints?: GroundedPoint[] | null;
  disagreementPoints?: GroundedPoint[] | null;
  participantValues?: ParticipantValues | null;
  verification?: Verification | null;
};

export type AnalysisState = {
  /** The conversation's current status; `result` may belong to an earlier round. */
  status: string;
  estimatedCompletionAt: string | null;
  result: AnalysisResult | null;
  /** The stage a running analysis has reached. */
  progress?: { stage: number; total: number } | null;
};

export type RoundSummary = AnalysisResult & { id: string; roundNumber: number; createdAt: string };

export type ReactionValue = "represents" | "misrepresents" | "neutral";

export type SectionComment = {
  id: string;
  userId: string | null;
  mine?: boolean;
  section: string;
  text: string;
  createdAt: string;
  /** Shown while a new comment is being saved. */
  pending?: boolean;
};

/** What the results view needs to let the viewer react and comment. Absent on the public share page. */
export type ResultsInteraction = {
  myReactions: Record<string, ReactionValue>;
  mutual: Record<string, boolean>;
  reactionErrors: Record<string, string>;
  onReact: (section: string, reaction: ReactionValue) => void;
  comments: SectionComment[];
  commentErrors: Record<string, string>;
  onComment: (section: string, text: string) => Promise<boolean>;
  /** Display name for a comment's author. */
  authorName: (comment: SectionComment) => string;
  /** The viewer's own label, so their restated view can ask "Is this what you meant?". */
  myLabel: string | null;
};
