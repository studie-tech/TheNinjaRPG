/**
 * Database access for hunting; authorization and transaction scopes stay in callers.
 */

import {
  and,
  eq,
  exists,
  gte,
  inArray,
  isNull,
  notExists,
  type SQL,
  sql,
} from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  actionLog,
  huntingHabitat,
  huntingProgress,
  huntingReceipt,
  huntingSession,
  item,
  sectorMap,
  userData,
  userItem,
} from "@/drizzle/schema";
import { nextSnapshotSql } from "@/queries/concurrency";
import type { DrizzleClient } from "@/server/db";
import type { HuntingHabitatContent, HuntingReceipt } from "@/validators/hunting";

/** Build the `huntingSession` selection for `getSession`, using predicates on `userId`. */
export const selectHuntingSessionForGetSession = (
  client: Pick<DrizzleClient, "select">,
  ctx: { userId: string },
) =>
  client
    .select({
      session: huntingSession,
      progress: huntingProgress,
    })
    .from(huntingSession)
    .leftJoin(
      huntingProgress,
      and(
        eq(huntingProgress.userId, huntingSession.userId),
        eq(huntingProgress.contractId, huntingSession.contractId),
      ),
    )
    .where(eq(huntingSession.userId, ctx.userId));

/** Build the `userData` lookup for `getBoard`, using predicates on `userId`. */
export const findUserDataForGetBoard = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
) =>
  client.query.userData.findFirst({
    where: eq(userData.userId, ctx.userId),
    columns: {
      occupation: true,
      huntingExperience: true,
      sector: true,
      status: true,
      autoWakeUp: true,
    },
  });

/** Build the `huntingHabitat` listing. */
export const listHuntingHabitats = (client: Pick<DrizzleClient, "query">) =>
  client.query.huntingHabitat.findMany();

/** Build the `huntingSession` lookup for `user`, using predicates on `userId`. */
export const findHuntingSessionForUser = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
) =>
  client.query.huntingSession.findFirst({
    where: eq(huntingSession.userId, ctx.userId),
  });

/** Build the `huntingProgress` listing for `getBoard`, using predicates on `userId`. */
export const listHuntingProgressForGetBoard = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
) =>
  client.query.huntingProgress.findMany({
    where: eq(huntingProgress.userId, ctx.userId),
  });

/** Build the huntable item catalogue with names and stacking rules. */
export const listHuntableItems = (client: Pick<DrizzleClient, "query">) =>
  client.query.item.findMany({
    columns: { id: true, name: true, canStack: true, stackSize: true },
    where: eq(item.canBeHunted, true),
  });

/** Build the `userData` listing for `getBoard`, using predicates on `isAi`. */
export const listUserDataForGetBoard = (client: Pick<DrizzleClient, "query">) =>
  client.query.userData.findMany({
    where: eq(userData.isAi, true),
    columns: { userId: true, username: true, level: true },
  });

/** Build the `item` listing for `save`, selecting only `id`, using predicates on `id` and `canBeHunted`. */
export const listItemForSave = (
  client: Pick<DrizzleClient, "query">,
  itemIds: string[],
) =>
  client.query.item.findMany({
    where: and(inArray(item.id, itemIds), eq(item.canBeHunted, true)),
    columns: { id: true },
  });

/** Build the `huntingHabitat` update for `save`, setting `content` and `updatedAt`, using predicates on `id`. */
export const updateHuntingHabitatForSave = (
  client: Pick<DrizzleClient, "update">,
  content: HuntingHabitatContent,
  id: string,
) =>
  client
    .update(huntingHabitat)
    .set({
      content,
      // Same-millisecond saves must invalidate admission's captured revision.
      updatedAt: nextSnapshotSql(huntingHabitat.updatedAt),
    })
    .where(eq(huntingHabitat.id, id));

/** Build the `huntingHabitat` insert for `save`. */
export const insertHuntingHabitatForSave = (
  client: Pick<DrizzleClient, "insert">,
  id: string,
  content: HuntingHabitatContent,
) => client.insert(huntingHabitat).values({ id, content, updatedAt: new Date() });

/**
 * Build the `huntingProgress` update for `save`, setting `cooldownUntil` and
 * `version`, including predicates on `contractId`, `used`, `cooldownUntil`.
 */
export const updateHuntingProgressForSave = (
  client: Pick<DrizzleClient, "update" | "select">,
  contract: { cooldownSeconds: number; id: string; hunts: number },
) =>
  client
    .update(huntingProgress)
    .set({
      cooldownUntil: new Date(Date.now() + contract.cooldownSeconds * 1000),
      version: sql`${huntingProgress.version} + 1`,
    })
    .where(
      and(
        eq(huntingProgress.contractId, contract.id),
        gte(huntingProgress.used, contract.hunts),
        isNull(huntingProgress.cooldownUntil),
        // Active contracts keep their allowance and settlement version.
        notExists(
          client
            .select({ userId: huntingSession.userId })
            .from(huntingSession)
            .where(
              and(
                eq(huntingSession.userId, huntingProgress.userId),
                eq(huntingSession.contractId, huntingProgress.contractId),
              ),
            ),
        ),
      ),
    );

/** Build the `actionLog` insert for `save`. */
export const insertActionLogForSave = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  id: string,
  content: HuntingHabitatContent,
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    relatedId: id,
    tableName: "huntingHabitat",
    relatedMsg: "Updated hunting habitat",
    changes: [JSON.stringify(content)],
  });

/** Build the `huntingHabitat` deletion for `delete`, using predicates on `id` and `habitatId`. */
export const deleteHuntingHabitatForDelete = (
  client: Pick<DrizzleClient, "delete" | "select">,
  input: { id: string },
) =>
  client
    .delete(huntingHabitat)
    .where(
      and(
        eq(huntingHabitat.id, input.id),
        notExists(
          client
            .select({ userId: huntingSession.userId })
            .from(huntingSession)
            .where(eq(huntingSession.habitatId, input.id)),
        ),
      ),
    );

/** Build the `huntingHabitat` lookup for `delete`, selecting only `id`, using predicates on `id`. */
export const findHuntingHabitatForDelete = (
  client: Pick<DrizzleClient, "query">,
  input: { id: string },
) =>
  client.query.huntingHabitat.findFirst({
    where: eq(huntingHabitat.id, input.id),
    columns: { id: true },
  });

/** Build the `actionLog` insert for `delete`. */
export const insertActionLogForDelete = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  input: { id: string },
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    relatedId: input.id,
    tableName: "huntingHabitat",
    relatedMsg: "Deleted hunting habitat",
    changes: [],
  });

/** Build the `huntingProgress` lookup for `accept`, using predicates on `userId` and `contractId`. */
export const findHuntingProgressForAccept = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
  input: { contractId: string },
) =>
  client.query.huntingProgress.findFirst({
    where: and(
      eq(huntingProgress.userId, ctx.userId),
      eq(huntingProgress.contractId, input.contractId),
    ),
  });

/** Build published hunting maps for the selected sectors, loading only the sector and normalized map. */
export const listPublishedHuntingMaps = (
  client: Pick<DrizzleClient, "query">,
  sectors: number[],
) =>
  client.query.sectorMap.findMany({
    columns: { sector: true, normalizedJson: true },
    where: and(inArray(sectorMap.sector, sectors), eq(sectorMap.status, "PUBLISHED")),
  });

/** Build the `huntingProgress` insert for `accept`, updating duplicate keys. */
export const insertHuntingProgressForAccept = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  contract: { id: string },
) =>
  client
    .insert(huntingProgress)
    .values({ userId: ctx.userId, contractId: contract.id })
    .onDuplicateKeyUpdate({ set: { contractId: contract.id } });

/** Execute the database statement for `accept`. */
export const executeSavedForAccept = (
  client: Pick<DrizzleClient, "execute">,
  session: typeof huntingSession.$inferSelect | undefined,
  next: {
    id: string;
    habitatId: string;
    contractId: string;
    content: HuntingHabitatContent;
    sector: number;
    startedAt: Date;
    version: number;
  },
  previousContract: undefined | import("@/validators/hunting").HuntingContract,
  ctx: { userId: string },
  targetHabitatGuard: undefined | SQL<unknown>,
  previousHabitat: undefined | typeof huntingHabitat.$inferSelect,
) =>
  client.execute(
    session
      ? sql`
              UPDATE ${huntingSession} AS s
              LEFT JOIN ${huntingProgress} AS p
                ON p.userId = s.userId AND p.contractId = s.contractId
              SET s.id = ${next.id}, s.habitatId = ${next.habitatId},
                  s.contractId = ${next.contractId}, s.content = ${JSON.stringify(next.content)},
                  s.sector = ${next.sector}, s.readyAt = NULL, s.battleId = NULL,
                  s.lastResult = NULL, s.startedAt = ${next.startedAt}, s.version = ${next.version},
                  p.version = p.version + 1,
                  p.cooldownUntil = ${
                    previousContract
                      ? sql`CASE WHEN p.used >= ${previousContract.hunts} AND p.cooldownUntil IS NULL
                        THEN ${new Date(Date.now() + previousContract.cooldownSeconds * 1000)}
                        ELSE p.cooldownUntil END`
                      : sql`p.cooldownUntil`
                  }
              WHERE s.userId = ${ctx.userId} AND s.id = ${session.id}
                AND s.version = ${session.version} AND s.battleId IS NULL
                AND EXISTS (SELECT 1 FROM ${huntingHabitat} WHERE ${targetHabitatGuard})
                AND ${
                  previousHabitat
                    ? sql`EXISTS (SELECT 1 FROM ${huntingHabitat} WHERE ${huntingHabitat.id} = ${session.habitatId} AND ${huntingHabitat.updatedAt} = ${previousHabitat.updatedAt})`
                    : sql`NOT EXISTS (SELECT 1 FROM ${huntingHabitat} WHERE ${huntingHabitat.id} = ${session.habitatId})`
                }
            `
      : sql`
                INSERT INTO ${huntingSession}
                  (userId, id, habitatId, contractId, content, sector, readyAt,
                   battleId, version, startedAt, lastResult)
                SELECT ${ctx.userId}, ${next.id}, ${next.habitatId}, ${next.contractId},
                       ${JSON.stringify(next.content)}, ${next.sector}, NULL, NULL,
                       ${next.version}, ${next.startedAt}, NULL
                FROM ${huntingHabitat} WHERE ${targetHabitatGuard}
              `,
  );

/** Build the `huntingSession` deletion for `sessionAction`, using the configured predicates. */
export const deleteHuntingSessionForSessionAction = (
  client: Pick<DrizzleClient, "delete">,
  guard: undefined | SQL<unknown>,
) => client.delete(huntingSession).where(guard);

/**
 * Build the `huntingSession` update for `sessionAction`, setting `readyAt` and
 * `version`, using the configured predicates.
 */
export const updateHuntingSessionForSessionAction = (
  client: Pick<DrizzleClient, "update">,
  contract: { preparationSeconds: number },
  guard: undefined | SQL<unknown>,
) =>
  client
    .update(huntingSession)
    .set({
      readyAt: new Date(Date.now() + contract.preparationSeconds * 1000),
      version: sql`${huntingSession.version} + 1`,
    })
    .where(guard);

/** Build the `huntingHabitat` lookup for `reconcileInactiveAllowance`, using predicates on `id`. */
export const findHuntingHabitatForReconcileInactiveAllowance = (
  client: Pick<DrizzleClient, "query">,
  habitatId: string,
) =>
  client.query.huntingHabitat.findFirst({
    where: eq(huntingHabitat.id, habitatId),
  });

/**
 * Build the `huntingProgress` update for `reconcileInactiveAllowance`, setting
 * `cooldownUntil` and `version`, including predicates on `userId`, `id`, `updatedAt`.
 */
export const updateHuntingProgressForReconcileInactiveAllowance = (
  client: Pick<DrizzleClient, "update" | "select">,
  contract: { cooldownSeconds: number; id: string; hunts: number },
  userId: string,
  habitatId: string,
  habitat: { updatedAt: Date },
) =>
  client
    .update(huntingProgress)
    .set({
      cooldownUntil: new Date(Date.now() + contract.cooldownSeconds * 1000),
      version: sql`${huntingProgress.version} + 1`,
    })
    .where(
      and(
        eq(huntingProgress.userId, userId),
        exists(
          client
            .select({ id: huntingHabitat.id })
            .from(huntingHabitat)
            .where(
              and(
                eq(huntingHabitat.id, habitatId),
                eq(huntingHabitat.updatedAt, habitat.updatedAt),
              ),
            ),
        ),
        eq(huntingProgress.contractId, contract.id),
        gte(huntingProgress.used, contract.hunts),
        isNull(huntingProgress.cooldownUntil),
        notExists(
          client
            .select({ userId: huntingSession.userId })
            .from(huntingSession)
            .where(
              and(
                eq(huntingSession.userId, userId),
                eq(huntingSession.contractId, contract.id),
              ),
            ),
        ),
      ),
    );

/** Build the `huntingSession` update for `settleHuntingBattle`, including predicates on `userId`, `id`, `version`. */
export const updateHuntingSessionForSettleHuntingBattle = (
  client: Pick<DrizzleClient, "update">,
  receipt: import("@/validators/hunting").HuntingReceipt,
  meta: { userId: string; sessionId: string; sessionVersion: number },
  current: { id: string },
) =>
  client
    .update(huntingSession)
    .set({
      battleId: null,
      lastResult: receipt,
      version: sql`${huntingSession.version} + 1`,
    })
    .where(
      and(
        eq(huntingSession.userId, meta.userId),
        eq(huntingSession.id, meta.sessionId),
        eq(huntingSession.version, meta.sessionVersion + 1),
        eq(huntingSession.battleId, current.id),
      ),
    );

/** Build the `huntingProgress` update for `settleHuntingBattle`, using predicates on `userId`, `contractId`, `version`. */
export const updateHuntingProgressForSettleHuntingBattle = (
  client: Pick<DrizzleClient, "update">,
  meta: {
    used: number;
    userId: string;
    contract: { id: string };
    progressVersion: number;
  },
  receipt: { cooldownUntil: null | string },
) =>
  client
    .update(huntingProgress)
    .set({
      used: meta.used + 1,
      cooldownUntil: receipt.cooldownUntil ? new Date(receipt.cooldownUntil) : null,
      version: sql`${huntingProgress.version} + 1`,
    })
    .where(
      and(
        eq(huntingProgress.userId, meta.userId),
        eq(huntingProgress.contractId, meta.contract.id),
        eq(huntingProgress.version, meta.progressVersion),
      ),
    );

/** Build the `userItem` insert for `settleHuntingBattle`. */
export const insertUserItemForSettleHuntingBattle = (
  client: Pick<DrizzleClient, "insert">,
  receipt: {
    materials: HuntingReceipt["materials"];
  },
  meta: { materialStacks: Record<string, number>; userId: string },
) =>
  client.insert(userItem).values(
    receipt.materials.flatMap((m) =>
      Array.from(
        {
          length: Math.ceil(m.quantity / (meta.materialStacks[m.itemId] ?? 1)),
        },
        (_, index) => ({
          id: nanoid(),
          userId: meta.userId,
          itemId: m.itemId,
          quantity: Math.min(
            meta.materialStacks[m.itemId] ?? 1,
            m.quantity - index * (meta.materialStacks[m.itemId] ?? 1),
          ),
        }),
      ),
    ),
  );

/** Build the `huntingReceipt` insert for `settleHuntingBattle`. */
export const insertHuntingReceiptForSettleHuntingBattle = (
  client: Pick<DrizzleClient, "insert">,
  current: { id: string },
  meta: { userId: string; contract: { id: string } },
  receipt: import("@/validators/hunting").HuntingReceipt,
) =>
  client.insert(huntingReceipt).values({
    battleId: current.id,
    userId: meta.userId,
    contractId: meta.contract.id,
    result: receipt,
    createdAt: new Date(),
  });
