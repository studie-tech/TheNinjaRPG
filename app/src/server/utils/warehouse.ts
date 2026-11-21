import { eq, isNull, lte, or } from "drizzle-orm";
import {
  userItem,
  type VillageStructure,
  type VillageWarehouse,
} from "@/drizzle/schema";
import {
  getCycleQuantity,
  getDueProduction,
  getWarehouseLevel,
} from "@/libs/warehouse";
import { hasNoBattleWhere } from "@/queries/item";
import {
  ensureWarehouseStock,
  findVillageWarehouse,
  insertVillageWarehouse,
  insertWarehouseLogs,
  settleWarehouseProduction,
} from "@/queries/warehouse";
import type { DrizzleClient } from "@/server/db";
import { userItemQuantityWhere } from "@/server/utils/concurrency";
import { getRaidStructureMultiplier } from "@/utils/village";

/** Rolls back a Warehouse or caravan transaction with a player-facing message. */
export class WarehouseConflict extends Error {}

/**
 * The guard on a deposited stack: it still holds what was read and is carried and unequipped,
 * and its owner is in no battle, whose settlement writes the stack's own quantity back.
 */
export const depositStackWhere = (input: {
  userId: string;
  userItemId: string;
  expectedQuantity: number;
  now: Date;
}) =>
  userItemQuantityWhere({
    ...input,
    where: [
      eq(userItem.storedAtHome, false),
      eq(userItem.isInAuction, false),
      eq(userItem.equipped, "NONE"),
      or(
        isNull(userItem.craftingFinishedAt),
        lte(userItem.craftingFinishedAt, input.now),
      ),
      hasNoBattleWhere(input.userId),
    ],
  });

/**
 * Credit every production cycle due since the last settlement and return the settings, with
 * `settled` set when cycles were due and stock may have changed. Readers race through a
 * guarded clock update; whoever loses rereads the winner's row. An unbuilt Warehouse only
 * advances its clock, so building it never pays out idle time. A caller that already read
 * the settings passes them as `current`.
 */
export const settleProduction = async (
  client: DrizzleClient,
  villageId: string,
  structure: VillageStructure | undefined,
  now = new Date(),
  current?: VillageWarehouse,
) => {
  let row = current ?? (await findVillageWarehouse(client, villageId));
  if (!row) {
    await insertVillageWarehouse(client, villageId, now);
    row = await findVillageWarehouse(client, villageId);
    if (!row) throw new Error("Warehouse settings could not be created");
  }
  const due = getDueProduction(row.productionSettledAt, now);
  if (due.nextSettledAt.getTime() === row.productionSettledAt.getTime())
    return { ...row, settled: false };
  const level = getWarehouseLevel(structure, now);
  const multiplier = structure ? getRaidStructureMultiplier(structure, now) : 1;
  const itemIds = level > 0 ? row.productionItemIds : [];
  const quantity = due.cycles * getCycleQuantity(level, multiplier);
  await ensureWarehouseStock(client, villageId, itemIds);
  const result = await settleWarehouseProduction(client, {
    villageId,
    itemIds,
    quantity,
    settledAt: row.productionSettledAt,
    nextSettledAt: due.nextSettledAt,
    updatedAt: row.updatedAt,
  });
  if (result.rowsAffected > 0) {
    if (quantity > 0)
      await insertWarehouseLogs(
        client,
        itemIds.map((itemId) => ({ villageId, itemId, type: "PRODUCTION", quantity })),
        now,
      );
    return { ...row, productionSettledAt: due.nextSettledAt, settled: true };
  }
  return { ...((await findVillageWarehouse(client, villageId)) ?? row), settled: true };
};
