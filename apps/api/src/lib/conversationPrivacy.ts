import { createHash } from "node:crypto";

/** How many people, creator included, may take part, by the creator's plan (CG-FR11). */
export function participantLimit(tier: string | null | undefined): number {
  return tier === "free" ? 2 : 6;
}

/**
 * Marks which rows are the viewer's own. In an anonymous conversation another person's account id
 * is replaced by null, since an id is the same in every conversation and would identify them.
 */
export function attributeToViewer<T extends { userId: string }>(
  rows: T[],
  viewerId: string,
  anonymous: boolean,
): Array<Omit<T, "userId"> & { userId: string | null; mine: boolean }> {
  return rows.map(({ userId, ...rest }) => {
    const mine = userId === viewerId;
    return { ...rest, userId: anonymous && !mine ? null : userId, mine };
  });
}

/**
 * A stable order that does not follow the order people joined in. Anonymous conversations use it for
 * participant labels and lists, so the creator cannot match "Participant B" to the second invitee.
 */
export function anonymousOrderKey(sessionId: string, id: string): string {
  return createHash("sha256").update(`${sessionId}:${id}`).digest("hex");
}
