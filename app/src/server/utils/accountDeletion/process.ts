import * as Sentry from "@sentry/nextjs";
import { and, eq, isNull, lte, ne, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { accountDeletion } from "@/drizzle/schema";
import { drizzleDB } from "@/server/db";
import { removeAccountGameData } from "@/server/utils/accountDeletion/cleanup";
import { removeAccountIdentity } from "@/server/utils/accountDeletion/identity";
import { runDeletionStep } from "@/server/utils/accountDeletion/worker";
import { secondsFromNow } from "@/utils/time";

/** Shared by the post-response kick-off and the cleaner. Leases arbitrate both callers. */
export const processAccountDeletions = async (userId?: string) => {
  try {
    return await processDueDeletions(userId);
  } catch (error) {
    // A database outage must not undo acceptance of an already durable request.
    // The next cleaner invocation can retry once the database is available.
    Sentry.captureException(error, { tags: { task: "account-deletion" } });
    return { processed: 0, failed: 1 };
  }
};

const processDueDeletions = async (userId?: string) => {
  const now = new Date();
  const jobs = await drizzleDB.query.accountDeletion.findMany({
    where: and(
      userId ? eq(accountDeletion.userId, userId) : undefined,
      ne(accountDeletion.phase, "COMPLETE"),
      lte(accountDeletion.nextAttemptAt, now),
      or(isNull(accountDeletion.leaseUntil), lte(accountDeletion.leaseUntil, now)),
    ),
    orderBy: [accountDeletion.nextAttemptAt, accountDeletion.userId],
    limit: userId ? 1 : 3,
  });
  let processed = 0;
  let failed = 0;
  for (const job of jobs) {
    const leaseId = nanoid();
    const claim = await drizzleDB
      .update(accountDeletion)
      .set({
        leaseId,
        leaseUntil: secondsFromNow(600),
        attempts: sql`${accountDeletion.attempts} + 1`,
      })
      .where(
        and(
          eq(accountDeletion.userId, job.userId),
          eq(accountDeletion.phase, job.phase),
          lte(accountDeletion.nextAttemptAt, now),
          or(isNull(accountDeletion.leaseUntil), lte(accountDeletion.leaseUntil, now)),
        ),
      );
    if (claim.rowsAffected !== 1) continue;
    const ownedLease = and(
      eq(accountDeletion.userId, job.userId),
      eq(accountDeletion.leaseId, leaseId),
    );
    try {
      await runDeletionStep({
        phase: job.phase,
        removeIdentity: () =>
          removeAccountIdentity(job.userId, job.appleRevokedSubject),
        removeGameData: () => removeAccountGameData(job.userId),
        advance: async (phase, delayMs) => {
          const changed = await drizzleDB
            .update(accountDeletion)
            .set({
              phase,
              nextAttemptAt: secondsFromNow(delayMs / 1000),
              completedAt: phase === "COMPLETE" ? new Date() : null,
              appleRevokedSubject:
                phase === "COMPLETE" ? null : job.appleRevokedSubject,
              leaseId: null,
              leaseUntil: null,
            })
            .where(ownedLease);
          if (changed.rowsAffected !== 1)
            throw new Error("Account deletion lease lost");
        },
      });
      processed++;
    } catch (error) {
      failed++;
      Sentry.captureException(error, {
        tags: { task: "account-deletion" },
        extra: { userId: job.userId, phase: job.phase },
      });
      await drizzleDB
        .update(accountDeletion)
        .set({ nextAttemptAt: secondsFromNow(3600), leaseId: null, leaseUntil: null })
        .where(ownedLease);
    }
  }
  return { processed, failed };
};
