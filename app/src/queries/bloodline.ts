/**
 * Database access for bloodline; authorization and transaction scopes stay in callers.
 */
import type { SQL } from "drizzle-orm";
import { and, eq, gt, gte, isNotNull } from "drizzle-orm";
import type { z } from "zod";
import type {
  BloodlineDifficultyRating,
  LetterRank,
  StatType,
} from "@/drizzle/constants";
import { BLOODLINE_SWAP_FREE_DAYS } from "@/drizzle/constants";
import type { Bloodline } from "@/drizzle/schema";
import {
  actionLog,
  bloodline,
  bloodlineReskin,
  bloodlineRolls,
  userItem,
  userSkill,
} from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
import {
  completedQuestHistoryRelation,
  userQuestHistoryRelation,
} from "@/server/utils/achievementObjectives";
import { getUnique } from "@/utils/grouping";
import { DAY_S, secondsFromDate } from "@/utils/time";
import type { baseReskinSchema } from "@/validators/bloodline";

/** Load a reskin and its bloodline by reskin ID; no match yields undefined. */
export const fetchBloodlineReskin = async (client: DrizzleClient, reskinId: string) => {
  return await client.query.bloodlineReskin.findFirst({
    where: eq(bloodlineReskin.id, reskinId),
    with: { bloodline: true },
  });
};

/**
 * Fetch natural bloodline roll of a user
 * @param client Drizzle client
 * @param userId User ID
 * @returns Natural bloodline roll
 */
export const fetchNaturalBloodlineRoll = async (
  client: DrizzleClient,
  userId: string,
) => {
  return await client.query.bloodlineRolls.findFirst({
    where: and(eq(bloodlineRolls.userId, userId), eq(bloodlineRolls.type, "NATURAL")),
    with: { bloodline: true },
  });
};

/**
 * Fetch item bloodline rolls of a user
 * @param client Drizzle client
 * @param userId User ID
 * @returns Item bloodline rolls
 */
export const fetchItemBloodlineRolls = async (
  client: DrizzleClient,
  userId: string,
) => {
  return await client.query.bloodlineRolls.findMany({
    where: and(eq(bloodlineRolls.userId, userId), eq(bloodlineRolls.type, "ITEM")),
    with: { bloodline: true },
  });
};

/**
 * Fetch user's historic bloodlines
 * @param client Drizzle client
 * @param userId User ID
 * @returns User's historic bloodlines
 */
export const fetchUserHistoricBloodlines = async (
  client: DrizzleClient,
  userId: string,
) => {
  // Get all unique bloodlineIds the user has ever rolled
  const userRolls = await client.query.bloodlineRolls.findMany({
    where: and(
      eq(bloodlineRolls.userId, userId),
      isNotNull(bloodlineRolls.bloodlineId),
    ),
    with: { bloodline: { with: { village: true } } },
  });
  const userBloodlines = getUnique(userRolls, "bloodlineId")
    .filter(
      (roll): roll is typeof roll & { bloodline: NonNullable<typeof roll.bloodline> } =>
        !!roll.bloodline,
    )
    .map((roll) => roll.bloodline);
  // Return array of bloodline objects
  return userBloodlines;
};

/**
 * Load this user's bloodline-swap log IDs and timestamps since the rolling
 * BLOODLINE_SWAP_FREE_DAYS cutoff; return an empty array when none match.
 */
export const fetchMonthlyBloodlineSwaps = async (
  client: DrizzleClient,
  userId: string,
) => {
  const results = await client.query.actionLog.findMany({
    where: and(
      eq(actionLog.userId, userId),
      eq(actionLog.tableName, "bloodlineSwap"),
      gte(
        actionLog.createdAt,
        secondsFromDate(-BLOODLINE_SWAP_FREE_DAYS * DAY_S, new Date()),
      ),
    ),
    columns: { id: true, createdAt: true },
  });
  return results;
};

/** Load a bloodline definition by ID; a missing definition yields undefined. */
export const fetchBloodline = async (client: DrizzleClient, bloodlineId: string) => {
  return await client.query.bloodline.findFirst({
    where: eq(bloodline.id, bloodlineId),
  });
};

/** Load all non-hidden bloodline definitions. */
export const fetchBloodlines = async (client: DrizzleClient) => {
  return await client.query.bloodline.findMany({ where: eq(bloodline.hidden, false) });
};

import { count, desc, inArray, isNull, ne, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  ACTION_LOG_RELATED_MSG_MAX_LENGTH,
  IMG_AVATAR_DEFAULT,
} from "@/drizzle/constants";
import { jutsu, userData, userJutsu } from "@/drizzle/schema";
import { bloodrightSwapRefund } from "@/libs/bloodright";

/** Build the `bloodline` listing for `getAllNames`. */
export const listBloodlineForGetAllNames = (client: Pick<DrizzleClient, "query">) =>
  client.query.bloodline.findMany({
    columns: { id: true, name: true, image: true },
    orderBy: (table, { asc }) => [asc(table.name)],
  });

/** Build the `bloodline` listing for `getAll`, using the configured predicates. */
export const listBloodlineForGetAll = (
  client: Pick<DrizzleClient, "query">,
  baseFilters: (undefined | SQL<unknown>)[],
  skip: number,
  input: { limit: number },
) =>
  client.query.bloodline.findMany({
    with: { village: { columns: { name: true } } },
    where: and(...baseFilters),
    offset: skip,
    limit: input.limit,
  });

/** Build the `bloodline` insert for `create`. */
export const insertBloodlineForCreate = (
  client: Pick<DrizzleClient, "insert">,
  id: string,
) =>
  client.insert(bloodline).values({
    id: id,
    name: `New Bloodline - ${id}`,
    image: IMG_AVATAR_DEFAULT,
    description: "New bloodline description",
    effects: [],
    rank: "D",
    statClassification: "None",
    hidden: true,
  });

/** Build the `actionLog` lookup for `swapBloodline`, using predicates on `userId`, `tableName`, `relatedMsg`. */
export const findActionLogForSwapBloodline = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
) =>
  client.query.actionLog.findFirst({
    where: and(
      eq(actionLog.userId, ctx.userId),
      eq(actionLog.tableName, "user"),
      eq(actionLog.relatedMsg, "Bloodline Changed"),
    ),
    orderBy: (table, { desc }) => [desc(table.createdAt)],
  });

/** Build the `actionLog` insert for `swapBloodline`. */
export const insertActionLogForSwapBloodline = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  federalStatus: import("@/drizzle/schema").FederalStatus,
  line: { id: string },
  user: { avatarLight: null | string },
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "bloodlineSwap",
    changes: [
      `Bloodline swap (free ${federalStatus} - ${BLOODLINE_SWAP_FREE_DAYS} days)`,
    ],
    relatedId: line.id,
    relatedMsg: `Free swap for Silver/Gold supporter (${BLOODLINE_SWAP_FREE_DAYS} day cooldown)`,
    relatedImage: user.avatarLight,
    relatedValue: 0,
  });

/** Build the `bloodlineReskin` insert for `createReskin`. */
export const insertBloodlineReskinForCreateReskin = (
  client: Pick<DrizzleClient, "insert">,
  id: string,
  base: { id: string; name: string; description: string },
  input: { name?: undefined | string; description?: undefined | string },
  resolvedImage: string,
  ctx: { userId: string },
) =>
  client.insert(bloodlineReskin).values([
    {
      id: id,
      bloodlineId: base.id,
      name: input.name ?? base.name,
      description: input.description ?? base.description,
      image: resolvedImage,
      createdBy: ctx.userId,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ]);

/** Build the `actionLog` insert for `createReskin`. */
export const insertActionLogForCreateReskin = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  base: { name: string; id: string },
  input: { name?: undefined | string },
  resolvedImage: string,
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "bloodline",
    changes: [`Reskin created for ${base.name}: ${input.name}`],
    relatedId: base.id,
    relatedMsg: `Reskin created: ${input.name}`,
    relatedImage: resolvedImage,
  });

/**
 * Build the `bloodlineReskin` lookup for `updateReskin`, selecting only `name` and
 * `id`, using predicates on `name`, `bloodlineId`, `id`.
 */
export const findBloodlineReskinForUpdateReskin = (
  client: Pick<DrizzleClient, "query" | "select">,
  input: { data: { name: string }; reskinId: string },
) =>
  client.query.bloodlineReskin.findFirst({
    columns: { name: true, id: true },
    where: and(
      eq(bloodlineReskin.name, input.data.name),
      eq(
        bloodlineReskin.bloodlineId,
        client
          .select({ bloodlineId: bloodlineReskin.bloodlineId })
          .from(bloodlineReskin)
          .where(eq(bloodlineReskin.id, input.reskinId)),
      ),
    ),
  });

/** Build the `actionLog` insert for `updateReskin`. */
export const insertActionLogForUpdateReskin = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  reskin: { bloodlineId: string; image: string },
  reason: string,
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "bloodline",
    changes: [],
    relatedId: reskin.bloodlineId,
    relatedMsg: `Reskin update rejected by AI: ${reason}`,
    relatedImage: reskin.image,
  });

/** Build the `bloodlineReskin` update for `updateReskin`, using predicates on `id`. */
export const updateBloodlineReskinForUpdateReskin = (
  client: Pick<DrizzleClient, "update">,
  newData: z.infer<typeof baseReskinSchema>,
  reskin: { image: string; id: string },
) =>
  client
    .update(bloodlineReskin)
    .set({
      name: newData.name,
      description: newData.description,
      image: newData.image ?? reskin.image,
      updatedAt: new Date(),
    })
    .where(eq(bloodlineReskin.id, reskin.id));

/** Build the `actionLog` insert for `updateReskin`. */
export const insertActionLogForUpdateReskin2 = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  diff: string[],
  reskin: { bloodlineId: string; name: string; image: string },
  newData: { image?: undefined | string },
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "bloodline",
    changes: diff,
    relatedId: reskin.bloodlineId,
    relatedMsg: `Reskin updated: ${reskin.name}`,
    relatedImage: newData.image ?? reskin.image,
  });

/** Build the `jutsu` listing for `deleteReskin`, selecting only `id`, using predicates on `bloodlineReskinId`. */
export const listJutsuForDeleteReskin = (
  client: Pick<DrizzleClient, "query">,
  input: { reskinId: string },
) =>
  client.query.jutsu.findMany({
    columns: { id: true },
    where: eq(jutsu.bloodlineReskinId, input.reskinId),
  });

/** Build the reskin locking lookup for deletion; the caller owns the transaction and dependent content writes. */
export const selectBloodlineReskinForDeleteReskin = (
  client: Pick<DrizzleClient, "select">,
  input: { reskinId: string },
) =>
  client
    .select({ id: bloodlineReskin.id })
    .from(bloodlineReskin)
    .where(eq(bloodlineReskin.id, input.reskinId))
    .for("update");

/** Build the `jutsu` selection for `deleteReskin`, using predicates on `bloodlineReskinId`. */
export const selectJutsuForDeleteReskin = (
  client: Pick<DrizzleClient, "select">,
  input: { reskinId: string },
) =>
  client
    .select({ id: jutsu.id })
    .from(jutsu)
    .where(eq(jutsu.bloodlineReskinId, input.reskinId));

/** Build the `bloodlineReskin` deletion for `deleteReskin`, using predicates on `id`. */
export const deleteBloodlineReskinForDeleteReskin = (
  client: Pick<DrizzleClient, "delete">,
  input: { reskinId: string },
) => client.delete(bloodlineReskin).where(eq(bloodlineReskin.id, input.reskinId));

/** Build the `userData` update for `deleteReskin`, setting `bloodlineReskinId`, using predicates on `bloodlineReskinId`. */
export const updateUserDataForDeleteReskin = (
  client: Pick<DrizzleClient, "update">,
  input: { reskinId: string },
) =>
  client
    .update(userData)
    .set({ bloodlineReskinId: null })
    .where(eq(userData.bloodlineReskinId, input.reskinId));

/** Build the `actionLog` insert for `deleteReskin`. */
export const insertActionLogForDeleteReskin = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  reskin: { bloodlineId: string; name: string; image: string },
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "bloodline",
    changes: ["Reskin deleted"],
    relatedId: reskin.bloodlineId,
    relatedMsg: `Reskin deleted: ${reskin.name}`,
    relatedImage: reskin.image,
  });

/** Build the `actionLog` insert for `removeBloodlineFromPool`. */
export const insertActionLogForRemoveBloodlineFromPool = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  target: { userId: string; avatarLight: null | string },
  input: { reason: string },
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "bloodline",
    changes: [],
    relatedId: target.userId,
    relatedMsg: `Bloodline pool removal rejected by AI: ${input.reason}`.slice(
      0,
      ACTION_LOG_RELATED_MSG_MAX_LENGTH,
    ),
    relatedImage: target.avatarLight,
  });

/** Build the `actionLog` insert for `removeBloodlineFromPool`. */
export const insertActionLogForRemoveBloodlineFromPool2 = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  change: string,
  target: { userId: string; avatarLight: null | string },
  input: { reason: string },
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "bloodline",
    changes: [change],
    relatedId: target.userId,
    relatedMsg: input.reason.slice(0, ACTION_LOG_RELATED_MSG_MAX_LENGTH),
    relatedImage: target.avatarLight,
  });

/** Build the `bloodlineReskin` listing for `getReskinsForBloodline`, using predicates on `bloodlineId`. */
export const listBloodlineReskinForGetReskinsForBloodline = (
  client: Pick<DrizzleClient, "query">,
  input: { bloodlineId: string },
) =>
  client.query.bloodlineReskin.findMany({
    where: eq(bloodlineReskin.bloodlineId, input.bloodlineId),
    orderBy: (table, { desc }) => [desc(table.name)],
  });

/** Build the `bloodlineReskin` selection for `getAllReskins`, using the configured predicates. */
export const selectBloodlineReskinForGetAllReskins = (
  client: Pick<DrizzleClient, "select">,
  baseFilters: (undefined | SQL<unknown>)[],
  skip: number,
  input: { limit: number },
) =>
  client
    .select({
      reskin: bloodlineReskin,
      base: bloodline,
      userUsername: userData.username,
    })
    .from(bloodlineReskin)
    .innerJoin(bloodline, eq(bloodlineReskin.bloodlineId, bloodline.id))
    .innerJoin(userData, eq(bloodlineReskin.createdBy, userData.userId))
    .where(and(...baseFilters))
    .orderBy(desc(bloodlineReskin.updatedAt))
    .offset(skip)
    .limit(input.limit);

/** Build the `userData` listing for `delete`, using predicates on `bloodlineId` and `isAi`. */
export const listUserDataForDelete = (
  client: Pick<DrizzleClient, "query">,
  input: { id: string },
) =>
  client.query.userData.findMany({
    where: and(eq(userData.bloodlineId, input.id), eq(userData.isAi, false)),
  });

/** Build the `bloodline` deletion for `delete`, using predicates on `id`. */
export const deleteBloodlineForDelete = (
  client: Pick<DrizzleClient, "delete">,
  input: { id: string },
) => client.delete(bloodline).where(eq(bloodline.id, input.id));

/** Build the `userData` update for `delete`, using predicates on `bloodlineId`. */
export const updateUserDataForDelete = (
  client: Pick<DrizzleClient, "update">,
  bloodrightRefund: {
    seichiSilver: SQL<unknown>;
    bloodright: SQL<unknown>;
    bloodrightSpent: SQL<unknown>;
  },
  input: { id: string },
) =>
  client
    .update(userData)
    .set({
      // Combat retains preloaded tiers; preserve their saved refund until the battle ends.
      seichiSilver: sql`IF(${userData.status} = 'BATTLE', ${userData.seichiSilver}, ${bloodrightRefund.seichiSilver})`,
      bloodright: sql`IF(${userData.status} = 'BATTLE', ${userData.bloodright}, ${bloodrightRefund.bloodright})`,
      bloodrightSpent: sql`IF(${userData.status} = 'BATTLE', ${userData.bloodrightSpent}, ${bloodrightRefund.bloodrightSpent})`,
      bloodlineId: null,
    })
    .where(eq(userData.bloodlineId, input.id));

/** Build the `actionLog` insert for `delete`. */
export const insertActionLogForDelete = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  entry: { name: string; id: string; image: string },
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "bloodline",
    changes: [`Deleted: ${entry.name}`],
    relatedId: entry.id,
    relatedMsg: `Delete: ${entry.name}`,
    relatedImage: entry.image,
  });

/** Build the `bloodline` lookup for `update`, selecting only `name` and `id`, using predicates on `name`. */
export const findBloodlineForUpdate = (
  client: Pick<DrizzleClient, "query">,
  input: { data: { name: string } },
) =>
  client.query.bloodline.findFirst({
    columns: { name: true, id: true },
    where: eq(bloodline.name, input.data.name),
  });

/** Build the `bloodline` update for `update`, using predicates on `id`. */
export const updateBloodlineForUpdate = (
  client: Pick<DrizzleClient, "update">,
  newData: Pick<
    Bloodline,
    | "name"
    | "description"
    | "image"
    | "villageId"
    | "rank"
    | "effects"
    | "regenIncrease"
  > & {
    statClassification: StatType;
    hidden?: undefined | false | true;
    difficulty?: BloodlineDifficultyRating | undefined | null;
    traits?: undefined | null | string;
  },
  input: { id: string },
) => client.update(bloodline).set(newData).where(eq(bloodline.id, input.id));

/** Build the `actionLog` insert for `update`. */
export const insertActionLogForUpdate = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  diff: string[],
  entry: { id: string; name: string; image: string },
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "bloodline",
    changes: diff,
    relatedId: entry.id,
    relatedMsg: `Update: ${entry.name}`,
    relatedImage: entry.image,
  });

/** Build the `bloodlineRolls` selection for `getNaturalRollStatistics`, using predicates on `type`. */
export const selectBloodlineRollsForGetNaturalRollStatistics = (
  client: Pick<DrizzleClient, "select">,
) =>
  client
    .select({
      rank: bloodline.rank,
      count: count(bloodlineRolls.id),
    })
    .from(bloodlineRolls)
    .leftJoin(bloodline, eq(bloodlineRolls.bloodlineId, bloodline.id))
    .where(eq(bloodlineRolls.type, "NATURAL"))
    .groupBy(bloodline.rank);

/** Build the `bloodlineRolls` selection for `getNaturalRollStatistics`, using predicates on `type` and `bloodlineId`. */
export const selectBloodlineRollsForGetNaturalRollStatistics2 = (
  client: Pick<DrizzleClient, "select">,
) =>
  client
    .select({
      count: count(bloodlineRolls.id),
    })
    .from(bloodlineRolls)
    .where(and(eq(bloodlineRolls.type, "NATURAL"), isNull(bloodlineRolls.bloodlineId)));

/** Build the `bloodlineRolls` lookup for `roll`, selecting only `bloodlineId`, using predicates on `userId` and `type`. */
export const findBloodlineRollsForRoll = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
) =>
  client.query.bloodlineRolls.findFirst({
    where: and(
      eq(bloodlineRolls.userId, ctx.userId),
      eq(bloodlineRolls.type, "REGISTRATION"),
    ),
    columns: { bloodlineId: true },
  });

/** Build the `userData` update for `doRoll`, setting `bloodlineId`, using predicates on `userId` and `bloodlineId`. */
export const updateUserDataForDoRoll = (
  client: Pick<DrizzleClient, "update">,
  randomBloodline: { id: string },
  ctx: { userId: string },
  starterBloodlineId: null | string,
) =>
  client
    .update(userData)
    .set({
      ...bloodrightSwapRefund(randomBloodline.id),
      bloodlineId: randomBloodline.id,
    })
    .where(
      and(
        eq(userData.userId, ctx.userId),
        starterBloodlineId
          ? eq(userData.bloodlineId, starterBloodlineId)
          : isNull(userData.bloodlineId),
      ),
    );

/** Build the `bloodlineRolls` insert for `doRoll`. */
export const insertBloodlineRollsForDoRoll = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  randomBloodline: { id: string },
) =>
  client.insert(bloodlineRolls).values({
    id: nanoid(),
    userId: ctx.userId,
    used: 0,
    pityRolls: 0,
    type: "NATURAL",
    bloodlineId: randomBloodline.id,
  });

/** Build the `bloodlineRolls` insert for `doRoll`. */
export const insertBloodlineRollsForDoRoll2 = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
) =>
  client.insert(bloodlineRolls).values({
    id: nanoid(),
    used: 0,
    pityRolls: 0,
    userId: ctx.userId,
    type: "NATURAL",
  });

/** Build the `bloodlineRolls` insert for `pityRoll`. */
export const insertBloodlineRollsForPityRoll = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  randomBloodline: { id: string },
  input: { rank?: LetterRank | undefined | null },
) =>
  client.insert(bloodlineRolls).values({
    id: nanoid(),
    userId: ctx.userId,
    type: "PITY",
    bloodlineId: randomBloodline.id,
    goal: input.rank,
    used: 1,
    pityRolls: 0,
  });

/** Build the `bloodlineRolls` insert for `purchaseBloodline`. */
export const insertBloodlineRollsForPurchaseBloodline = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  line: { id: string; rank: import("@/drizzle/schema").BloodlineRank },
) =>
  client.insert(bloodlineRolls).values({
    id: nanoid(),
    userId: ctx.userId,
    type: "DIRECT",
    bloodlineId: line.id,
    goal: line.rank,
    used: 1,
    pityRolls: 0,
  });

/** Build the `jutsu` listing for `updateBloodline`, selecting only `id`, using predicates on `bloodlineId`. */
export const listJutsuForUpdateBloodline = (
  client: Pick<DrizzleClient, "query">,
  user: { bloodlineId: string },
) =>
  client.query.jutsu.findMany({
    columns: { id: true },
    where: eq(jutsu.bloodlineId, user.bloodlineId),
  });

/** Build the `userData` update for `updateBloodline`, including predicates on `userId`, `status`, `reputationPoints`. */
export const updateUserDataForUpdateBloodline = (
  client: Pick<DrizzleClient, "update">,
  bloodline: { id: undefined | string } | null,
  repCost: number,
  user: { userId: string; bloodlineId: null | string },
  updatedAt = new Date(),
) =>
  client
    .update(userData)
    .set({
      ...bloodrightSwapRefund(bloodline?.id || null),
      bloodlineId: bloodline?.id || null,
      bloodlineReskinId: null,
      reputationPoints: sql`${userData.reputationPoints} - ${repCost}`,
      // Advance the whole-user version so a concurrent claimUserSnapshot CAS detects this write.
      updatedAt,
    })
    .where(
      and(
        eq(userData.userId, user.userId),
        // Battle effects are fixed at initiation; prevent refunding an active path mid-fight.
        ne(userData.status, "BATTLE"),
        gte(userData.reputationPoints, repCost),
        user.bloodlineId
          ? eq(userData.bloodlineId, user.bloodlineId)
          : isNull(userData.bloodlineId),
      ),
    );

/** Build the `userJutsu` update for `updateBloodline`, using predicates on `userId` and `jutsuId`. */
export const updateUserJutsuForUpdateBloodline = (
  client: Pick<DrizzleClient, "update">,
  user: { userId: string },
  bloodlineJutsus: string[],
) =>
  client
    .update(userJutsu)
    .set({
      level: sql`CASE WHEN finishTraining > NOW() THEN level - 1 ELSE level END`,
      finishTraining: null,
      equipped: false,
    })
    .where(
      and(
        eq(userJutsu.userId, user.userId),
        inArray(userJutsu.jutsuId, bloodlineJutsus),
      ),
    );

/** Build the `actionLog` insert for `updateBloodline`. */
export const insertActionLogForUpdateBloodline = (
  client: Pick<DrizzleClient, "insert">,
  user: { userId: string; avatarLight: null | string; avatar: null | string },
  logMsg: string,
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: user.userId,
    tableName: "user",
    changes: [logMsg],
    relatedId: user.userId,
    relatedMsg: "Bloodline Changed",
    relatedImage: user.avatarLight || user.avatar || IMG_AVATAR_DEFAULT,
  });

/** Keep passive inputs in one snapshot for both lineage cache projections. */
const bloodlineCacheUserRelations = {
  bloodline: true,
  activeReskin: true,
  clan: true,
  village: { with: { structures: true } },
  raidBuffs: true,
  titles: true,
  userSkills: { where: eq(userSkill.activated, true), with: { skill: true } },
  items: {
    where: and(ne(userItem.equipped, "NONE"), gt(userItem.quantity, 0)),
    with: { item: true, imbuements: { with: { item: true } } },
  },
} as const;

/** Load passive sources required to project a lineage change without quest hydration. */
export const fetchBloodlineCacheUser = (client: DrizzleClient, userId: string) =>
  client.query.userData.findFirst({
    where: eq(userData.userId, userId),
    with: bloodlineCacheUserRelations,
  });

/** Load quest eligibility alongside passive sources for a lineage change. */
export const fetchBloodlineProgressionUser = (client: DrizzleClient, userId: string) =>
  client.query.userData.findFirst({
    where: eq(userData.userId, userId),
    with: {
      ...bloodlineCacheUserRelations,
      userQuests: userQuestHistoryRelation,
      completedQuests: completedQuestHistoryRelation,
    },
  });
