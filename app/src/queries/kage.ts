/**
 * Database access for kage; authorization and transaction scopes stay in callers.
 */

import { randomInt } from "node:crypto";
import { and, desc, eq, exists, gte, isNull, ne, or, type SQL, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  ELDER_KAGE_REMOVAL_VOTE_DAYS,
  KAGE_DEFAULT_PRESTIGE,
  KAGE_PRESTIGE_REQUIREMENT,
  TERR_BOT_ID,
} from "@/drizzle/constants";
import {
  actionLog,
  type Clan,
  clan,
  notification,
  userData,
  village,
  villageElderVote,
  villageStructure,
} from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
import { secondsFromNow } from "@/utils/time";

/**
 * Fetches the elders from the user data table based on the provided village ID.
 * @param client - The DrizzleClient instance used for querying the database.
 * @param villageId - The ID of the village to fetch elders from.
 * @returns A Promise that resolves to an array of elder user data objects.
 */
export const fetchElders = async (client: DrizzleClient, villageId: string) => {
  return await client.query.userData.findMany({
    columns: {
      username: true,
      userId: true,
      villageId: true,
      avatar: true,
      level: true,
      rank: true,
      isOutlaw: true,
      updatedAt: true,
    },
    where: and(
      eq(userData.villageId, villageId),
      eq(userData.rank, "ELDER"),
      eq(userData.isAi, false),
    ),
  });
};

/**
 * Fetches a kage replacement from the user data table based on the provided village ID and current kage ID.
 * @param client - The DrizzleClient instance used for querying the database.
 * @param villageId - The ID of the village to fetch a replacement from.
 * @param currentKageId - The ID of the current kage.
 * @returns A Promise that resolves to a user data object representing the replacement kage.
 */
export const fetchKageReplacement = async (
  client: DrizzleClient,
  villageId: string,
  currentKageId: string,
) => {
  const elders = await client.query.userData.findMany({
    where: and(
      eq(userData.villageId, villageId),
      eq(userData.rank, "ELDER"),
      ne(userData.userId, currentKageId),
      isNull(userData.anbuId),
      or(
        gte(userData.villagePrestige, KAGE_PRESTIGE_REQUIREMENT),
        eq(userData.isAi, true),
      ),
    ),
  });
  const userElders = elders.filter((e) => !e.isAi);
  if (userElders.length > 0) {
    return userElders[randomInt(userElders.length)];
  }
  if (elders.length === 0) return undefined;
  return elders[randomInt(elders.length)];
};

/** Build the `village` update for `resignKage`, using predicates on `id`. */
export const updateVillageForResignKage = (
  client: Pick<DrizzleClient, "update">,
  elder: { userId: string },
  user: { villageId: string },
  leaderUpdatedAt = new Date(),
) =>
  client
    .update(village)
    .set({ kageId: elder.userId, leaderUpdatedAt, kageSchedule: null })
    .where(eq(village.id, user.villageId));

/**
 * Build the `actionLog` listing for `sendKagePrestige`, selecting only `relatedValue`,
 * using predicates on `userId`, `relatedId`, `createdAt`.
 */
export const listActionLogForSendKagePrestige = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
  input: { kageId: string },
) =>
  client.query.actionLog.findMany({
    columns: { relatedValue: true },
    where: and(
      eq(actionLog.userId, ctx.userId),
      eq(actionLog.relatedId, input.kageId),
      gte(actionLog.createdAt, sql`NOW() - INTERVAL 1 WEEK`),
    ),
  });

/** Build the `userData` update for `sendKagePrestige`, setting `villagePrestige`, using predicates on `userId`. */
export const updateUserDataForSendKagePrestige = (
  client: Pick<DrizzleClient, "update">,
  input: { amount: number },
  ctx: { userId: string },
) =>
  client
    .update(userData)
    .set({
      villagePrestige: sql`${userData.villagePrestige} - ${input.amount}`,
    })
    .where(eq(userData.userId, ctx.userId));

/** Build the `actionLog` insert for `sendKagePrestige`. */
export const insertActionLogForSendKagePrestige = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  input: { amount: number; kageId: string },
  kage: { username: string },
  user: { avatarLight: null | string },
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "user",
    changes: [`${input.amount} prestige sent to ${kage.username}`],
    relatedId: input.kageId,
    relatedMsg: `Sent ${input.amount} prestige to ${kage.username}`,
    relatedImage: user.avatarLight,
    relatedValue: input.amount,
  });

/** Build the `village` update for `takeKage`, using predicates on `id`. */
export const updateVillageForTakeKage = (
  client: Pick<DrizzleClient, "update">,
  user: { userId: string; villageId: null | string },
) =>
  client
    .update(village)
    .set({ kageId: user.userId, leaderUpdatedAt: new Date(), kageSchedule: null })
    .where(eq(village.id, user.villageId ?? ""));

/** Build the `userData` update for `takeKage`, setting `rank` and `villagePrestige`, using predicates on `userId`. */
export const updateUserDataForTakeKage = (
  client: Pick<DrizzleClient, "update">,
  user: { villagePrestige: number; userId: string },
) =>
  client
    .update(userData)
    .set({
      rank: sql`CASE WHEN ${userData.rank} = 'ELDER' THEN 'JONIN' ELSE ${userData.rank} END`,
      villagePrestige:
        user.villagePrestige > KAGE_DEFAULT_PRESTIGE
          ? user.villagePrestige
          : KAGE_DEFAULT_PRESTIGE,
    })
    .where(eq(userData.userId, user.userId));

/** Build the `actionLog` insert for `takeKage`. */
export const insertActionLogForTakeKage = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  user: { userId: string; village: { name: string; kageId: string } },
  input: { reason: string },
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "user",
    relatedId: user.userId,
    relatedMsg: `Staff took kage position in ${user?.village?.name || "Unknown Village"}`,
    changes: [`Previous KageId: ${user?.village?.kageId}`, `Reason: ${input.reason}`],
  });

/** Build the `userData` selection for `upgradeStructure`, including predicates on `userId`, `villageId`, `id`. */
export const selectUserDataForUpgradeStructure = (
  client: Pick<DrizzleClient, "select">,
  ctx: { userId: string },
  fundingClan: Pick<Clan, "id"> | null | undefined,
) =>
  client
    .select({ userId: userData.userId })
    .from(userData)
    .where(
      and(
        eq(userData.userId, ctx.userId),
        eq(userData.villageId, village.id),
        eq(userData.isBanned, false),
        fundingClan ? eq(userData.clanId, fundingClan.id) : undefined,
      ),
    );

/** Execute the database statement for `upgradeStructure`. */
export const executeResultForUpgradeStructure = (
  client: Pick<DrizzleClient, "execute">,
  fundingClan: Pick<Clan, "id"> | null | undefined,
  balance:
    | typeof import("@/drizzle/schema").clan["points"]
    | typeof import("@/drizzle/schema").village["tokens"],
  total: number,
  structure: { level: number },
  guards: undefined | SQL<unknown>,
) =>
  client.execute(sql`
          UPDATE ${villageStructure}
          INNER JOIN ${village} ON ${village.id} = ${villageStructure.villageId}
          ${fundingClan ? sql`INNER JOIN ${clan} ON ${clan.id} = ${fundingClan.id}` : sql``}
          SET ${balance} = ${balance} - ${total},
              ${villageStructure.level} = ${structure.level + 1},
              ${villageStructure.lastUpgradedAt} = ${new Date()}
          WHERE ${guards}
        `);

/**
 * Build the `village` update for `payStructureMaintenance`, setting `tokens` and
 * `structureMaintenanceDue`, including predicates on `id`, `type`, `kageId`.
 */
export const updateVillageForPayStructureMaintenance = (
  client: Pick<DrizzleClient, "update" | "select">,
  input: { villageId: string },
  ctx: { userId: string },
) =>
  client
    .update(village)
    .set({
      tokens: sql`${village.tokens} - ${village.structureMaintenanceDue}`,
      structureMaintenanceDue: 0,
    })
    .where(
      and(
        eq(village.id, input.villageId),
        eq(village.type, "VILLAGE"),
        eq(village.kageId, ctx.userId),
        sql`${village.structureMaintenanceDue} > 0`,
        gte(village.tokens, village.structureMaintenanceDue),
        exists(
          client
            .select({ userId: userData.userId })
            .from(userData)
            .where(
              and(
                eq(userData.userId, ctx.userId),
                eq(userData.villageId, village.id),
                eq(userData.isBanned, false),
              ),
            ),
        ),
      ),
    );

/** Build the `userData` listing, selecting only `userId`, including predicates on `villageId`, `rank`, `isAi`. */
export const listEligibleKageRemovalElders = (
  client: Pick<DrizzleClient, "query">,
  input: { villageId: string },
) =>
  client.query.userData.findMany({
    columns: { userId: true },
    where: and(
      eq(userData.villageId, input.villageId),
      eq(userData.rank, "ELDER"),
      eq(userData.isAi, false),
      eq(userData.isBanned, false),
    ),
  });

/** Build the `villageElderVote` listing for `initiateKageRemovalVote`, using predicates on `villageId`, `type`, `status`. */
export const listVillageElderVoteForInitiateKageRemovalVote = (
  client: Pick<DrizzleClient, "query">,
  input: { villageId: string },
) =>
  client.query.villageElderVote.findMany({
    where: and(
      eq(villageElderVote.villageId, input.villageId),
      eq(villageElderVote.type, "KAGE_REMOVAL"),
      eq(villageElderVote.status, "REJECTED"),
    ),
    orderBy: [desc(villageElderVote.resolvedAt)],
    limit: 1,
  });

/** Build the `villageElderVote` insert for `initiateKageRemovalVote`, updating duplicate keys. */
export const insertVillageElderVoteForInitiateKageRemovalVote = (
  client: Pick<DrizzleClient, "insert">,
  v: { id: string; kageId: string; leaderUpdatedAt: Date },
  ctx: { userId: string },
  input: { reason: string },
) =>
  client
    .insert(villageElderVote)
    .values({
      id: nanoid(),
      villageId: v.id,
      type: "KAGE_REMOVAL",
      initiatedByUserId: ctx.userId,
      targetId: v.kageId,
      tenure: v.leaderUpdatedAt,
      reason: input.reason,
      endsAt: secondsFromNow(ELDER_KAGE_REMOVAL_VOTE_DAYS * 86400),
    })
    .onDuplicateKeyUpdate({ set: { id: sql`id` } });

/** Build the `notification` insert for `initiateKageRemovalVote`. */
export const insertNotificationForInitiateKageRemovalVote = (
  client: Pick<DrizzleClient, "insert">,
  user: { userId: string; username: string },
  v: { name: string },
  input: { reason: string },
) =>
  client.insert(notification).values({
    userId: user.userId,
    content: `${user.username} proposed removing the ${v.name} Kage: ${input.reason} Vote at Town Hall.`,
  });

/** Build the `villageElderVote` listing for `getRemovalHistory`, using predicates on `villageId` and `type`. */
export const listVillageElderVoteForGetRemovalHistory = (
  client: Pick<DrizzleClient, "query">,
  input: { villageId: string },
) =>
  client.query.villageElderVote.findMany({
    where: and(
      eq(villageElderVote.villageId, input.villageId),
      eq(villageElderVote.type, "KAGE_REMOVAL"),
    ),
    with: { entries: true },
    orderBy: [desc(villageElderVote.createdAt)],
    limit: 20,
  });

/** Build the `villageElderVote` lookup for `nominateKage`, including predicates on `id`, `villageId`, `type`. */
export const findVillageElderVoteForNominateKage = (
  client: Pick<DrizzleClient, "query">,
  input: { voteId?: undefined | string; villageId: string },
  hall: {
    village: { leaderUpdatedAt: Date };
    state: { vacancy?: { removedUserId: undefined | string } | undefined };
  },
) =>
  client.query.villageElderVote.findFirst({
    where: input.voteId
      ? eq(villageElderVote.id, input.voteId)
      : and(
          eq(villageElderVote.villageId, input.villageId),
          eq(villageElderVote.type, "KAGE_REMOVAL"),
          eq(villageElderVote.status, "APPROVED"),
          eq(villageElderVote.resolvedAt, hall.village.leaderUpdatedAt),
          eq(villageElderVote.targetId, hall.state.vacancy?.removedUserId ?? ""),
        ),
  });

/**
 * Build the `villageElderVote` update for `nominateKage`, setting `successorId`, using
 * predicates on `id` and `successorId`.
 */
export const updateVillageElderVoteForNominateKage = (
  client: Pick<DrizzleClient, "update">,
  candidate: { userId: string },
  motion: { id: string },
) =>
  client
    .update(villageElderVote)
    .set({ successorId: candidate.userId })
    .where(
      and(eq(villageElderVote.id, motion.id), isNull(villageElderVote.successorId)),
    );

/** Build the `userData` update, setting `rank`, using predicates on `userId`. */
export const setKageCandidateToJonin = (
  client: Pick<DrizzleClient, "update">,
  candidate: { userId: string },
) =>
  client
    .update(userData)
    .set({ rank: "JONIN" })
    .where(eq(userData.userId, candidate.userId));

/** Build the `villageElderVote` lookup for `settleKageRemoval`, using predicates on `id`. */
export const findVillageElderVoteForSettleKageRemoval = (
  client: Pick<DrizzleClient, "query">,
  voteId: string,
) =>
  client.query.villageElderVote.findFirst({
    where: eq(villageElderVote.id, voteId),
  });

/** Build a Kage removal vote lookup including its ballots; execution stays with the caller. */
export const findKageRemovalVoteById = (
  client: Pick<DrizzleClient, "query">,
  voteId: string,
) =>
  client.query.villageElderVote.findFirst({
    where: eq(villageElderVote.id, voteId),
    with: { entries: true },
  });

/**
 * Build the `villageElderVote` update for `settleKageRemoval`, setting `status` and
 * `resolvedAt`, using predicates on `id` and `status`.
 */
export const updateVillageElderVoteForSettleKageRemoval = (
  client: Pick<DrizzleClient, "update">,
  outcome: "REJECTED" | "APPROVED",
  now: Date,
  voteId: string,
) =>
  client
    .update(villageElderVote)
    .set({ status: outcome, resolvedAt: now })
    .where(
      and(eq(villageElderVote.id, voteId), eq(villageElderVote.status, "PENDING")),
    );

/** Build the `village` update for `settleKageRemoval`, using predicates on `id`. */
export const updateVillageForSettleKageRemoval2 = (
  client: Pick<DrizzleClient, "update">,
  now: Date,
  motion: { targetId: string; reason: string },
  v: { id: string },
) =>
  client
    .update(village)
    .set({
      kageId: "",
      leaderUpdatedAt: now,
      kageSchedule: {
        kageId: "",
        tenure: now.toISOString(),
        windows: [],
        publishedAt: null,
        missedStarts: 0,
        paused: false,
        observedAt: now.toISOString(),
        vacancy: {
          removedUserId: motion.targetId,
          reason: motion.reason || "Removed by elder majority vote",
        },
      },
    })
    .where(eq(village.id, v.id));

/** Build the `notification` insert for `settleKageRemoval`. */
export const insertNotificationForSettleKageRemoval = (
  client: Pick<DrizzleClient, "insert">,
  outcome: "REJECTED" | "APPROVED",
  v: { name: undefined | string } | undefined,
) =>
  client.insert(notification).values({
    userId: TERR_BOT_ID,
    content:
      outcome === "APPROVED"
        ? `The ${v?.name ?? "village"} Elder Council removed the Kage. Village prestige is retained. Elders may nominate an eligible villager at Town Hall.`
        : `The ${v?.name ?? "village"} Kage removal vote did not pass. The result and reason are published at Town Hall.`,
  });
