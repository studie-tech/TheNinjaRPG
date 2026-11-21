/**
 * Database access for village Warehouses; authorization and transaction scopes stay in callers.
 */
import {
  and,
  desc,
  eq,
  inArray,
  isNull,
  lt,
  lte,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { nanoid } from "nanoid";
import type { WarehouseLogType } from "@/drizzle/constants";
import {
  item,
  userData,
  village,
  villageWarehouse,
  war,
  warehouseDepositLedger,
  warehouseLog,
  warehouseMember,
  warehouseStock,
} from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";

/** A village or settlement that can own Warehouse items, with its type. */
export const findWarehouseVillage = (
  client: Pick<DrizzleClient, "query">,
  villageId: string,
) =>
  client.query.village.findFirst({
    columns: { id: true, type: true, name: true },
    where: and(
      eq(village.id, villageId),
      inArray(village.type, ["VILLAGE", "OUTLAW", "HIDEOUT", "STRONGHOLD"]),
    ),
  });

/** Production settings of a village's Warehouse. */
export const findVillageWarehouse = (
  client: Pick<DrizzleClient, "query">,
  villageId: string,
) =>
  client.query.villageWarehouse.findFirst({
    where: eq(villageWarehouse.villageId, villageId),
  });

/** Start the production clock of a Warehouse that has none yet. */
export const insertVillageWarehouse = (
  client: Pick<DrizzleClient, "insert">,
  villageId: string,
  now: Date,
) =>
  client
    .insert(villageWarehouse)
    .values({
      villageId,
      productionItemIds: [],
      productionSettledAt: now,
      updatedAt: now,
    })
    .onDuplicateKeyUpdate({ set: { villageId: sql`${villageWarehouse.villageId}` } });

/** Stock rows of a Warehouse with the item details the page shows. */
export const listWarehouseStock = (
  client: Pick<DrizzleClient, "select">,
  villageId: string,
) =>
  client
    .select({
      itemId: warehouseStock.itemId,
      quantity: warehouseStock.quantity,
      reserved: warehouseStock.reserved,
      name: item.name,
      image: item.image,
      itemType: item.itemType,
      rarity: item.rarity,
      stackSize: item.stackSize,
      canStack: item.canStack,
    })
    .from(warehouseStock)
    .innerJoin(item, eq(item.id, warehouseStock.itemId))
    .where(eq(warehouseStock.villageId, villageId))
    .orderBy(item.name);

/** Items marked for Warehouses that a village owns, for the Kage's production choice. */
export const listProducibleItems = (
  client: Pick<DrizzleClient, "select">,
  productionVillageId: string,
) =>
  client
    .select({
      id: item.id,
      name: item.name,
      image: item.image,
      itemType: item.itemType,
      canStack: item.canStack,
      warehouseItem: item.warehouseItem,
      villageId: item.villageId,
      hidden: item.hidden,
    })
    .from(item)
    .where(
      and(
        eq(item.warehouseItem, true),
        eq(item.villageId, productionVillageId),
        eq(item.hidden, false),
      ),
    )
    .orderBy(item.name);

/** Warehouse eligibility of specific items. */
export const listWarehouseItems = (
  client: Pick<DrizzleClient, "select">,
  itemIds: string[],
) =>
  itemIds.length === 0
    ? Promise.resolve([])
    : client
        .select({
          id: item.id,
          name: item.name,
          image: item.image,
          itemType: item.itemType,
          rarity: item.rarity,
          canStack: item.canStack,
          stackSize: item.stackSize,
          warehouseItem: item.warehouseItem,
          villageId: item.villageId,
          hidden: item.hidden,
          isEventItem: item.isEventItem,
        })
        .from(item)
        .where(inArray(item.id, itemIds));

/** Create empty stock rows so production and deliveries can add to them in place. */
export const ensureWarehouseStock = (
  client: Pick<DrizzleClient, "insert">,
  villageId: string,
  itemIds: string[],
) =>
  itemIds.length === 0
    ? Promise.resolve()
    : client
        .insert(warehouseStock)
        .values(itemIds.map((itemId) => ({ villageId, itemId })))
        .onDuplicateKeyUpdate({ set: { itemId: sql`${warehouseStock.itemId}` } });

/**
 * Credit due production and advance the clock in one guarded statement, so concurrent
 * readers settle each cycle once. The settings revision must match the selection read.
 */
export const settleWarehouseProduction = (
  client: Pick<DrizzleClient, "execute">,
  input: {
    villageId: string;
    itemIds: string[];
    quantity: number;
    settledAt: Date;
    nextSettledAt: Date;
    updatedAt: Date;
  },
) =>
  client.execute(sql`
    UPDATE ${villageWarehouse}
    ${
      input.itemIds.length > 0 && input.quantity > 0
        ? sql`INNER JOIN ${warehouseStock} ON ${warehouseStock.villageId} = ${villageWarehouse.villageId} AND ${inArray(warehouseStock.itemId, input.itemIds)}`
        : sql``
    }
    SET ${villageWarehouse.productionSettledAt} = ${input.nextSettledAt}
    ${
      input.itemIds.length > 0 && input.quantity > 0
        ? sql`, ${warehouseStock.quantity} = ${warehouseStock.quantity} + ${input.quantity}`
        : sql``
    }
    WHERE ${villageWarehouse.villageId} = ${input.villageId}
      AND ${villageWarehouse.productionSettledAt} = ${input.settledAt}
      AND ${villageWarehouse.updatedAt} = ${input.updatedAt}
  `);

/** Replace the production selection if it is unchanged since it was read. */
export const updateWarehouseProduction = (
  client: Pick<DrizzleClient, "update">,
  villageId: string,
  itemIds: string[],
  expectedUpdatedAt: Date,
  now: Date,
) =>
  client
    .update(villageWarehouse)
    .set({ productionItemIds: itemIds, updatedAt: now })
    .where(
      and(
        eq(villageWarehouse.villageId, villageId),
        eq(villageWarehouse.updatedAt, expectedUpdatedAt),
      ),
    );

/** A player's deposit ledgers. */
export const listDepositLedgers = (
  client: Pick<DrizzleClient, "select">,
  userId: string,
) =>
  client
    .select()
    .from(warehouseDepositLedger)
    .where(eq(warehouseDepositLedger.userId, userId));

/** Create a player's ledger for an item so a deposit can claim it with a guarded update. */
export const ensureDepositLedger = (
  client: Pick<DrizzleClient, "insert">,
  userId: string,
  itemId: string,
) =>
  client
    .insert(warehouseDepositLedger)
    .values({ userId, itemId })
    .onDuplicateKeyUpdate({ set: { userId: sql`${warehouseDepositLedger.userId}` } });

/** Claim the deposit cooldown and bonus state read for this deposit. */
export const claimDepositLedger = (
  client: Pick<DrizzleClient, "update">,
  input: {
    userId: string;
    itemId: string;
    cooldownStart: Date;
    now: Date;
    expected: { withdrawnUnits: number; bonusCarry: number };
    next: { withdrawnUnits: number; bonusCarry: number };
  },
) =>
  client
    .update(warehouseDepositLedger)
    .set({ lastDepositAt: input.now, ...input.next })
    .where(
      and(
        eq(warehouseDepositLedger.userId, input.userId),
        eq(warehouseDepositLedger.itemId, input.itemId),
        or(
          isNull(warehouseDepositLedger.lastDepositAt),
          lte(warehouseDepositLedger.lastDepositAt, input.cooldownStart),
        ),
        eq(warehouseDepositLedger.withdrawnUnits, input.expected.withdrawnUnits),
        eq(warehouseDepositLedger.bonusCarry, input.expected.bonusCarry),
      ),
    );

/** Record withdrawn units, which earn no deposit bonus when they come back. */
export const addWithdrawnUnits = (
  client: Pick<DrizzleClient, "insert">,
  userId: string,
  itemId: string,
  quantity: number,
) =>
  client
    .insert(warehouseDepositLedger)
    .values({ userId, itemId, withdrawnUnits: quantity })
    .onDuplicateKeyUpdate({
      set: {
        withdrawnUnits: sql`${warehouseDepositLedger.withdrawnUnits} + ${quantity}`,
      },
    });

/** Add stock lines to a Warehouse in one statement; repeated items add up. */
export const creditWarehouseStock = (
  client: Pick<DrizzleClient, "insert">,
  villageId: string,
  lines: { itemId: string; quantity: number }[],
) =>
  lines.length === 0
    ? Promise.resolve()
    : client
        .insert(warehouseStock)
        .values(
          lines.map((line) => ({
            villageId,
            itemId: line.itemId,
            quantity: line.quantity,
          })),
        )
        .onDuplicateKeyUpdate({
          set: {
            quantity: sql`${warehouseStock.quantity} + VALUES(${warehouseStock.quantity})`,
          },
        });

/** A player's Warehouse membership row. */
export const findWarehouseMember = (
  client: Pick<DrizzleClient, "query">,
  userId: string,
) =>
  client.query.warehouseMember.findFirst({ where: eq(warehouseMember.userId, userId) });

/**
 * Create a player's membership row or start their allowance on a new UTC day, before a
 * withdrawal counts against it. A request still dated an earlier day never rewinds it, and
 * its claim then fails on the day guard. The used count resets first, while the day it
 * compares still holds the stored value.
 */
export const startWarehouseAllowanceDay = (
  client: Pick<DrizzleClient, "execute">,
  userId: string,
  day: string,
) => {
  const isNewDay = sql`(${warehouseMember.allowanceDay} IS NULL OR ${warehouseMember.allowanceDay} < ${day})`;
  return client.execute(sql`
    INSERT INTO ${warehouseMember} (userId, allowanceDay, allowanceUsed)
    VALUES (${userId}, ${day}, 0)
    ON DUPLICATE KEY UPDATE
      ${warehouseMember.allowanceUsed} = IF(${isNewDay}, 0, ${warehouseMember.allowanceUsed}),
      ${warehouseMember.allowanceDay} = IF(${isNewDay}, ${day}, ${warehouseMember.allowanceDay})
  `);
};

/**
 * Take unreserved stock and count it against the player's allowance for the UTC day in one
 * statement, so concurrent withdrawals cannot exceed either. The day is started first. An
 * allowance raised by a Kage approval, given as `approvedAt`, needs that approval to still
 * stand in this village.
 */
export const claimWithdrawal = (
  client: Pick<DrizzleClient, "execute">,
  input: {
    villageId: string;
    itemId: string;
    userId: string;
    quantity: number;
    day: string;
    allowance: number;
    approvedAt: Date | null;
  },
) =>
  client.execute(sql`
    UPDATE ${warehouseStock}
    INNER JOIN ${warehouseMember} ON ${warehouseMember.userId} = ${input.userId}
    SET ${warehouseStock.quantity} = ${warehouseStock.quantity} - ${input.quantity},
        ${warehouseMember.allowanceUsed} = ${warehouseMember.allowanceUsed} + ${input.quantity}
    WHERE ${warehouseStock.villageId} = ${input.villageId}
      AND ${warehouseStock.itemId} = ${input.itemId}
      AND ${warehouseStock.quantity} >= ${warehouseStock.reserved} + ${input.quantity}
      AND ${warehouseMember.allowanceDay} = ${input.day}
      AND ${warehouseMember.allowanceUsed} + ${input.quantity} <= ${input.allowance}
      ${
        input.approvedAt
          ? sql`AND ${warehouseMember.approvedVillageId} = ${input.villageId}
      AND ${warehouseMember.approvedAt} = ${sql.param(input.approvedAt, warehouseMember.approvedAt)}`
          : sql``
      }
  `);

/** Grant or replace a player's Kage approval. */
export const approveWarehouseMember = (
  client: Pick<DrizzleClient, "insert">,
  input: {
    userId: string;
    villageId: string;
    approvedById: string;
    warId: string | null;
    now: Date;
  },
) => {
  const values = {
    approvedVillageId: input.villageId,
    approvedAt: input.now,
    approvedWarId: input.warId,
    approvedById: input.approvedById,
  };
  return client
    .insert(warehouseMember)
    .values({ userId: input.userId, ...values })
    .onDuplicateKeyUpdate({ set: values });
};

/** Withdraw a player's approval from this village. */
export const revokeWarehouseMember = (
  client: Pick<DrizzleClient, "update">,
  userId: string,
  villageId: string,
) =>
  client
    .update(warehouseMember)
    .set({
      approvedVillageId: null,
      approvedAt: null,
      approvedWarId: null,
      approvedById: null,
    })
    .where(
      and(
        eq(warehouseMember.userId, userId),
        eq(warehouseMember.approvedVillageId, villageId),
      ),
    );

/** Approved players of a village who are still its members. */
export const listWarehouseApprovals = (
  client: Pick<DrizzleClient, "select">,
  villageId: string,
) =>
  client
    .select({
      userId: warehouseMember.userId,
      approvedAt: warehouseMember.approvedAt,
      approvedWarId: warehouseMember.approvedWarId,
      username: userData.username,
      avatar: userData.avatar,
      rank: userData.rank,
      anbuId: userData.anbuId,
      villageId: userData.villageId,
      joinedVillageAt: userData.joinedVillageAt,
    })
    .from(warehouseMember)
    .innerJoin(userData, eq(userData.userId, warehouseMember.userId))
    .where(
      and(
        eq(warehouseMember.approvedVillageId, villageId),
        eq(userData.villageId, villageId),
      ),
    );

/** Append Warehouse history rows; callers that report a row back give its id. */
export const insertWarehouseLogs = (
  client: Pick<DrizzleClient, "insert">,
  entries: {
    id?: string;
    villageId: string;
    userId?: string | null;
    itemId?: string | null;
    type: WarehouseLogType;
    quantity: number;
  }[],
  now: Date,
) =>
  entries.length === 0
    ? Promise.resolve()
    : client.insert(warehouseLog).values(
        entries.map((entry) => ({
          id: entry.id ?? nanoid(),
          villageId: entry.villageId,
          userId: entry.userId ?? null,
          itemId: entry.itemId ?? null,
          type: entry.type,
          quantity: entry.quantity,
          createdAt: now,
        })),
      );

/** One page of a Warehouse's history, newest first. */
export const listWarehouseLogs = (
  client: Pick<DrizzleClient, "select">,
  villageId: string,
  limit: number,
  cursor?: { createdAt: Date; id: string },
) =>
  client
    .select({
      id: warehouseLog.id,
      type: warehouseLog.type,
      quantity: warehouseLog.quantity,
      createdAt: warehouseLog.createdAt,
      itemName: item.name,
      username: userData.username,
    })
    .from(warehouseLog)
    .leftJoin(item, eq(item.id, warehouseLog.itemId))
    .leftJoin(userData, eq(userData.userId, warehouseLog.userId))
    .where(
      and(
        eq(warehouseLog.villageId, villageId),
        cursor
          ? or(
              lt(warehouseLog.createdAt, cursor.createdAt),
              and(
                eq(warehouseLog.createdAt, cursor.createdAt),
                lt(warehouseLog.id, cursor.id),
              ),
            )
          : undefined,
      ),
    )
    .orderBy(desc(warehouseLog.createdAt), desc(warehouseLog.id))
    .limit(limit + 1);

/**
 * Destroy a share of a raided Warehouse's unreserved stock together with the war receipt
 * step, so a retried settlement cannot destroy it twice.
 */
export const destroyRaidedWarehouseStock = (
  client: Pick<DrizzleClient, "execute">,
  villageId: string,
  percent: number,
  stepGuard: SQL,
) =>
  client.execute(sql`
    UPDATE ${war}
    LEFT JOIN ${warehouseStock} ON ${warehouseStock.villageId} = ${villageId}
    SET ${war.settlement} = JSON_SET(${war.settlement}, '$.warehouseDelivered', true),
        ${warehouseStock.quantity} = ${warehouseStock.quantity} - FLOOR((${warehouseStock.quantity} - ${warehouseStock.reserved}) * ${percent} / 100)
    WHERE ${stepGuard}
  `);

/** Wars still being fought, for wartime approvals and trade between warring villages. */
export const listOpenWars = (client: Pick<DrizzleClient, "select">) =>
  client
    .select({
      id: war.id,
      attackerVillageId: war.attackerVillageId,
      defenderVillageId: war.defenderVillageId,
    })
    .from(war)
    .where(and(eq(war.status, "ACTIVE"), isNull(war.endedAt)));
