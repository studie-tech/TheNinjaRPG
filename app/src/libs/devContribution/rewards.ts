// Reward payout for verified dev contributions.
//
// PlanetScale has no transactions, so the daily rewarded-job cap is enforced
// with a compare-and-swap on the profile row rather than by reading a count and
// trusting it: `rowsAffected === 1` is the only proof that this call — and not a
// concurrent one — consumed the slot. Both the tRPC completion path and the
// maintenance cron's deferred verification go through here so the cap holds
// across them.

import { and, eq, sql } from "drizzle-orm";
import {
  CONTRIBUTION_MAX_REWARDED_JOBS_PER_DAY,
  CONTRIBUTION_REWARDS,
  type ContributionJobType,
} from "@/drizzle/constants";
import { devContributionProfile, devJob, userData } from "@/drizzle/schema";
import { postProcessRewards } from "@/libs/quest";
import { updateRewards } from "@/server/api/routers/quests";
import type { DrizzleClient } from "@/server/db";
import { ObjectiveReward } from "@/validators/rewards";

export interface ContributionReward {
  money: number;
  exp: number;
  reputation: number;
}

/**
 * Atomically consume one of the user's daily rewarded-job slots.
 *
 * The counter is stored on the profile (rather than the per-agent usage ledger)
 * because the cap is per user per day across all agents, and a single row is
 * what makes the guard atomic. The date column doubles as the reset: on a new
 * UTC day the count restarts at 1 regardless of yesterday's value.
 */
export const consumeRewardSlot = async (
  client: DrizzleClient,
  userId: string,
  today: string,
): Promise<boolean> => {
  const result = await client.execute(buildConsumeRewardSlotSql(userId, today));
  // The planetscale driver reports affected rows on the result envelope.
  return (result as unknown as { rowsAffected?: number }).rowsAffected === 1;
};

/**
 * The compare-and-swap statement, built as raw SQL on purpose.
 *
 * MySQL evaluates SET assignments left to right and later ones observe values
 * already assigned in the same statement, so `rewardedJobsToday` must be
 * computed while `rewardedJobsDate` still holds the OLD day — otherwise the
 * first payout of a new day increments yesterday's count instead of resetting
 * to 1, and the cap carries over.
 *
 * Drizzle's `.set({...})` cannot express this: it emits columns in table
 * declaration order, not object order. Hence the explicit statement (and the
 * test that pins the order).
 */
export const buildConsumeRewardSlotSql = (userId: string, today: string) =>
  sql`UPDATE DevContributionProfile
      SET rewardedJobsToday = IF(rewardedJobsDate = ${today}, rewardedJobsToday + 1, 1),
          rewardedJobsDate = ${today},
          updatedAt = NOW(3)
      WHERE userId = ${userId}
        AND (rewardedJobsDate IS NULL
             OR rewardedJobsDate <> ${today}
             OR rewardedJobsToday < ${CONTRIBUTION_MAX_REWARDED_JOBS_PER_DAY})`;

/** Give back a slot consumed for a payout that then could not be completed. */
export const releaseRewardSlot = async (
  client: DrizzleClient,
  userId: string,
  today: string,
): Promise<void> => {
  await client
    .update(devContributionProfile)
    .set({
      rewardedJobsToday: sql`GREATEST(${devContributionProfile.rewardedJobsToday} - 1, 0)`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(devContributionProfile.userId, userId),
        eq(devContributionProfile.rewardedJobsDate, today),
      ),
    );
};

/**
 * Mark a job as rewarded and pay the contributor.
 *
 * The `rewardGranted = false` predicate is what makes this idempotent: only the
 * caller whose UPDATE actually flipped the flag pays out, so a retry or a race
 * cannot double-grant. Returns the reward when it was paid, else null.
 */
export const grantContributionReward = async (params: {
  client: DrizzleClient;
  userId: string;
  jobId: number;
  jobType: ContributionJobType;
  today: string;
}): Promise<ContributionReward | null> => {
  const { client, userId, jobId, jobType, today } = params;

  const user = await client
    .select()
    .from(userData)
    .where(eq(userData.userId, userId))
    .then((rows) => rows[0]);
  // Without the user row there is nothing to credit; leave the job unrewarded so
  // it is not silently marked as paid.
  if (!user) return null;

  const slot = await consumeRewardSlot(client, userId, today);
  if (!slot) return null;

  // Claim the payout for this job. Losing this CAS means another request already
  // paid it, so hand the slot back.
  const claimed = await client
    .update(devJob)
    .set({ rewardGranted: true, updatedAt: new Date() })
    .where(and(eq(devJob.id, jobId), eq(devJob.rewardGranted, false)));
  if (claimed.rowsAffected !== 1) {
    await releaseRewardSlot(client, userId, today);
    return null;
  }

  const reward = CONTRIBUTION_REWARDS[jobType];
  await updateRewards({
    client,
    user,
    reason: `DEV_CONTRIBUTION_${jobType}`,
    rewards: postProcessRewards({
      ...ObjectiveReward.parse({}),
      reward_money: reward.money,
      reward_exp: reward.exp,
      reward_reputation: reward.reputation,
    }),
  });

  return reward;
};

export const describeReward = (reward: ContributionReward): string =>
  `${reward.money} money, ${reward.exp} exp, ${reward.reputation} reputation`;
