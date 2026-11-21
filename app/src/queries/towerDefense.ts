/**
 * Database access for tower defense; authorization and replay stay in callers.
 */
import {
  and,
  desc,
  eq,
  exists,
  gt,
  gte,
  inArray,
  isNull,
  lt,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { nanoid } from "nanoid";
import {
  aiSpriteAnimation,
  towerDefenseClaimReceipt,
  towerDefenseRun,
  userData,
  userTowerDefenseUpgrade,
} from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";

/** Build the monthly leaderboard reset. */
export const deleteTowerDefenseRunForGET = (client: Pick<DrizzleClient, "delete">) =>
  client.delete(towerDefenseRun);

/** Build the caller's Guard Hall levels. */
export const listUserTowerDefenseUpgrades = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
) =>
  client.query.userTowerDefenseUpgrade.findMany({
    columns: { upgradeId: true, level: true },
    where: eq(userTowerDefenseUpgrade.userId, ctx.userId),
  });

/** Build the caller's scroll balance, best wave and character level. */
export const findTowerDefenseProgress = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
) =>
  client.query.userData.findFirst({
    columns: { towerDefensePoints: true, towerDefenseBestWave: true, level: true },
    where: eq(userData.userId, ctx.userId),
  });

/** Build the run nonce that `startRun` makes the caller's only claimable run. */
export const updateUserDataForStartTowerDefenseRun = (
  client: Pick<DrizzleClient, "update">,
  ctx: { userId: string },
  nonce: string,
) =>
  client
    .update(userData)
    .set({ towerDefenseActiveRun: nonce })
    .where(eq(userData.userId, ctx.userId));

/** Build the claimant's active run, level and village. */
export const findTowerDefenseClaimant = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
) =>
  client.query.userData.findFirst({
    columns: {
      towerDefenseActiveRun: true,
      level: true,
      villageId: true,
    },
    where: eq(userData.userId, ctx.userId),
  });

/** Build the scroll deduction for a Guard Hall purchase, guarded on the balance. */
export const updateUserDataForPurchaseDojoUpgrade = (
  client: Pick<DrizzleClient, "update">,
  cost: number,
  ctx: { userId: string },
) =>
  client
    .update(userData)
    .set({ towerDefensePoints: sql`${userData.towerDefensePoints} - ${cost}` })
    .where(
      and(eq(userData.userId, ctx.userId), gte(userData.towerDefensePoints, cost)),
    );

/** Build the Guard Hall level upsert after a purchase. */
export const upsertUserTowerDefenseUpgrade = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  upgradeId: string,
  level: number,
) =>
  client
    .insert(userTowerDefenseUpgrade)
    .values({ id: nanoid(), userId: ctx.userId, upgradeId, level })
    .onDuplicateKeyUpdate({ set: { level } });

/** Build the receipt lookup that answers a repeated claim without replaying it. */
export const findTowerDefenseClaimReceipt = (
  client: Pick<DrizzleClient, "query">,
  claimKey: string,
) =>
  client.query.towerDefenseClaimReceipt.findFirst({
    columns: { wave: true, score: true, pointsEarned: true },
    where: eq(towerDefenseClaimReceipt.claimKey, claimKey),
  });

/** Build the claim receipt that answers a claim retried after its response was lost. */
export const insertTowerDefenseClaimReceipt = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  claim: { claimKey: string; wave: number; kills: number; points: number },
) =>
  client.insert(towerDefenseClaimReceipt).values({
    id: nanoid(),
    claimKey: claim.claimKey,
    userId: ctx.userId,
    wave: claim.wave,
    score: claim.kills,
    pointsEarned: claim.points,
  });

/**
 * Build the payout of a verified claim: scrolls and a best wave that only rises. It
 * applies only while the run is still the caller's active one and retires it, so each
 * run pays out once.
 */
export const updateUserDataForClaimTowerDefenseRun = (
  client: Pick<DrizzleClient, "update">,
  ctx: { userId: string },
  claim: { nonce: string; points: number; wave: number },
) =>
  client
    .update(userData)
    .set({
      towerDefensePoints: sql`${userData.towerDefensePoints} + ${claim.points}`,
      towerDefenseBestWave: sql`GREATEST(${userData.towerDefenseBestWave}, ${claim.wave})`,
      towerDefenseActiveRun: null,
    })
    .where(
      and(
        eq(userData.userId, ctx.userId),
        eq(userData.towerDefenseActiveRun, claim.nonce),
      ),
    );

/**
 * Build the retirement of a settled quest challenge run, which pays no scrolls and leaves
 * the best wave alone, guarded on the run still being the claimant's latest.
 */
export const updateUserDataForSettleTowerDefenseChallenge = (
  client: Pick<DrizzleClient, "update">,
  ctx: { userId: string },
  nonce: string,
) =>
  client
    .update(userData)
    .set({ towerDefenseActiveRun: null })
    .where(
      and(eq(userData.userId, ctx.userId), eq(userData.towerDefenseActiveRun, nonce)),
    );

/**
 * Build the daily Guard Hall duty payout, guarded on the last payout falling before
 * `dayStart`, so it pays at most once per UTC day.
 */
export const updateUserDataForTowerDefenseDuty = (
  client: Pick<DrizzleClient, "update">,
  ctx: { userId: string },
  duty: { ryo: number; prestige: number; paidAt: Date; dayStart: Date },
) =>
  client
    .update(userData)
    .set({
      money: sql`${userData.money} + ${duty.ryo}`,
      villagePrestige: sql`${userData.villagePrestige} + ${duty.prestige}`,
      towerDefenseDutyAt: duty.paidAt,
    })
    .where(
      and(
        eq(userData.userId, ctx.userId),
        or(
          isNull(userData.towerDefenseDutyAt),
          lt(userData.towerDefenseDutyAt, duty.dayStart),
        ),
      ),
    );

/** Build the leaderboard entry for a verified claim. */
export const insertTowerDefenseRun = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  run: {
    seed: string;
    startWave: number;
    wave: number;
    kills: number;
    startedAt: Date;
  },
) =>
  client.insert(towerDefenseRun).values({
    id: nanoid(),
    seed: run.seed,
    userId: ctx.userId,
    startedAt: run.startedAt,
    endedAt: new Date(),
    startWave: run.startWave,
    wave: run.wave,
    score: run.kills,
  });

/**
 * List a caller's runs after an ID cursor using the same timestamp/ID order as the page.
 * The cursor lookup stays in the statement and cannot reference another user's history.
 */
export const listTowerDefenseRunForGetRunHistory = (
  client: Pick<DrizzleClient, "select">,
  ctx: { userId: string },
  input: { cursor?: string; limit: number },
) => {
  const cursorRun = alias(towerDefenseRun, "cursorRun");
  return client
    .select()
    .from(towerDefenseRun)
    .where(
      and(
        eq(towerDefenseRun.userId, ctx.userId),
        input.cursor
          ? exists(
              client
                .select({ id: cursorRun.id })
                .from(cursorRun)
                .where(
                  and(
                    eq(cursorRun.id, input.cursor),
                    eq(cursorRun.userId, ctx.userId),
                    or(
                      lt(towerDefenseRun.startedAt, cursorRun.startedAt),
                      and(
                        eq(towerDefenseRun.startedAt, cursorRun.startedAt),
                        lt(towerDefenseRun.id, cursorRun.id),
                      ),
                    ),
                  ),
                ),
            )
          : undefined,
      ),
    )
    .orderBy(desc(towerDefenseRun.startedAt), desc(towerDefenseRun.id))
    .limit(input.limit + 1);
};

/**
 * Build the leaderboard: each player's best run, highest wave first, then most enemies
 * defeated. A run stays only while the same player has no better one; ties on wave and
 * kills keep the earlier run.
 */
export const listTowerDefenseRunForGetLeaderboard = (
  client: Pick<DrizzleClient, "query" | "select">,
  input: { limit: number },
) => {
  const better = alias(towerDefenseRun, "betterRun");
  return client.query.towerDefenseRun.findMany({
    where: (run) =>
      notExists(
        client
          .select({ id: better.id })
          .from(better)
          .where(
            and(
              eq(better.userId, run.userId),
              or(
                gt(better.wave, run.wave),
                and(eq(better.wave, run.wave), gt(better.score, run.score)),
                and(
                  eq(better.wave, run.wave),
                  eq(better.score, run.score),
                  or(
                    lt(better.startedAt, run.startedAt),
                    and(eq(better.startedAt, run.startedAt), lt(better.id, run.id)),
                  ),
                ),
              ),
            ),
          ),
      ),
    orderBy: [desc(towerDefenseRun.wave), desc(towerDefenseRun.score)],
    limit: input.limit,
    with: {
      user: {
        columns: { username: true, avatar: true, rank: true },
      },
    },
  });
};

/** Sheets the arena draws enemies with. */
const TD_ROSTER_ACTIONS = ["idle", "move"];

/** Build the strongest AI characters with idle or walking sprite sheets. */
export const listTowerDefenseRoster = (
  client: Pick<DrizzleClient, "query" | "select">,
) =>
  client.query.userData.findMany({
    columns: { userId: true, username: true, level: true, avatar: true },
    where: (table) =>
      and(
        eq(table.isAi, true),
        eq(table.isSummon, false),
        exists(
          client
            .select({ id: aiSpriteAnimation.userId })
            .from(aiSpriteAnimation)
            .where(
              and(
                eq(aiSpriteAnimation.userId, table.userId),
                inArray(aiSpriteAnimation.actionKey, TD_ROSTER_ACTIONS),
              ),
            ),
        ),
      ),
    with: {
      spriteAnimationBindings: {
        where: inArray(aiSpriteAnimation.actionKey, TD_ROSTER_ACTIONS),
        with: { animation: true },
      },
    },
    orderBy: (table) => [desc(table.level), table.userId],
    limit: 64,
  });
