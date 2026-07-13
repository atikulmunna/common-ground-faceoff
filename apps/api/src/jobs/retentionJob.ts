/**
 * Data Retention Job (CG-FR44)
 *
 * Free-tier sessions are retained for 90 days.
 * This script can be run as a cron job: `node dist/jobs/retentionJob.js`
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const FREE_TIER_RETENTION_DAYS = 90;

export async function runRetentionCleanup(db: PrismaClient = prisma) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - FREE_TIER_RETENTION_DAYS);

  // Find free-tier users
  const freeUsers = await db.user.findMany({
    where: { tier: "free" },
    select: { id: true },
  });

  const freeUserIds = new Set(freeUsers.map((u) => u.id));

  // Find expired sessions created by free-tier users
  const expiredSessions = await db.session.findMany({
    where: {
      creatorUserId: { in: [...freeUserIds] },
      createdAt: { lt: cutoff },
    },
    select: { id: true },
  });

  const sessionIds = expiredSessions.map((s) => s.id);

  if (sessionIds.length === 0) {
    console.log("No sessions to clean up.");
    return { deleted: 0 };
  }

  await db.$transaction([
    db.sectionComment.deleteMany({ where: { sessionId: { in: sessionIds } } }),
    db.sectionReaction.deleteMany({ where: { sessionId: { in: sessionIds } } }),
    db.feedbackRating.deleteMany({ where: { sessionId: { in: sessionIds } } }),
    db.analysisEvent.deleteMany({ where: { sessionId: { in: sessionIds } } }),
    db.analysisResult.deleteMany({ where: { sessionId: { in: sessionIds } } }),
    db.shareLink.deleteMany({ where: { sessionId: { in: sessionIds } } }),
    db.moderationFlag.deleteMany({ where: { sessionId: { in: sessionIds } } }),
    db.redactionLog.deleteMany({ where: { sessionId: { in: sessionIds } } }),
    db.positionSnapshot.deleteMany({ where: { sessionId: { in: sessionIds } } }),
    db.promptLog.deleteMany({ where: { sessionId: { in: sessionIds } } }),
    db.emailInvitation.deleteMany({ where: { sessionId: { in: sessionIds } } }),
    db.notificationEmail.deleteMany({ where: { sessionId: { in: sessionIds } } }),
    db.sessionParticipant.deleteMany({ where: { sessionId: { in: sessionIds } } }),
    db.session.deleteMany({ where: { id: { in: sessionIds } } }),
  ]);

  console.log(`Retention cleanup: deleted ${sessionIds.length} expired free-tier sessions.`);
  return { deleted: sessionIds.length };
}

// Run if executed directly
if (
  process.argv[1]?.endsWith("retentionJob.js") ||
  process.argv[1]?.endsWith("retentionJob.ts") ||
  process.argv[1]?.endsWith("retention-job.mjs")
) {
  runRetentionCleanup()
    .then((result) => {
      console.log("Done:", result);
      process.exit(0);
    })
    .catch((err) => {
      console.error("Retention job failed:", err);
      process.exit(1);
    });
}
