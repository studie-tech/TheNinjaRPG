/**
 * Database access for title; authorization and transaction scopes stay in callers.
 */

import { and, asc, eq, exists, inArray, isNull, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { actionLog, title, userData, userTitle } from "@/drizzle/schema";
import { nextSnapshotSql } from "@/queries/concurrency";
import type { DrizzleClient } from "@/server/db";

/** A public, non-archived title that may be granted, optionally only from `ids`. */
export const grantableTitleWhere = (ids?: string[]) =>
  and(
    ids ? inArray(title.id, ids) : undefined,
    eq(title.archived, false),
    isNull(title.legacyOwnerId),
  );

/** Build the `userData` update for `grant`, setting `updatedAt`, using predicates on `userId`. */
export const updateUserDataForGrant = (
  client: Pick<DrizzleClient, "update">,
  userId: string,
) =>
  client
    .update(userData)
    .set({
      updatedAt: nextSnapshotSql(userData.updatedAt),
    })
    .where(eq(userData.userId, userId));

/**
 * Build the `userTitle` insert from `title` for `grant`, using predicates on `id`,
 * `archived`, `legacyOwnerId`, updating duplicate keys.
 */
export const insertUserTitleForGrant = (
  client: Pick<DrizzleClient, "insert" | "select">,
  userId: string,
  ids: string[],
) =>
  client
    .insert(userTitle)
    .select(
      client
        .select({
          userId: sql<string>`${userId}`.as("userId"),
          titleId: title.id,
          effects: title.effects,
          createdAt: sql<Date>`CURRENT_TIMESTAMP(3)`.as("createdAt"),
        })
        .from(title)
        .where(grantableTitleWhere(ids)),
    )
    .onDuplicateKeyUpdate({ set: { userId: sql`${userTitle.userId}` } });

/** Build the `title` selection for `validateTitleRewardIds`, using predicates on `id`, `legacyOwnerId`, `archived`. */
export const selectTitleForValidateTitleRewardIds = (
  client: Pick<DrizzleClient, "select">,
  ids: string[],
) => client.select({ id: title.id }).from(title).where(grantableTitleWhere(ids));

/** Build the `title` listing for `getAllNames`, using predicates on `legacyOwnerId` and `archived`. */
export const listTitleForGetAllNames = (client: Pick<DrizzleClient, "query">) =>
  client.query.title.findMany({
    where: grantableTitleWhere(),
    orderBy: asc(title.name),
  });

/** Build the `title` listing for `getAll`, using predicates on `legacyOwnerId`. */
export const listTitleForGetAll = (client: Pick<DrizzleClient, "query">) =>
  client.query.title.findMany({
    where: isNull(title.legacyOwnerId),
    orderBy: asc(title.name),
  });

/** Build the `title` lookup for `get`, using predicates on `id` and `legacyOwnerId`. */
export const findTitleForGet = (
  client: Pick<DrizzleClient, "query">,
  input: { id: string },
) =>
  client.query.title.findFirst({
    where: and(eq(title.id, input.id), isNull(title.legacyOwnerId)),
  });

/**
 * Build the `userData` update for `select`, setting `activeTitleId`, including
 * predicates on `userId`, `isBanned`, `isAi`.
 */
export const updateUserDataForSelect = (
  client: Pick<DrizzleClient, "update" | "select">,
  input: { titleId: null | string },
  ctx: { userId: string },
) =>
  client
    .update(userData)
    .set({ activeTitleId: input.titleId })
    .where(
      and(
        eq(userData.userId, ctx.userId),
        eq(userData.isBanned, false),
        eq(userData.isAi, false),
        input.titleId
          ? exists(
              client
                .select({ id: userTitle.titleId })
                .from(userTitle)
                .where(
                  and(
                    eq(userTitle.userId, ctx.userId),
                    eq(userTitle.titleId, input.titleId),
                  ),
                ),
            )
          : undefined,
      ),
    );

/** Build the `title` insert for `create`. */
export const insertTitleForCreate = (
  client: Pick<DrizzleClient, "insert">,
  id: string,
) => client.insert(title).values({ id, name: `New Title - ${id}` });

/** Build the `actionLog` insert for `create`. */
export const insertActionLogForCreate = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  id: string,
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "title",
    relatedId: id,
    relatedMsg: "Create title",
    changes: ["Created title"],
  });

/** Build the `title` update for `archive`, setting `archived` and `updatedAt`, using predicates on `id`. */
export const updateTitleForArchive = (
  client: Pick<DrizzleClient, "update">,
  entry: { id: string },
) =>
  client
    .update(title)
    .set({ archived: true, updatedAt: new Date() })
    .where(eq(title.id, entry.id));

/** Build the `actionLog` insert for `archive`. */
export const insertActionLogForArchive = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  entry: { id: string; name: string },
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "title",
    relatedId: entry.id,
    relatedMsg: `Archive: ${entry.name}`,
    changes: ["Archived title"],
  });

/** Build the `title` update for `update`, setting `updatedAt`, using predicates on `id` and `legacyOwnerId`. */
export const updateTitleForUpdate = (
  client: Pick<DrizzleClient, "update">,
  input: { data: import("@/validators/title").TitleData; id: string },
) =>
  client
    .update(title)
    .set({ ...input.data, updatedAt: new Date() })
    .where(and(eq(title.id, input.id), isNull(title.legacyOwnerId)));

/** Build the `actionLog` insert for `update`. */
export const insertActionLogForUpdate = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  entry: { id: string },
  input: { data: { name: string } },
  diff: string[],
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "title",
    relatedId: entry.id,
    relatedMsg: `Update: ${input.data.name}`,
    changes: diff,
  });
