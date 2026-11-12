/**
 * NextAuth credentials sign-in can only report failure as an error string, so a
 * pending second factor is passed from `authorize` to the sign-in page encoded
 * in that string. The ticket is short-lived and useless without the user's code.
 */
export type MfaChallenge = {
  mfaType: "totp" | "sms";
  mfaTicket: string;
};

const PREFIX = "MFA_REQUIRED:";

export function encodeMfaChallenge(challenge: MfaChallenge): string {
  return `${PREFIX}${challenge.mfaType}:${challenge.mfaTicket}`;
}

export function parseMfaChallenge(error: string | null | undefined): MfaChallenge | null {
  if (!error?.startsWith(PREFIX)) return null;

  const [mfaType, mfaTicket] = error.slice(PREFIX.length).split(":");
  if ((mfaType !== "totp" && mfaType !== "sms") || !mfaTicket) return null;

  return { mfaType, mfaTicket };
}
