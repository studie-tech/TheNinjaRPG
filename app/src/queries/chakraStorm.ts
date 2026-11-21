/**
 * Database access for Chakra Storm; authorization and replay stay in callers.
 */
import { and, desc, eq, gt, gte, isNull, lt, notExists, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { nanoid } from "nanoid";
import {
  chakraStormClaimReceipt,
  chakraStormProgress,
  userData,
} from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";

/** Build the caller's intel, Training Hall levels, region records and active run. */
export const findChakraStormProgress = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
) =>
  client.query.chakraStormProgress.findFirst({
    where: eq(chakraStormProgress.userId, ctx.userId),
  });

/** Build the claimant's level and village, which the daily scouting report pays by. */
export const findChakraStormClaimant = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
) =>
  client.query.userData.findFirst({
    columns: { level: true, villageId: true },
    where: eq(userData.userId, ctx.userId),
  });

/**
 * Build the start of a run: the nonce becomes the caller's only claimable run, creating
 * the progress row on a first run.
 */
export const upsertChakraStormProgressForStartRun = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  nonce: string,
) =>
  client
    .insert(chakraStormProgress)
    .values({ userId: ctx.userId, training: {}, stages: {}, activeRun: nonce })
    .onDuplicateKeyUpdate({ set: { activeRun: nonce } });

/**
 * Build the payout of a verified claim: intel added in SQL, the region records the caller
 * computed from its snapshot, and the run retired. It applies only while the run is still
 * the caller's active one, so each run pays out once.
 */
export const updateChakraStormProgressForClaimRun = (
  client: Pick<DrizzleClient, "update">,
  ctx: { userId: string },
  claim: {
    nonce: string;
    intel: number;
    stages: (typeof chakraStormProgress.$inferSelect)["stages"];
  },
) =>
  client
    .update(chakraStormProgress)
    .set({
      intel: sql`${chakraStormProgress.intel} + ${claim.intel}`,
      stages: claim.stages,
      activeRun: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(chakraStormProgress.userId, ctx.userId),
        eq(chakraStormProgress.activeRun, claim.nonce),
      ),
    );

/** Build a Training Hall purchase: intel spent, guarded on the balance covering it. */
export const updateChakraStormProgressForTrain = (
  client: Pick<DrizzleClient, "update">,
  ctx: { userId: string },
  purchase: {
    cost: number;
    training: (typeof chakraStormProgress.$inferSelect)["training"];
  },
) =>
  client
    .update(chakraStormProgress)
    .set({
      intel: sql`${chakraStormProgress.intel} - ${purchase.cost}`,
      training: purchase.training,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(chakraStormProgress.userId, ctx.userId),
        gte(chakraStormProgress.intel, purchase.cost),
      ),
    );

/**
 * Build the daily scouting report payout, guarded on the last payout falling before
 * `dayStart`, so it pays at most once per UTC day.
 */
export const updateUserDataForChakraStormDuty = (
  client: Pick<DrizzleClient, "update">,
  ctx: { userId: string },
  duty: { ryo: number; prestige: number; paidAt: Date; dayStart: Date },
) =>
  client
    .update(userData)
    .set({
      money: sql`${userData.money} + ${duty.ryo}`,
      villagePrestige: sql`${userData.villagePrestige} + ${duty.prestige}`,
      chakraStormDutyAt: duty.paidAt,
    })
    .where(
      and(
        eq(userData.userId, ctx.userId),
        or(
          isNull(userData.chakraStormDutyAt),
          lt(userData.chakraStormDutyAt, duty.dayStart),
        ),
      ),
    );

/** Build the receipt lookup that answers a repeated claim without replaying it. */
export const findChakraStormClaimReceipt = (
  client: Pick<DrizzleClient, "query">,
  claimKey: string,
) =>
  client.query.chakraStormClaimReceipt.findFirst({
    where: eq(chakraStormClaimReceipt.claimKey, claimKey),
  });

/** Build the claim receipt that answers a claim retried after its response was lost. */
export const insertChakraStormClaimReceipt = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  claim: {
    claimKey: string;
    stage: string;
    seconds: number;
    kills: number;
    level: number;
    won: boolean;
    intel: number;
  },
) =>
  client.insert(chakraStormClaimReceipt).values({
    id: nanoid(),
    claimKey: claim.claimKey,
    userId: ctx.userId,
    stage: claim.stage,
    seconds: claim.seconds,
    kills: claim.kills,
    level: claim.level,
    won: claim.won,
    intelEarned: claim.intel,
  });

/**
 * Build the Undercover leaderboard since `since`: each player's best verified run,
 * longest first, then most raiders defeated, then the earliest to set it.
 */
export const listChakraStormReceiptForGetLeaderboard = (
  client: Pick<DrizzleClient, "query" | "select">,
  input: { limit: number; stage: string; since: Date },
) => {
  const better = alias(chakraStormClaimReceipt, "betterReceipt");
  return client.query.chakraStormClaimReceipt.findMany({
    columns: { id: true, seconds: true, kills: true, level: true, createdAt: true },
    where: (receipt) =>
      and(
        eq(receipt.stage, input.stage),
        gte(receipt.createdAt, input.since),
        notExists(
          client
            .select({ id: better.id })
            .from(better)
            .where(
              and(
                eq(better.userId, receipt.userId),
                eq(better.stage, input.stage),
                gte(better.createdAt, input.since),
                or(
                  gt(better.seconds, receipt.seconds),
                  and(
                    eq(better.seconds, receipt.seconds),
                    gt(better.kills, receipt.kills),
                  ),
                  and(
                    eq(better.seconds, receipt.seconds),
                    eq(better.kills, receipt.kills),
                    or(
                      lt(better.createdAt, receipt.createdAt),
                      and(
                        eq(better.createdAt, receipt.createdAt),
                        lt(better.id, receipt.id),
                      ),
                    ),
                  ),
                ),
              ),
            ),
        ),
      ),
    orderBy: [
      desc(chakraStormClaimReceipt.seconds),
      desc(chakraStormClaimReceipt.kills),
    ],
    limit: input.limit,
    with: { user: { columns: { username: true, avatar: true, rank: true } } },
  });
};
