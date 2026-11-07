/**
 * Database access for sage mode; authorization and transaction scopes stay in callers.
 */
import type { SQL } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { sageMode, sageModeRolls } from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
import type { ActionReadiness } from "@/server/utils/actionReadiness";
import type { ZodSageModeType } from "@/validators/combat";

/**
 * Item and quest acquisition share this history so a mode cannot be rolled twice.
 *
 * @param client - Drizzle client.
 * @param userId - Player whose `SageModeRolls` rows to load.
 */
export const fetchSageModeRolls = async (client: DrizzleClient, userId: string) => {
  return await client.query.sageModeRolls.findMany({
    where: eq(sageModeRolls.userId, userId),
    with: { sageMode: true },
  });
};

/**
 * Visible catalog rows for item-roll pooling. Hidden modes are staff-only and
 * are never granted by `rollsagemode`.
 *
 * @param client - Drizzle client.
 */
export const fetchSageModes = async (client: DrizzleClient) => {
  return await client.query.sageMode.findMany({ where: eq(sageMode.hidden, false) });
};

/**
 * Load one catalog row by id, including hidden. Used by `get` / `update` / `delete`.
 *
 * @param client - Drizzle client.
 * @param sageModeId - `SageMode.id`.
 */
export const fetchSageMode = async (client: DrizzleClient, sageModeId: string) => {
  return await client.query.sageMode.findFirst({
    where: eq(sageMode.id, sageModeId),
  });
};

import { and, gte, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  IMG_AVATAR_DEFAULT,
  SAGE_MODE_DEFAULT_ACTIVATION_MESSAGE,
} from "@/drizzle/constants";
import { actionLog, userData } from "@/drizzle/schema";

/** Build the `sageMode` listing for `getAllNames`, using predicates on `hidden`. */
export const listSageModeForGetAllNames = (
  client: Pick<DrizzleClient, "query">,
  allowHidden: false | true,
) =>
  client.query.sageMode.findMany({
    columns: { id: true, name: true, image: true },
    where: allowHidden ? undefined : eq(sageMode.hidden, false),
    orderBy: (table, { asc }) => [asc(table.name)],
  });

/** Build the `sageMode` listing for `getAll`, using the configured predicates. */
export const listSageModeForGetAll = (
  client: Pick<DrizzleClient, "query">,
  baseFilters: SQL<unknown>[],
  skip: number,
  input: { limit: number },
) =>
  client.query.sageMode.findMany({
    with: { village: { columns: { name: true } } },
    where: and(...baseFilters),
    orderBy: (table, { asc }) => [asc(table.name)],
    offset: skip,
    limit: input.limit,
  });

/** Build the `sageMode` insert for `create`. */
export const insertSageModeForCreate = (
  client: Pick<DrizzleClient, "insert">,
  id: string,
) =>
  client.insert(sageMode).values({
    id: id,
    name: `New Sage Mode - ${id}`,
    image: IMG_AVATAR_DEFAULT,
    description: "New sage mode description",
    battleDescription: SAGE_MODE_DEFAULT_ACTIVATION_MESSAGE,
    effects: [],
    afterEffects: [],
    level: 1,
    hidden: true,
  });

/** Build the `userData` listing for `delete`, selecting only `username`, using predicates on `sageModeId` and `isAi`. */
export const listUserDataForDelete = (
  client: Pick<DrizzleClient, "query">,
  input: { id: string },
) =>
  client.query.userData.findMany({
    columns: { username: true },
    where: and(eq(userData.sageModeId, input.id), eq(userData.isAi, false)),
    limit: 10,
  });

/** Build the `sageMode` deletion for `delete`, using predicates on `id`. */
export const deleteSageModeForDelete = (
  client: Pick<DrizzleClient, "delete">,
  input: { id: string },
) => client.delete(sageMode).where(eq(sageMode.id, input.id));

/** Build the `userData` update for `delete`, setting `sageModeId`, using predicates on `sageModeId`. */
export const updateUserDataForDelete = (
  client: Pick<DrizzleClient, "update">,
  input: { id: string },
) =>
  client
    .update(userData)
    .set({ sageModeId: null })
    .where(eq(userData.sageModeId, input.id));

/** Build the `actionLog` insert for `delete`. */
export const insertActionLogForDelete = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  entry: { name: string; id: string; image: string },
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "sageMode",
    changes: [`Deleted: ${entry.name}`],
    relatedId: entry.id,
    relatedMsg: `Delete: ${entry.name}`,
    relatedImage: entry.image,
  });

/** Build the `sageMode` lookup for `update`, selecting only `name` and `id`, using predicates on `name`. */
export const findSageModeForUpdate = (
  client: Pick<DrizzleClient, "query">,
  input: { data: { name: string } },
) =>
  client.query.sageMode.findFirst({
    columns: { name: true, id: true },
    where: eq(sageMode.name, input.data.name),
  });

/** Build the `sageMode` update for `update`, using predicates on `id`. */
export const updateSageModeForUpdate = (
  client: Pick<DrizzleClient, "update">,
  newData: ZodSageModeType,
  input: { id: string },
) => client.update(sageMode).set(newData).where(eq(sageMode.id, input.id));

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
    tableName: "sageMode",
    changes: diff,
    relatedId: entry.id,
    relatedMsg: `Update: ${entry.name}`,
    relatedImage: entry.image,
  });

/** Build the `userData` update for `removeSageMode`, including predicates on `userId`, `status`, `reputationPoints`. */
export const updateUserDataForRemoveSageMode = (
  client: Pick<DrizzleClient, "update">,
  repCost: number,
  user: { userId: string; sageModeId: string },
  readiness?: ActionReadiness,
) =>
  client
    .update(userData)
    .set({
      ...readiness?.set,
      sageModeId: null,
      reputationPoints: sql`${userData.reputationPoints} - ${repCost}`,
      // Advance the whole-user version so a concurrent claimUserSnapshot CAS detects this write.
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(userData.userId, user.userId),
        readiness?.where ?? eq(userData.status, "AWAKE"),
        gte(userData.reputationPoints, repCost),
        // Compare-and-swap on the current mode: if another request already changed
        // it, rowsAffected is 0 and we abort rather than double-debit reputation.
        eq(userData.sageModeId, user.sageModeId),
      ),
    );

/** Build the `actionLog` insert for `removeSageMode`. */
export const insertActionLogForRemoveSageMode = (
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
    relatedMsg: "SageMode Changed",
    relatedImage: user.avatarLight || user.avatar || IMG_AVATAR_DEFAULT,
  });
