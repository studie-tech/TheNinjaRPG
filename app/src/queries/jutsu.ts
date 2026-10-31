/**
 * Database access for jutsu; authorization and transaction scopes stay in callers.
 */
import { and, asc, desc, eq, getTableColumns, inArray } from "drizzle-orm";
import type { z } from "zod";
import { jutsu, jutsuLoadout, jutsuReskin, userData } from "@/drizzle/schema";
import type { JutsuEquipCap } from "@/libs/jutsu";
import { JUTSU_EQUIP_CAPS } from "@/libs/jutsu";
import type { getJutsuReskinMechanics } from "@/libs/jutsu/reskins";
import type { DrizzleClient } from "@/server/db";
import type { baseReskinSchema } from "@/validators/jutsu";

/** Fetch the stable slot order used for both display and allowance checks. */
export const fetchJutsuLoadouts = async (client: DrizzleClient, userId: string) => {
  return await client.query.jutsuLoadout.findMany({
    where: eq(jutsuLoadout.userId, userId),
    // id is the deterministic tie-breaker so ties on createdAt (possible after a
    // batched backfill) keep a stable order across reads.
    orderBy: (table) => [asc(table.createdAt), asc(table.id)],
  });
};

/**
 * Fetch a jutsu by id (for reskin update)
 * @param client - The database client
 * @param id - The ID of the jutsu to fetch
 * @returns A promise that resolves to the result of the select
 */
export const fetchJutsu = async (client: DrizzleClient, id: string) => {
  return await client.query.jutsu.findFirst({
    where: eq(jutsu.id, id),
  });
};

/**
 * Fetch a reskin by ID, regardless of owner. Callers decide who may access it.
 * @param client - The database client
 * @param reskinId - The ID of the reskin to fetch
 * @returns A promise that resolves to the result of the select
 */
export const fetchReskin = async (client: DrizzleClient, reskinId: string) => {
  return await client.query.jutsuReskin.findFirst({
    where: eq(jutsuReskin.id, reskinId),
    with: {
      jutsu: {
        with: {
          bloodline: {
            columns: {
              name: true,
            },
          },
        },
      },
      user: {
        columns: {
          username: true,
        },
      },
    },
  });
};

/**
 * Fetch all reskins for a user whose base jutsu still exists
 * @param client - The database client
 * @param userId - The ID of the user to fetch reskins for
 * @returns A promise that resolves to the result of the select
 */
export const fetchUserReskins = async (client: DrizzleClient, userId: string) => {
  // Inner join so reskins whose base jutsu was deleted do not occupy reskin slots
  return await client
    .select(getTableColumns(jutsuReskin))
    .from(jutsuReskin)
    .innerJoin(jutsu, eq(jutsuReskin.jutsuId, jutsu.id))
    .where(eq(jutsuReskin.userId, userId));
};

/** Load variants only for the player's selected reskin and current underlying bloodline. */
export const fetchBloodlineJutsuReskins = async (
  client: DrizzleClient,
  userIds: string[],
) => {
  if (!userIds.length) return [];
  return client
    .select({ userId: userData.userId, jutsu })
    .from(userData)
    .innerJoin(
      jutsu,
      and(
        eq(jutsu.bloodlineReskinId, userData.bloodlineReskinId),
        eq(jutsu.bloodlineId, userData.bloodlineId),
      ),
    )
    .where(inArray(userData.userId, userIds))
    .orderBy(desc(jutsu.updatedAt), asc(jutsu.id));
};

/** Active loadout's jutsuIds, or null when the user has no pointer / join miss. */
export const fetchActiveLoadoutJutsuIds = async (
  client: DrizzleClient,
  userId: string,
): Promise<string[] | null> => {
  const [active] = await client
    .select({ jutsuIds: jutsuLoadout.jutsuIds })
    .from(userData)
    .innerJoin(jutsuLoadout, eq(jutsuLoadout.id, userData.jutsuLoadout))
    .where(and(eq(userData.userId, userId), eq(jutsuLoadout.userId, userId)))
    .limit(1);
  return active?.jutsuIds ?? null;
};

import { gte, isNotNull, isNull, ne, or, type SQL, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { nanoid } from "nanoid";
import {
  COST_RESKIN_JUTSU,
  IMG_AVATAR_DEFAULT,
  JUTSU_TRANSFER_DAYS,
  JUTSU_TRANSFER_MAX_LEVEL,
} from "@/drizzle/constants";
import {
  actionLog,
  bloodline,
  bloodlineReskin,
  item,
  petSpecies,
  quest,
  skillTree,
  userJutsu,
} from "@/drizzle/schema";
import type { JutsuCapFlags } from "@/libs/jutsu";

import { getNextUserSnapshotAt } from "@/server/utils/concurrency";
import { calculateContentDiff } from "@/utils/diff";
import { DAY_S, secondsFromDate } from "@/utils/time";

/** Table alias for linked reskin alias joins, keeping its columns distinct from other participants. */
const linkedReskinAlias = alias(jutsu, "linkedReskinName");

/** Table alias for parent jutsu alias joins, keeping its columns distinct from other participants. */
const parentJutsuAlias = alias(jutsu, "parentJutsu");
/** Build the `actionLog` listing for `getRecentTransfers`, using predicates on `userId`, `relatedMsg`, `createdAt`. */
export const listActionLogForGetRecentTransfers = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
) =>
  client.query.actionLog.findMany({
    where: and(
      eq(actionLog.userId, ctx.userId),
      eq(actionLog.relatedMsg, "JutsuLevelTransfer"),
      gte(
        actionLog.createdAt,
        secondsFromDate(-JUTSU_TRANSFER_DAYS * DAY_S, new Date()),
      ),
    ),
  });

/** Execute the database statement for `transferLevel`. */
export const executeTransferredForTransferLevel = (
  client: Pick<DrizzleClient, "execute">,
  toUserJutsu: { id: string; level: number },
  transfer: number,
  cost: 0 | 20,
  user: { updatedAt: Date },
  fromUserJutsu: { id: string; level: number },
  ctx: { userId: string },
) =>
  client.execute(sql`
        UPDATE ${userJutsu} source
        INNER JOIN ${userJutsu} target ON target.id = ${toUserJutsu.id}
        INNER JOIN ${userData} owner ON owner.userId = source.userId
        SET source.level = source.level - ${transfer},
            target.level = target.level + ${transfer},
            owner.reputationPoints = owner.reputationPoints - ${cost},
            owner.updatedAt = ${getNextUserSnapshotAt(user.updatedAt)}
        WHERE source.id = ${fromUserJutsu.id}
          AND source.userId = ${ctx.userId} AND target.userId = ${ctx.userId}
          AND source.level = ${fromUserJutsu.level} AND target.level = ${toUserJutsu.level}
          AND source.level - ${transfer} >= 1
          AND target.level + ${transfer} <= ${JUTSU_TRANSFER_MAX_LEVEL}
          AND (source.finishTraining IS NULL OR source.finishTraining <= NOW(3))
          AND (target.finishTraining IS NULL OR target.finishTraining <= NOW(3))
          AND owner.updatedAt = ${user.updatedAt}
          AND owner.reputationPoints >= ${cost}
      `);

/** Build the `actionLog` insert for `transferLevel`. */
export const insertActionLogForTransferLevel = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  transfer: number,
  fromJutsu: { name: string },
  fromUserJutsu: { level: number },
  toJutsu: { name: string },
  toUserJutsu: { level: number },
  needsReputation: false | true,
  user: { avatarLight: null | string },
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "userjutsu",
    changes: [
      `Transferred ${transfer} level(s) from ${fromJutsu.name} (new level: ${fromUserJutsu.level - transfer}) to ${toJutsu.name} (new level: ${toUserJutsu.level + transfer}). ${!needsReputation ? ` Used free transfer.` : ""}`,
    ],
    relatedId: ctx.userId,
    relatedMsg: "JutsuLevelTransfer",
    relatedImage: user.avatarLight,
  });

/** Build the `jutsu` listing for `getAllNames`. */
export const listJutsuForGetAllNames = (client: Pick<DrizzleClient, "query">) =>
  client.query.jutsu.findMany({
    columns: { id: true, name: true, image: true, injectableInBattle: true },
    orderBy: (table, { asc }) => [asc(table.name)],
  });

/** Build the `jutsu` listing for `getAll`, using predicates on `jutsuType`. */
export const listJutsuForGetAll = (
  client: Pick<DrizzleClient, "query">,
  baseFilters: (undefined | SQL<unknown>)[],
  input: { hideAi?: undefined | false | true; limit: number },
  skip: number,
) =>
  client.query.jutsu.findMany({
    where: and(...baseFilters, ...(input.hideAi ? [ne(jutsu.jutsuType, "AI")] : [])),
    orderBy: (table) => desc(table.updatedAt),
    offset: skip,
    with: {
      bloodline: {
        columns: {
          name: true,
        },
      },
    },
    limit: input.limit,
  });

/** Build the `jutsuLoadout` insert for `insertMissing`, updating duplicate keys. */
export const insertJutsuLoadoutForInsertMissing = (
  client: Pick<DrizzleClient, "insert">,
  rows: import("@/drizzle/schema").JutsuLoadout[],
) =>
  client
    .insert(jutsuLoadout)
    .values(rows)
    .onDuplicateKeyUpdate({ set: { id: sql`id` } });

/**
 * Build the `userData` update for `writeDefaultPointer`, setting `jutsuLoadout`, using
 * predicates on `userId` and `jutsuLoadout`.
 */
export const updateUserDataForWriteDefaultPointer = (
  client: Pick<DrizzleClient, "update">,
  id: string,
  ctx: { userId: string },
) =>
  client
    .update(userData)
    .set({ jutsuLoadout: id })
    .where(and(eq(userData.userId, ctx.userId), isNull(userData.jutsuLoadout)));

/** Build the `jutsuLoadout` selection for `importJutsuLoadout`, using the configured predicates. */
export const selectJutsuLoadoutForImportJutsuLoadout = (
  client: Pick<DrizzleClient, "select">,
  guard: undefined | SQL<unknown>,
) =>
  client
    .select({ id: jutsuLoadout.id, jutsuId: userJutsu.jutsuId })
    .from(jutsuLoadout)
    .innerJoin(userData, eq(userData.userId, jutsuLoadout.userId))
    .leftJoin(
      userJutsu,
      and(eq(userJutsu.userId, userData.userId), eq(userJutsu.equipped, true)),
    )
    .where(guard);

/** Execute the database statement for `importJutsuLoadout`. */
export const executeWriteForImportJutsuLoadout = (
  client: Pick<DrizzleClient, "execute">,
  isActive: boolean,
  preview: { jutsuIds: string[] },
  guard: SQL<unknown> | undefined,
) => {
  const savedIds = sql`CAST(${JSON.stringify(preview.jutsuIds)} AS JSON)`;
  const write = isActive
    ? sql`UPDATE ${jutsuLoadout}
            INNER JOIN ${userData} ON ${userData.userId} = ${jutsuLoadout.userId}
            LEFT JOIN ${userJutsu} ON ${userJutsu.userId} = ${userData.userId}
            SET ${jutsuLoadout.jutsuIds} = ${savedIds},
                ${userJutsu.equipped} = CASE WHEN ${inArray(userJutsu.jutsuId, preview.jutsuIds)} THEN 1 ELSE 0 END
            WHERE ${guard}`
    : sql`UPDATE ${jutsuLoadout}
            INNER JOIN ${userData} ON ${userData.userId} = ${jutsuLoadout.userId}
            SET ${jutsuLoadout.jutsuIds} = ${savedIds}
            WHERE ${guard}`;
  return client.execute(write);
};

/** Build the `jutsu` listing for `getReskinParents`, using predicates on `reskinParentJutsuId` and `jutsuRank`. */
export const listJutsuForGetReskinParents = (client: Pick<DrizzleClient, "query">) =>
  client.query.jutsu.findMany({
    columns: { id: true, name: true, bloodlineId: true },
    where: and(isNull(jutsu.reskinParentJutsuId), ne(jutsu.jutsuRank, "H")),
    orderBy: asc(jutsu.name),
  });

/** Build the `jutsu` listing for `getLinkedReskins`, using predicates on `bloodlineReskinId`. */
export const listJutsuForGetLinkedReskins = (
  client: Pick<DrizzleClient, "query">,
  input: { id: string },
) =>
  client.query.jutsu.findMany({
    where: eq(jutsu.bloodlineReskinId, input.id),
    orderBy: asc(jutsu.name),
  });

/** Build a bloodline reskin lookup by ID. */
export const findBloodlineReskinById = (
  client: Pick<DrizzleClient, "query">,
  reskinId: string,
) =>
  client.query.bloodlineReskin.findFirst({
    where: eq(bloodlineReskin.id, reskinId),
  });

/** Build the parent-jutsu locking lookup used by the caller transaction when creating a linked reskin. */
export const selectJutsuForCreateLinkedReskin = (
  client: Pick<DrizzleClient, "select">,
  input: { parentId: string },
) => client.select().from(jutsu).where(eq(jutsu.id, input.parentId)).for("update");

/** Build a bloodline reskin lookup that locks the row in the caller’s transaction. */
export const selectBloodlineReskinForUpdate = (
  client: Pick<DrizzleClient, "select">,
  reskinId: string,
) =>
  client
    .select()
    .from(bloodlineReskin)
    .where(eq(bloodlineReskin.id, reskinId))
    .for("update");

/** Build the `jutsu` insert for `createLinkedReskin`. */
export const insertJutsuForCreateLinkedReskin = (
  client: Pick<DrizzleClient, "insert">,
  parent: import("@/drizzle/schema").Jutsu,
  id: string,
  name: string,
  reskin: { id: string },
) =>
  client.insert(jutsu).values({
    ...parent,
    id,
    name,
    createdAt: new Date(),
    updatedAt: new Date(),
    reskinParentJutsuId: parent.id,
    bloodlineReskinId: reskin.id,
    parentJutsuId: null,
    jutsuRank: "H",
    hidden: true,
  });

/** Build the `actionLog` insert for `createLinkedReskin`. */
export const insertActionLogForCreateLinkedReskin = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  id: string,
  parent: { name: string; image: string },
  reskin: { name: string },
  name: string,
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "jutsu",
    relatedId: id,
    changes: [`Created reskin of ${parent.name} for ${reskin.name}`],
    relatedMsg: `Create: ${name}`,
    relatedImage: parent.image,
  });

/** Build the `jutsu` insert for `create`. */
export const insertJutsuForCreate = (
  client: Pick<DrizzleClient, "insert">,
  id: string,
) =>
  client.insert(jutsu).values({
    id,
    name: `New Jutsu - ${id}`,
    description: "New jutsu description",
    battleDescription: "%user uses %jutsu on %target",
    effects: [],
    range: 1,
    requiredRank: "STUDENT",
    requiredLevel: 1,
    target: "OTHER_USER",
    jutsuType: "AI",
    statClassification: "None",
    elementClassification: "None",
    image: IMG_AVATAR_DEFAULT,
  });

/** Build the `jutsu` insert for `clone`. */
export const insertJutsuForClone = (
  client: Pick<DrizzleClient, "insert">,
  source: import("@/drizzle/schema").Jutsu,
  id: string,
  name: string,
) =>
  client.insert(jutsu).values({
    ...source,
    id,
    name,
    hidden: true,
    // Copies start independently; attaching them through the editor validates
    // evolution limits and synchronizes linked-reskin mechanics.
    parentJutsuId: null,
    reskinParentJutsuId: null,
    bloodlineReskinId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

/** Build the `actionLog` insert for `clone`. */
export const insertActionLogForClone = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  id: string,
  source: { name: string; image: string },
  name: string,
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "jutsu",
    relatedId: id,
    changes: [`Cloned from ${source.name}`],
    relatedMsg: `Clone: ${name}`.slice(0, 191),
    relatedImage: source.image,
  });

/** Build the jutsu locking lookup for deletion; the caller coordinates dependent content writes in its transaction. */
export const selectJutsuForDelete = (
  client: Pick<DrizzleClient, "select">,
  input: { id: string },
) =>
  client
    .select({ id: jutsu.id })
    .from(jutsu)
    .where(eq(jutsu.id, input.id))
    .for("update");

/** Build the `jutsu` selection for `delete`, using predicates on `reskinParentJutsuId`. */
export const selectJutsuForDelete2 = (
  client: Pick<DrizzleClient, "select">,
  input: { id: string },
) =>
  client
    .select({ id: jutsu.id })
    .from(jutsu)
    .where(eq(jutsu.reskinParentJutsuId, input.id));

/** Build the `jutsu` deletion for `delete`, using predicates on `id`. */
export const deleteJutsuForDelete = (
  client: Pick<DrizzleClient, "delete">,
  input: { id: string },
) => client.delete(jutsu).where(eq(jutsu.id, input.id));

/** Build the `userJutsu` deletion for `delete`, using predicates on `jutsuId`. */
export const deleteUserJutsuForDelete = (
  client: Pick<DrizzleClient, "delete">,
  input: { id: string },
) => client.delete(userJutsu).where(eq(userJutsu.jutsuId, input.id));

/** Build the `actionLog` insert for `delete`. */
export const insertActionLogForDelete = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  entry: { name: string; id: string; image: string },
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "jutsu",
    changes: [`Deleted: ${entry.name}`],
    relatedId: entry.id,
    relatedMsg: `Delete: ${entry.name}`,
    relatedImage: entry.image,
  });

/** Build the `userJutsu` deletion for `forget`, using predicates on `id`. */
export const deleteUserJutsuForForget = (
  client: Pick<DrizzleClient, "delete">,
  input: { id: string },
) => client.delete(userJutsu).where(eq(userJutsu.id, input.id));

/** Build the `jutsu` listing for `getEvolutions`, using predicates on `parentJutsuId`. */
export const listJutsuForGetEvolutions = (
  client: Pick<DrizzleClient, "query">,
  input: { jutsuId: string },
) =>
  client.query.jutsu.findMany({
    where: eq(jutsu.parentJutsuId, input.jutsuId),
    orderBy: (table, { asc }) => [asc(table.requiredLevel)],
  });

/** Build the `jutsuReskin` lookup for `evolveJutsu`, selecting only `id`, using predicates on `userId` and `jutsuId`. */
export const findJutsuReskinForEvolveJutsu = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
  input: { evolutionJutsuId: string },
) =>
  client.query.jutsuReskin.findFirst({
    where: and(
      eq(jutsuReskin.userId, ctx.userId),
      eq(jutsuReskin.jutsuId, input.evolutionJutsuId),
    ),
    columns: { id: true },
  });

/** Build the `userJutsu` update for `evolveJutsu`, including predicates on `id`, `userId`, `jutsuId`. */
export const updateUserJutsuForEvolveJutsu = (
  client: Pick<DrizzleClient, "update">,
  input: { evolutionJutsuId: string; userJutsuId: string },
  isRestrictedEquipType: false | true,
  userJutsuObj: { reskinId: null | string; jutsu: { id: string }; level: number },
  conflictingReskin: undefined | Pick<import("@/drizzle/schema").DungeonRun, "id">,
  ctx: { userId: string },
) =>
  client
    .update(userJutsu)
    .set({
      jutsuId: input.evolutionJutsuId,
      level: 1,
      experience: 0,
      finishTraining: null,
      updatedAt: new Date(),
      ...(isRestrictedEquipType ? { equipped: false } : {}),
      ...(userJutsuObj.reskinId && conflictingReskin
        ? { reskinId: conflictingReskin.id }
        : {}),
    })
    .where(
      and(
        eq(userJutsu.id, input.userJutsuId),
        eq(userJutsu.userId, ctx.userId),
        eq(userJutsu.jutsuId, userJutsuObj.jutsu.id),
        eq(userJutsu.level, userJutsuObj.level),
      ),
    );

/** Build the jutsu order update for one loadout. */
export const updateJutsuLoadoutIds = (
  client: Pick<DrizzleClient, "update">,
  jutsuIds: string[],
  loadoutId: string,
) =>
  client
    .update(jutsuLoadout)
    .set({ jutsuIds: jutsuIds })
    .where(eq(jutsuLoadout.id, loadoutId));

/**
 * Build the `jutsuReskin` update for `evolveJutsu`, setting `jutsuId` and `updatedAt`,
 * using predicates on `id` and `userId`.
 */
export const updateJutsuReskinForEvolveJutsu = (
  client: Pick<DrizzleClient, "update">,
  input: { evolutionJutsuId: string },
  userJutsuObj: { reskinId: string },
  ctx: { userId: string },
) =>
  client
    .update(jutsuReskin)
    .set({ jutsuId: input.evolutionJutsuId, updatedAt: new Date() })
    .where(
      and(
        eq(jutsuReskin.id, userJutsuObj.reskinId),
        eq(jutsuReskin.userId, ctx.userId),
      ),
    );

/** Build the `actionLog` insert for `evolveJutsu`. */
export const insertActionLogForEvolveJutsu = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  userJutsuObj: { jutsu: { name: string } },
  evolutionJutsu: { name: string; image: string },
  input: { evolutionJutsuId: string },
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "userJutsu",
    changes: [`Evolved ${userJutsuObj.jutsu.name} into ${evolutionJutsu.name}`],
    relatedId: input.evolutionJutsuId,
    relatedMsg: "JutsuEvolution",
    relatedImage: evolutionJutsu.image,
  });

/** Build the `jutsu` lookup for `update`, selecting only `name` and `id`, using predicates on `name`. */
export const findJutsuForUpdate = (
  client: Pick<DrizzleClient, "query">,
  input: { data: { name: string } },
) =>
  client.query.jutsu.findFirst({
    columns: { name: true, id: true },
    where: eq(jutsu.name, input.data.name),
  });

/** Build the `jutsu` listing for `update`, selecting only `id`, using predicates on `parentJutsuId`. */
export const listJutsuForUpdate = (
  client: Pick<DrizzleClient, "query">,
  input: { data: { parentJutsuId: string } },
) =>
  client.query.jutsu.findMany({
    columns: { id: true },
    where: eq(jutsu.parentJutsuId, input.data.parentJutsuId),
  });

/** Build the `jutsu` listing for `update`, selecting only `id` and `parentJutsuId`, using predicates on `parentJutsuId`. */
export const listJutsuForUpdate2 = (client: Pick<DrizzleClient, "query">) =>
  client.query.jutsu.findMany({
    columns: { id: true, parentJutsuId: true },
    where: isNotNull(jutsu.parentJutsuId),
  });

/** Build the `item` lookup for `update`, selecting only `id` and `bloodlineId`, using predicates on `id`. */
export const findItemForUpdate = (
  client: Pick<DrizzleClient, "query">,
  input: { data: { requiredBloodlineItemId: string } },
) =>
  client.query.item.findFirst({
    columns: { id: true, bloodlineId: true },
    where: eq(item.id, input.data.requiredBloodlineItemId),
  });

/** Build the `petSpecies` lookup for `update`, selecting only `id`, using predicates on `id`. */
export const findPetSpeciesForUpdate = (
  client: Pick<DrizzleClient, "query">,
  input: { data: { requiredPetSpeciesId: string } },
) =>
  client.query.petSpecies.findFirst({
    where: eq(petSpecies.id, input.data.requiredPetSpeciesId),
    columns: { id: true },
  });

/** Build the `petSpecies` listing for `update`, selecting only `id`, using predicates on `defaultJutsuIds`. */
export const listPetSpeciesForUpdate = (
  client: Pick<DrizzleClient, "query">,
  input: { id: string },
) =>
  client.query.petSpecies.findMany({
    // Retired species still keep defaults used by their owned companions.
    columns: { id: true },
    where: sql`JSON_CONTAINS(${petSpecies.defaultJutsuIds}, JSON_QUOTE(${input.id}))`,
  });

/** Build the `userJutsu` update for `update`, setting `equipped`, using predicates on `jutsuId`. */
export const updateUserJutsuForUpdate = (
  client: Pick<DrizzleClient, "update">,
  entry: { id: string },
) =>
  client
    .update(userJutsu)
    .set({ equipped: false })
    .where(eq(userJutsu.jutsuId, entry.id));

/** Build the `jutsuReskin` lookup for `adjustUserJutsu`, using predicates on `id` and `jutsuId`. */
export const findJutsuReskinForAdjustUserJutsu = (
  client: Pick<DrizzleClient, "query">,
  input: { reskinId: string; jutsuId: string },
) =>
  client.query.jutsuReskin.findFirst({
    where: and(
      eq(jutsuReskin.id, input.reskinId),
      eq(jutsuReskin.jutsuId, input.jutsuId),
    ),
  });

/** Build the `userJutsu` update for `adjustUserJutsu`, using predicates on `userId` and `jutsuId`. */
export const updateUserJutsuForAdjustUserJutsu = (
  client: Pick<DrizzleClient, "update">,
  updateFields: { level: number; updatedAt: Date; reskinId: undefined | null | string },
  input: { userId: string; jutsuId: string },
) =>
  client
    .update(userJutsu)
    .set(updateFields)
    .where(
      and(eq(userJutsu.userId, input.userId), eq(userJutsu.jutsuId, input.jutsuId)),
    );

/** Build the `actionLog` insert for `adjustUserJutsu`. */
export const insertActionLogForAdjustUserJutsu = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  changes: string[],
  input: { userId: string },
  userjutsu: { jutsu: { name: string; image: string } },
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "user",
    changes,
    relatedId: input.userId,
    relatedMsg: `Update: ${userjutsu.jutsu.name}`,
    relatedImage: userjutsu.jutsu.image,
  });

/** Build the `userJutsu` update for `startTraining`, using predicates on `id` and `userId`. */
export const updateUserJutsuForStartTraining = (
  client: Pick<DrizzleClient, "update">,
  trainingStartedAt: Date,
  finishTraining: Date,
  userjutsuObj: { id: string },
  ctx: { userId: string },
) =>
  client
    .update(userJutsu)
    .set({
      level: sql`${userJutsu.level} + 1`,
      trainingStartedAt,
      finishTraining,
      updatedAt: new Date(),
    })
    .where(and(eq(userJutsu.id, userjutsuObj.id), eq(userJutsu.userId, ctx.userId)));

/** Build the `userJutsu` insert for `startTraining`, updating duplicate keys. */
export const insertUserJutsuForStartTraining = (
  client: Pick<DrizzleClient, "insert">,
  newUserJutsuId: string,
  ctx: { userId: string },
  input: { jutsuId: string },
  trainingStartedAt: Date,
  finishTraining: Date,
  canAutoEquip: false | true,
) =>
  client
    .insert(userJutsu)
    .values({
      id: newUserJutsuId,
      userId: ctx.userId,
      jutsuId: input.jutsuId,
      trainingStartedAt,
      finishTraining,
      equipped: canAutoEquip,
    })
    .onDuplicateKeyUpdate({ set: { id: sql`id` } });

/** Build the `userJutsu` selection for `startTraining`, using predicates on `userId` and `jutsuId`. */
export const selectUserJutsuForStartTraining = (
  client: Pick<DrizzleClient, "select">,
  ctx: { userId: string },
  input: { jutsuId: string },
) =>
  client
    .select({ id: userJutsu.id })
    .from(userJutsu)
    .where(and(eq(userJutsu.userId, ctx.userId), eq(userJutsu.jutsuId, input.jutsuId)))
    .limit(1);

/** Build the `userJutsu` update for `stopTraining`, using predicates on `id` and `userId`. */
export const updateUserJutsuForStopTraining = (
  client: Pick<DrizzleClient, "update">,
  userjutsuObj: { id: string },
  ctx: { userId: string },
) =>
  client
    .update(userJutsu)
    .set({
      level: sql`${userJutsu.level} - 1`,
      finishTraining: null,
      updatedAt: new Date(),
    })
    .where(and(eq(userJutsu.id, userjutsuObj.id), eq(userJutsu.userId, ctx.userId)));

/** Build the `userJutsu` selection for `fetchOwned`, using predicates on `userId`. */
export const selectUserJutsuForFetchOwned = (
  client: Pick<DrizzleClient, "select">,
  ctx: { userId: string },
) =>
  client
    .select({ jutsuId: userJutsu.jutsuId, level: userJutsu.level })
    .from(userJutsu)
    .where(eq(userJutsu.userId, ctx.userId));

/** Build the `userJutsu` update for `unequipAll`, setting `equipped`, using predicates on `userId`. */
export const updateUserJutsuForUnequipAll = (
  client: Pick<DrizzleClient, "update">,
  ctx: { userId: string },
) =>
  client
    .update(userJutsu)
    .set({ equipped: false })
    .where(eq(userJutsu.userId, ctx.userId));

/** Build the `jutsuLoadout` update for `unequipAll`, setting `jutsuIds`, using predicates on `id`. */
export const updateJutsuLoadoutForUnequipAll = (
  client: Pick<DrizzleClient, "update">,
  loadout: { id: string },
) =>
  client
    .update(jutsuLoadout)
    .set({ jutsuIds: [] })
    .where(eq(jutsuLoadout.id, loadout.id));

/** Build the `userJutsu` update for `toggleEquip`, setting `equipped`, using predicates on `id`, `userId`, `equipped`. */
export const updateUserJutsuForToggleEquip = (
  client: Pick<DrizzleClient, "update">,
  input: { userJutsuId: string },
  ctx: { userId: string },

  userjutsuObj: { jutsuId: string },
) =>
  client
    .update(userJutsu)
    .set({ equipped: false })
    .where(
      and(
        eq(userJutsu.id, input.userJutsuId),
        eq(userJutsu.userId, ctx.userId),
        eq(userJutsu.equipped, true),
        activeJutsuLoadoutLacksJutsuSql(ctx.userId, userjutsuObj.jutsuId),
      ),
    );

/** Build the `jutsuLoadout` update for `renameLoadout`, setting `name`, using predicates on `id` and `userId`. */
/** Build the `jutsuLoadout` update for `setLoadoutHotkeys`, using predicates on `id` and `userId`. */
export const updateJutsuLoadoutForSetLoadoutHotkeys = (
  client: Pick<DrizzleClient, "update">,
  input: { id: string; hotkeys: Record<string, string> },
  ctx: { userId: string },
) =>
  client
    .update(jutsuLoadout)
    .set({ hotkeys: input.hotkeys })
    .where(and(eq(jutsuLoadout.id, input.id), eq(jutsuLoadout.userId, ctx.userId)));

export const updateJutsuLoadoutForRenameLoadout = (
  client: Pick<DrizzleClient, "update">,
  name: string,
  input: { id: string },
  ctx: { userId: string },
) =>
  client
    .update(jutsuLoadout)
    .set({ name })
    .where(and(eq(jutsuLoadout.id, input.id), eq(jutsuLoadout.userId, ctx.userId)));

/** Build the `jutsuLoadout` lookup for `renameLoadout`, selecting only `id`, using predicates on `id` and `userId`. */
export const findJutsuLoadoutForRenameLoadout = (
  client: Pick<DrizzleClient, "query">,
  input: { id: string },
  ctx: { userId: string },
) =>
  client.query.jutsuLoadout.findFirst({
    columns: { id: true },
    where: and(eq(jutsuLoadout.id, input.id), eq(jutsuLoadout.userId, ctx.userId)),
  });

/** Build the `jutsuReskin` update for `createReskin`, using predicates on `id`. */
export const updateJutsuReskinForCreateReskin = (
  client: Pick<DrizzleClient, "update">,
  input: {
    name?: undefined | string;
    description?: undefined | string;
    battleDescription?: undefined | string;
  },
  resolvedImage: string,
  existingReskin: { id: string },
) =>
  client
    .update(jutsuReskin)
    .set({
      name: input.name,
      description: input.description,
      battleDescription: input.battleDescription,
      image: resolvedImage,
      updatedAt: new Date(),
    })
    .where(eq(jutsuReskin.id, existingReskin.id));

/** Build a reskin update for one owned jutsu, refreshing its update timestamp. */
export const setUserJutsuReskin = (
  client: Pick<DrizzleClient, "update">,
  reskinId: string,
  jutsuId: string,
  userId: string,
) =>
  client
    .update(userJutsu)
    .set({
      reskinId: reskinId,
      updatedAt: new Date(),
    })
    .where(and(eq(userJutsu.jutsuId, jutsuId), eq(userJutsu.userId, userId)));

/** Build the `jutsuReskin` insert for `createReskin`. */
export const insertJutsuReskinForCreateReskin = (
  client: Pick<DrizzleClient, "insert">,
  reskinId: string,
  ctx: { userId: string },
  jutsuData: {
    id: string;
    name: string;
    description: string;
    battleDescription: string;
  },
  input: {
    name?: undefined | string;
    description?: undefined | string;
    battleDescription?: undefined | string;
  },
  resolvedImage: string,
) =>
  client.insert(jutsuReskin).values({
    id: reskinId,
    userId: ctx.userId,
    jutsuId: jutsuData.id,
    name: input.name ?? jutsuData.name,
    description: input.description ?? jutsuData.description,
    battleDescription: input.battleDescription ?? jutsuData.battleDescription,
    image: resolvedImage,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

/** Build the `userData` update for `createReskin`, setting `reputationPoints`, using predicates on `userId`. */
export const updateUserDataForCreateReskin = (
  client: Pick<DrizzleClient, "update">,
  ctx: { userId: string },
) =>
  client
    .update(userData)
    .set({
      reputationPoints: sql`${userData.reputationPoints} - ${COST_RESKIN_JUTSU}`,
    })
    .where(eq(userData.userId, ctx.userId));

/** Build the `userData` selection for `updateReskin`, using predicates on `username`. */
export const selectUserDataForUpdateReskin = (
  client: Pick<DrizzleClient, "select">,
  username: string,
) =>
  client
    .select({ userId: userData.userId })
    .from(userData)
    .where(eq(userData.username, username));

/** Build the `jutsu` lookup for `updateReskin`, selecting only `id` and `name`, using predicates on `id`. */
export const findJutsuForUpdateReskin = (
  client: Pick<DrizzleClient, "query">,
  jutsuId: string,
) =>
  client.query.jutsu.findFirst({
    columns: { id: true, name: true },
    where: eq(jutsu.id, jutsuId),
  });

/** Build the `jutsuReskin` lookup for `updateReskin`, selecting only `id`, using predicates on `userId`, `jutsuId`, `id`. */
export const findJutsuReskinForUpdateReskin = (
  client: Pick<DrizzleClient, "query">,
  targetUserId: ReturnType<typeof selectUserDataForUpdateReskin>,
  jutsuId: string,
  input: { reskinId: string },
) =>
  client.query.jutsuReskin.findFirst({
    columns: { id: true },
    where: and(
      eq(jutsuReskin.userId, targetUserId),
      eq(jutsuReskin.jutsuId, jutsuId),
      ne(jutsuReskin.id, input.reskinId),
    ),
  });

/**
 * Build the `userJutsu` lookup for `updateReskin`, selecting only `id` and `reskinId`,
 * using predicates on `userId` and `jutsuId`.
 */
export const findUserJutsuForUpdateReskin = (
  client: Pick<DrizzleClient, "query">,
  targetUserId: ReturnType<typeof selectUserDataForUpdateReskin>,
  jutsuId: string,
) =>
  client.query.userJutsu.findFirst({
    columns: { id: true, reskinId: true },
    where: and(eq(userJutsu.userId, targetUserId), eq(userJutsu.jutsuId, jutsuId)),
  });

/** Build the `userJutsu` listing for `updateReskin`, using predicates on `reskinId`. */
export const listUserJutsuForUpdateReskin = (
  client: Pick<DrizzleClient, "query">,
  input: { reskinId: string },
) =>
  client.query.userJutsu.findMany({
    columns: { id: true, userId: true, jutsuId: true },
    where: eq(userJutsu.reskinId, input.reskinId),
  });

/** Build the `actionLog` insert for `updateReskin`. */
export const insertActionLogForUpdateReskin = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  aiCheck: { comment: string },
  reskin: { jutsuId: string; image: string },
  reason: string,
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "jutsu",
    changes: [`Reskin update rejected by AI: ${aiCheck.comment}`],
    relatedId: reskin.jutsuId,
    relatedMsg: `Reskin update rejected by AI: ${reason}`,
    relatedImage: reskin.image,
  });

/** Build the `jutsuReskin` update for `updateReskin`, using predicates on `id`. */
export const updateJutsuReskinForUpdateReskin = (
  client: Pick<DrizzleClient, "update">,
  targetUser: { userId: string },
  targetJutsu: { id: string },
  cosmetics: z.infer<typeof baseReskinSchema>,
  reskin: { image: string; id: string },
) =>
  client
    .update(jutsuReskin)
    .set({
      userId: targetUser.userId,
      jutsuId: targetJutsu.id,
      name: cosmetics.name,
      description: cosmetics.description,
      battleDescription: cosmetics.battleDescription,
      image: cosmetics.image ?? reskin.image,
      updatedAt: new Date(),
    })
    .where(eq(jutsuReskin.id, reskin.id));

/**
 * Build the `userJutsu` update for `updateReskin`, setting `reskinId` and `updatedAt`,
 * using predicates on `id` and `reskinId`.
 */
export const updateUserJutsuForUpdateReskin = (
  client: Pick<DrizzleClient, "update">,
  detachIds: string[],
  reskin: { id: string },
) =>
  client
    .update(userJutsu)
    .set({ reskinId: null, updatedAt: new Date() })
    .where(and(inArray(userJutsu.id, detachIds), eq(userJutsu.reskinId, reskin.id)));

/** Build the `userJutsu` update for `updateReskin`, setting `reskinId` and `updatedAt`, using predicates on `id`. */
export const updateUserJutsuForUpdateReskin2 = (
  client: Pick<DrizzleClient, "update">,
  reskin: { id: string },
  targetUserJutsu: { id: string },
) =>
  client
    .update(userJutsu)
    .set({ reskinId: reskin.id, updatedAt: new Date() })
    .where(eq(userJutsu.id, targetUserJutsu.id));

/** Build the `actionLog` insert for `updateReskin`. */
export const insertActionLogForUpdateReskin2 = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  diff: string[],
  targetJutsu: { id: string; name: string },
  cosmetics: { image?: undefined | string },
  reskin: { image: string },
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "jutsu",
    changes: diff,
    relatedId: targetJutsu.id,
    relatedMsg: `Reskin updated: ${targetJutsu.name}`,
    relatedImage: cosmetics.image ?? reskin.image,
  });

/** Build the `jutsuReskin` selection for `getAllReskins`, using predicates on `id`. */
export const selectJutsuReskinForGetAllReskins = (
  client: Pick<DrizzleClient, "select">,
  jutsuFilters: undefined | SQL<unknown>,
  skip: number,
  input: { limit: number },
) =>
  client
    .select({
      reskin: jutsuReskin,
      jutsu: jutsu,
      bloodlineName: bloodline.name,
      userUsername: userData.username,
    })
    .from(jutsuReskin)
    .leftJoin(jutsu, eq(jutsuReskin.jutsuId, jutsu.id))
    .leftJoin(bloodline, eq(jutsu.bloodlineId, bloodline.id))
    .innerJoin(userData, eq(jutsuReskin.userId, userData.userId))
    .where(jutsuFilters ? or(isNull(jutsu.id), jutsuFilters) : undefined)
    .orderBy(asc(isNotNull(jutsu.id)), desc(jutsuReskin.updatedAt))
    .offset(skip)
    .limit(input.limit);

/** Build the `jutsuReskin` listing for `getReskinsForJutsu`, using predicates on `jutsuId`. */
export const listJutsuReskinForGetReskinsForJutsu = (
  client: Pick<DrizzleClient, "query">,
  input: { jutsuId: string },
) =>
  client.query.jutsuReskin.findMany({
    where: eq(jutsuReskin.jutsuId, input.jutsuId),
    orderBy: (table, { desc }) => [desc(table.updatedAt)],
    with: {
      user: {
        columns: { username: true },
      },
    },
  });

/** Build the `userJutsu` listing for `getReskin`, selecting only `userId` and `jutsuId`, using predicates on `reskinId`. */
export const listUserJutsuForGetReskin = (
  client: Pick<DrizzleClient, "query">,
  input: { reskinId: string },
) =>
  client.query.userJutsu.findMany({
    columns: { userId: true, jutsuId: true },
    where: eq(userJutsu.reskinId, input.reskinId),
  });

/** Build the `userJutsu` lookup for `removeReskin`, using predicates on `id` and `userId`. */
export const findUserJutsuForRemoveReskin = (
  client: Pick<DrizzleClient, "query">,
  input: { userJutsuId: string },
  ctx: { userId: string },
) =>
  client.query.userJutsu.findFirst({
    where: and(eq(userJutsu.id, input.userJutsuId), eq(userJutsu.userId, ctx.userId)),
    with: { activeReskin: true },
  });

/**
 * Build the `userJutsu` update for `removeReskin`, setting `reskinId` and `updatedAt`,
 * using predicates on `id` and `userId`.
 */
export const updateUserJutsuForRemoveReskin = (
  client: Pick<DrizzleClient, "update">,
  input: { userJutsuId: string },
  ctx: { userId: string },
) =>
  client
    .update(userJutsu)
    .set({
      reskinId: null,
      updatedAt: new Date(),
    })
    .where(and(eq(userJutsu.id, input.userJutsuId), eq(userJutsu.userId, ctx.userId)));

/** Build the `jutsu` listing for `getJutsuRelations`, selecting only `id` and `name`, using predicates on `effects`. */
export const listJutsuForGetJutsuRelations = (
  client: Pick<DrizzleClient, "query">,
  jutsuId: string,
) =>
  client.query.jutsu.findMany({
    columns: { id: true, name: true },
    where: sql`JSON_SEARCH(${jutsu.effects}, 'one', ${jutsuId}, NULL, '$[*].jutsuIds[*]') IS NOT NULL
               AND JSON_SEARCH(${jutsu.effects}, 'one', 'injectjutsus', NULL, '$[*].type') IS NOT NULL`,
  });

/** Build the `bloodline` listing for `getJutsuRelations`, selecting only `id` and `name`, using predicates on `effects`. */
export const listBloodlineForGetJutsuRelations = (
  client: Pick<DrizzleClient, "query">,
  jutsuId: string,
) =>
  client.query.bloodline.findMany({
    columns: { id: true, name: true },
    where: sql`JSON_SEARCH(${bloodline.effects}, 'one', ${jutsuId}, NULL, '$[*].jutsuIds[*]') IS NOT NULL
               AND JSON_SEARCH(${bloodline.effects}, 'one', 'injectjutsus', NULL, '$[*].type') IS NOT NULL`,
  });

/** Build the `skillTree` listing for `getJutsuRelations`, selecting only `id` and `name`, using predicates on `effects`. */
export const listSkillTreeForGetJutsuRelations = (
  client: Pick<DrizzleClient, "query">,
  jutsuId: string,
) =>
  client.query.skillTree.findMany({
    columns: { id: true, name: true },
    where: sql`JSON_SEARCH(${skillTree.effects}, 'one', ${jutsuId}, NULL, '$[*].jutsuIds[*]') IS NOT NULL
               AND JSON_SEARCH(${skillTree.effects}, 'one', 'injectjutsus', NULL, '$[*].type') IS NOT NULL`,
  });

/** Build the `item` listing for `getJutsuRelations`, selecting only `id` and `name`, using predicates on `effects`. */
export const listItemForGetJutsuRelations = (
  client: Pick<DrizzleClient, "query">,
  jutsuId: string,
) =>
  client.query.item.findMany({
    columns: { id: true, name: true },
    where: sql`JSON_SEARCH(${item.effects}, 'one', ${jutsuId}, NULL, '$[*].jutsuIds[*]') IS NOT NULL
               AND JSON_SEARCH(${item.effects}, 'one', 'injectjutsus', NULL, '$[*].type') IS NOT NULL`,
  });

/** Build the `userJutsu` selection for `getJutsuRelations`, using predicates on `jutsuId` and `isAi`. */
export const selectUserJutsuForGetJutsuRelations = (
  client: Pick<DrizzleClient, "select">,
  jutsuId: string,
) =>
  client
    .select({
      name: userData.username,
      id: userData.userId,
    })
    .from(userJutsu)
    .innerJoin(userData, eq(userJutsu.userId, userData.userId))
    .where(and(eq(userJutsu.jutsuId, jutsuId), eq(userData.isAi, true)));

/** Build the `quest` listing for `getJutsuRelations`, selecting only `id` and `name`, using predicates on `content`. */
export const listQuestForGetJutsuRelations = (
  client: Pick<DrizzleClient, "query">,
  jutsuId: string,
) =>
  client.query.quest.findMany({
    columns: { id: true, name: true },
    where: sql`(
        JSON_SEARCH(${quest.content}, 'one', ${jutsuId}, NULL, '$.reward.reward_jutsus[*]') IS NOT NULL
        OR JSON_SEARCH(${quest.content}, 'one', ${jutsuId}, NULL, '$.objectives[*].reward_jutsus[*]') IS NOT NULL
      )`,
  });

/**
 * Build the `jutsu` listing for `getJutsuRelations`, selecting only `id` and `name`,
 * using predicates on `parentJutsuId`.
 */
export const listJutsuForGetJutsuRelations2 = (
  client: Pick<DrizzleClient, "query">,
  jutsuId: string,
) =>
  client.query.jutsu.findMany({
    columns: { id: true, name: true },
    where: eq(jutsu.parentJutsuId, jutsuId),
  });

/**
 * Build the `jutsu` listing for `getJutsuRelations`, selecting only `id` and `name`,
 * using predicates on `reskinParentJutsuId`.
 */
export const listJutsuForGetJutsuRelations3 = (
  client: Pick<DrizzleClient, "query">,
  jutsuId: string,
) =>
  client.query.jutsu.findMany({
    columns: { id: true, name: true },
    where: eq(jutsu.reskinParentJutsuId, jutsuId),
  });

/** Build the `jutsuReskin` selection for `getJutsuRelations`, using predicates on `jutsuId`. */
export const selectJutsuReskinForGetJutsuRelations = (
  client: Pick<DrizzleClient, "select">,
  jutsuId: string,
) =>
  client
    .select({
      id: jutsuReskin.id,
      name: sql<string>`CONCAT(${jutsuReskin.name}, ' (', COALESCE(${userData.username}, ${jutsuReskin.userId}), ')')`,
    })
    .from(jutsuReskin)
    .leftJoin(userData, eq(jutsuReskin.userId, userData.userId))
    .where(eq(jutsuReskin.jutsuId, jutsuId));

/** Build the `jutsu` listing for `prepareJutsuLoadoutImport`, using predicates on `id`. */
export const listJutsuForPrepareJutsuLoadoutImport = (
  client: Pick<DrizzleClient, "query">,
  jutsuIds: string[],
) =>
  client.query.jutsu.findMany({
    where: inArray(jutsu.id, jutsuIds),
    columns: { id: true, name: true, hidden: true },
  });

/** Build the `userData` selection for `fetchUserJutsus`, using predicates on `userId`, `reskinParentJutsuId`, `id`. */
export const selectUserDataForFetchUserJutsus = (
  client: Pick<DrizzleClient, "select">,
  userId: string,
) =>
  client
    .select({ name: linkedReskinAlias.name })
    .from(userData)
    .innerJoin(
      linkedReskinAlias,
      and(
        eq(linkedReskinAlias.bloodlineReskinId, userData.bloodlineReskinId),
        eq(linkedReskinAlias.bloodlineId, userData.bloodlineId),
      ),
    )
    .where(
      and(
        eq(userData.userId, userId),
        eq(linkedReskinAlias.reskinParentJutsuId, jutsu.id),
      ),
    )
    .orderBy(desc(linkedReskinAlias.updatedAt), asc(linkedReskinAlias.id))
    .limit(1);

/** Build the `userJutsu` selection for `fetchUserJutsus`, using predicates on `userId` and `jutsuType`. */
export const selectUserJutsuForFetchUserJutsus = (
  client: Pick<DrizzleClient, "select">,
  userId: string,
  inventoryFilter: undefined | SQL<unknown>,
) =>
  client
    .select()
    .from(userJutsu)
    .innerJoin(jutsu, eq(userJutsu.jutsuId, jutsu.id))
    .leftJoin(bloodline, eq(jutsu.bloodlineId, bloodline.id))
    .leftJoin(jutsuReskin, eq(userJutsu.reskinId, jutsuReskin.id))
    .leftJoin(parentJutsuAlias, eq(jutsu.parentJutsuId, parentJutsuAlias.id))
    .where(
      and(eq(userJutsu.userId, userId), ne(jutsu.jutsuType, "AI"), inventoryFilter),
    )
    .orderBy(desc(userJutsu.level));

/** Execute the database statement for `selectJutsuLoadout`. */
export const executeRowsForSelectJutsuLoadout = (
  client: Pick<DrizzleClient, "execute">,
  loadout: { id: string },
  equippedAssignment: SQL<unknown>,
  user: { userId: string },
) =>
  client.execute(sql`
    UPDATE ${userData}
    LEFT JOIN ${userJutsu} ON ${userJutsu.userId} = ${userData.userId}
    SET ${userData.jutsuLoadout} = ${loadout.id},
        ${userJutsu.equipped} = ${equippedAssignment}
    WHERE ${userData.userId} = ${user.userId}
  `);

/**
 * Build the `userJutsu` update for `rollbackEquipIfOverCap`, setting `equipped`, using
 * predicates on `id`, `userId`, `equipped`.
 */
export const updateUserJutsuForRollbackEquipIfOverCap = (
  client: Pick<DrizzleClient, "update">,
  userJutsuId: string,
  userId: string,

  maxEquip: number,
  flags: import("@/libs/jutsu").JutsuCapFlags,
) =>
  client
    .update(userJutsu)
    .set({ equipped: false })
    .where(
      and(
        eq(userJutsu.id, userJutsuId),
        eq(userJutsu.userId, userId),
        eq(userJutsu.equipped, true),
        equipCapRollbackGuardSql(userId, maxEquip, flags),
      ),
    );

/**
 * Build the `userJutsu` update for `tryEquipUserJutsuAtomically`, setting `equipped`
 * and `updatedAt`, using predicates on `id`, `userId`, `equipped`.
 */
export const updateUserJutsuForTryEquipUserJutsuAtomically = (
  client: Pick<DrizzleClient, "update">,
  userJutsuId: string,
  userId: string,

  maxEquip: number,
  flags: import("@/libs/jutsu").JutsuCapFlags,
) =>
  client
    .update(userJutsu)
    .set({ equipped: true, updatedAt: new Date() })
    .where(
      and(
        eq(userJutsu.id, userJutsuId),
        eq(userJutsu.userId, userId),
        eq(userJutsu.equipped, false),
        equipCapUnderGuardSql(userId, maxEquip, flags),
      ),
    );

/** Build the equipped-state lookup for a jutsu owned by one user. */
export const selectUserJutsuEquipped = (
  client: Pick<DrizzleClient, "select">,
  userJutsuId: string,
  userId: string,
) =>
  client
    .select({ equipped: userJutsu.equipped })
    .from(userJutsu)
    .where(and(eq(userJutsu.id, userJutsuId), eq(userJutsu.userId, userId)))
    .limit(1);

/**
 * Build the `jutsuLoadout` update for `appendJutsuIdToLoadoutAtomically`, setting
 * `jutsuIds`, using predicates on `id`, `userId`, `jutsuIds`.
 */
export const updateJutsuLoadoutForAppendJutsuIdToLoadoutAtomically = (
  client: Pick<DrizzleClient, "update">,
  jutsuId: string,
  loadoutId: string,
  userId: string,
) =>
  client
    .update(jutsuLoadout)
    .set({
      jutsuIds: sql`JSON_ARRAY_APPEND(${jutsuLoadout.jutsuIds}, '$', ${jutsuId})`,
    })
    .where(
      and(
        eq(jutsuLoadout.id, loadoutId),
        eq(jutsuLoadout.userId, userId),
        isActiveJutsuLoadoutSql(userId, loadoutId),
        sql`NOT JSON_CONTAINS(${jutsuLoadout.jutsuIds}, JSON_QUOTE(${jutsuId}))`,
      ),
    );

/**
 * Build the `jutsuLoadout` update for `removeJutsuIdFromLoadoutAtomically`, setting
 * `jutsuIds`, using predicates on `id`, `userId`, `jutsuIds`.
 */
export const updateJutsuLoadoutForRemoveJutsuIdFromLoadoutAtomically = (
  client: Pick<DrizzleClient, "update">,
  searchPattern: string,
  loadoutId: string,
  userId: string,

  jutsuId: string,
) =>
  client
    .update(jutsuLoadout)
    .set({
      jutsuIds: sql`JSON_REMOVE(
          ${jutsuLoadout.jutsuIds},
          JSON_UNQUOTE(JSON_SEARCH(${jutsuLoadout.jutsuIds}, 'one', ${searchPattern}, ${"\\"}))
        )`,
    })
    .where(
      and(
        eq(jutsuLoadout.id, loadoutId),
        eq(jutsuLoadout.userId, userId),
        isActiveJutsuLoadoutSql(userId, loadoutId),
        // Exact membership — do not use unescaped JSON_SEARCH (LIKE wildcards).
        sql`JSON_CONTAINS(${jutsuLoadout.jutsuIds}, JSON_QUOTE(${jutsuId}))`,
      ),
    );

/** Build family row locks in sorted ID order; the caller owns the transaction and saves the linked family together. */
export const selectJutsuForSaveJutsuFamily = (
  client: Pick<DrizzleClient, "select">,
  lockIds: string[],
) =>
  client
    .select()
    .from(jutsu)
    .where(inArray(jutsu.id, lockIds))
    .orderBy(asc(jutsu.id))
    .for("update");

/** Build the `jutsu` selection for `saveJutsuFamily`, using predicates on `reskinParentJutsuId` and `parentJutsuId`. */
export const selectJutsuForSaveJutsuFamily2 = (
  client: Pick<DrizzleClient, "select">,
  entry: { id: string },
  data: { reskinParentJutsuId: null | string },
) =>
  client
    .select()
    .from(jutsu)
    .where(
      or(
        eq(jutsu.reskinParentJutsuId, entry.id),
        data.reskinParentJutsuId ? eq(jutsu.parentJutsuId, entry.id) : undefined,
      ),
    );

/** Build the `jutsu` update for `saveJutsuFamily`, setting `updatedAt`, using predicates on `id`. */
export const updateJutsuForSaveJutsuFamily = (
  client: Pick<DrizzleClient, "update">,
  data: import("@/validators/combat").ZodJutsuType,
  updatedAt: Date,
  entry: { id: string },
) =>
  client
    .update(jutsu)
    .set({ ...data, updatedAt })
    .where(eq(jutsu.id, entry.id));

/** Build the `jutsu` update for `saveJutsuFamily`, setting `effects` and `updatedAt`, using predicates on `id`. */
export const updateJutsuForSaveJutsuFamily2 = (
  client: Pick<DrizzleClient, "update">,
  mechanics: ReturnType<typeof getJutsuReskinMechanics>,
  cases: SQL<unknown>[],
  updatedAt: Date,
  children: import("@/drizzle/schema").Jutsu[],
) =>
  client
    .update(jutsu)
    .set({
      ...mechanics,
      effects: sql`CASE ${jutsu.id} ${sql.join(cases, sql` `)} END`,
      updatedAt,
    })
    .where(
      inArray(
        jutsu.id,
        children.map((child) => child.id),
      ),
    );

/** Build the `actionLog` insert for `saveJutsuFamily`. */
export const insertActionLogForSaveJutsuFamily = (
  client: Pick<DrizzleClient, "insert">,
  userId: string,
  diff: string[],
  entry: { id: string; name: string; image: string },
  updates: {
    original: import("@/drizzle/schema").Jutsu;
    updated: import("@/drizzle/schema").Jutsu;
  }[],
  data: { name: string },
) =>
  client.insert(actionLog).values([
    {
      id: nanoid(),
      userId,
      tableName: "jutsu",
      changes: diff,
      relatedId: entry.id,
      relatedMsg: `Update: ${entry.name}`,
      relatedImage: entry.image,
    },
    ...updates.map(({ original, updated }) => ({
      id: nanoid(),
      userId,
      tableName: "jutsu",
      changes: calculateContentDiff(original, updated),
      relatedId: original.id,
      relatedMsg: `Sync parent: ${data.name}`,
      relatedImage: original.image,
    })),
  ]);

/** Build the `jutsu` listing, using predicates on `id`. */
export const listJutsuByIds = (
  client: Pick<DrizzleClient, "query">,
  jutsusIds: string[],
) => client.query.jutsu.findMany({ where: inArray(jutsu.id, jutsusIds) });

/** True when the user's active loadout does not currently contain `jutsuId`. */
const activeJutsuLoadoutLacksJutsuSql = (userId: string, jutsuId: string) =>
  sql`NOT EXISTS (
    SELECT 1 FROM (
      SELECT ${jutsuLoadout.jutsuIds} AS ids
      FROM ${userData}
      INNER JOIN ${jutsuLoadout} ON ${jutsuLoadout.id} = ${userData.jutsuLoadout}
      WHERE ${userData.userId} = ${userId}
        AND ${jutsuLoadout.userId} = ${userId}
    ) AS active_loadout
    WHERE JSON_CONTAINS(active_loadout.ids, JSON_QUOTE(${jutsuId}))
  )`;

/**
 * Rollback predicate: unequip this row only when it sits outside the first N
 * kept slots for an exceeded cap. Concurrent racers that both passed under-cap
 * then both equip no longer both lose — earlier (updatedAt, id) keeps the slot.
 */
const equipCapRollbackGuardSql = (
  userId: string,
  maxEquip: number,
  flags: JutsuCapFlags,
) => {
  const parts = [equippedRankExceedsCapSql(userId, maxEquip)];
  for (const cap of JUTSU_EQUIP_CAPS) {
    if (flags[cap.key]) {
      parts.push(
        equippedRankExceedsCapSql(userId, cap.max, equipCapCategorySql(cap, "j_rank")),
      );
    }
  }
  return sql`(${sql.join(parts, sql` OR `)})`;
};

/** Under-cap predicate: all applicable counts must still have room (AND). */
const equipCapUnderGuardSql = (
  userId: string,
  maxEquip: number,
  flags: JutsuCapFlags,
) => {
  const parts = [sql`c.total < ${maxEquip}`];
  for (const cap of JUTSU_EQUIP_CAPS) {
    if (flags[cap.key]) {
      parts.push(sql`${sql.raw(`c.${cap.countAlias}`)} < ${cap.max}`);
    }
  }
  return sql`(
    SELECT ${sql.join(parts, sql` AND `)}
    FROM ${equippedCapCountsDerivedSql(userId)} AS c
  )`;
};

/** True when this loadout is still the user's active `userData.jutsuLoadout`. */
const isActiveJutsuLoadoutSql = (userId: string, loadoutId: string) => sql`EXISTS (
  SELECT 1 FROM ${userData}
  WHERE ${userData.userId} = ${userId}
    AND ${userData.jutsuLoadout} = ${loadoutId}
)`;

/**
 * Detect nonzero numeric residual modifiers on a trusted jutsu table alias.
 * JSON_SEARCH only matches strings, so extract the numeric array and test its digits.
 */
const residualModifierOnAliasSql = (alias: string) =>
  sql.raw(
    `CAST(JSON_EXTRACT(${alias}.effects, '$[*].residualModifier') AS CHAR) REGEXP '[1-9]'`,
  );

/** Build a cap category predicate against the supplied jutsu table alias. */
const equipCapCategorySql = (cap: JutsuEquipCap, alias: string) => {
  const kind = cap.sql;
  if (kind.kind === "residual") return residualModifierOnAliasSql(alias);
  if (kind.kind === "jutsuType") {
    return sql.raw(`${alias}.jutsuType = '${kind.jutsuType}'`);
  }
  return sql`JSON_SEARCH(${sql.raw(`${alias}.effects`)}, 'one', ${kind.effectType}, NULL, '$[*].type') IS NOT NULL`;
};

/** Materialize all equipped-jutsu cap counts in one pass so UPDATE guards avoid MySQL ERROR 1093. */
const equippedCapCountsDerivedSql = (userId: string) => {
  const sumCols = JUTSU_EQUIP_CAPS.map(
    (cap) =>
      sql`COALESCE(SUM(CASE WHEN ${equipCapCategorySql(cap, "j_cap")} THEN 1 ELSE 0 END), 0) AS ${sql.raw(cap.countAlias)}`,
  );
  return sql`(
    SELECT
      COUNT(*) AS total,
      ${sql.join(
        sumCols,
        sql`,
      `,
      )}
    FROM ${userJutsu} AS uj_cap
    INNER JOIN ${jutsu} AS j_cap ON j_cap.id = uj_cap.jutsuId
    WHERE uj_cap.userId = ${userId}
      AND uj_cap.equipped = true
      AND j_cap.jutsuType != 'AI'
  )`;
};

/**
 * True when this updated row's rank among equipped peers (updatedAt ASC, id ASC)
 * exceeds `cap`. Optional `categorySql` restricts the peer set (heal/event/…).
 * Derived-table wrapper avoids ERROR 1093 on the table being updated.
 */
const equippedRankExceedsCapSql = (
  userId: string,
  cap: number,
  categorySql?: ReturnType<typeof sql>,
) => sql`(
  SELECT cnt FROM (
    SELECT COUNT(*) AS cnt
    FROM ${userJutsu} AS uj_rank
    INNER JOIN ${jutsu} AS j_rank ON j_rank.id = uj_rank.jutsuId
    WHERE uj_rank.userId = ${userId}
      AND uj_rank.equipped = true
      AND j_rank.jutsuType != 'AI'
      ${categorySql ? sql`AND ${categorySql}` : sql``}
      AND (
        uj_rank.updatedAt < ${userJutsu.updatedAt}
        OR (
          uj_rank.updatedAt = ${userJutsu.updatedAt}
          AND uj_rank.id <= ${userJutsu.id}
        )
      )
  ) AS equip_rank_cnt
) > ${cap}`;
