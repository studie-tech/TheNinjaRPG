import { timingSafeEqual } from "node:crypto";
import * as Sentry from "@sentry/nextjs";
import { and, eq, isNull, lte, ne, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { NextResponse } from "next/server";
import { accountDeletion } from "@/drizzle/schema";
import { drizzleDB } from "@/server/db";
import { removeAccountGameData } from "@/server/utils/accountDeletion/cleanup";
import { removeAccountIdentity } from "@/server/utils/accountDeletion/identity";
import { runDeletionStep } from "@/server/utils/accountDeletion/worker";
import { secondsFromNow } from "@/utils/time";

export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const actual = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret ?? ""}`);
  if (
    !secret ||
    actual.length !== expected.length ||
    !timingSafeEqual(actual, expected)
  ) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }
  const now = new Date();
  const jobs = await drizzleDB.query.accountDeletion.findMany({
    where: and(
      ne(accountDeletion.phase, "COMPLETE"),
      lte(accountDeletion.nextAttemptAt, now),
      or(isNull(accountDeletion.leaseUntil), lte(accountDeletion.leaseUntil, now)),
    ),
    limit: 3,
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
  return NextResponse.json({ processed, failed }, { status: failed ? 503 : 200 });
}
