import * as Sentry from "@sentry/nextjs";
import { isNull, type SQL } from "drizzle-orm";
import { userData } from "@/drizzle/schema";
import { getEffectiveStackSize } from "@/libs/item";
import { listUserItemForMergeAllStacks } from "@/queries/item";
import { executeMergeStacksForItem } from "@/routers/item";
import type { DrizzleClient } from "@/server/db";
import { groupBy } from "@/utils/grouping";

/**
 * Owners without an active battle. A battle owns the player's inventory until it settles, so
 * stacks that come together during one stay apart for the Merge button.
 */
export const ownerOutOfBattle = (): SQL => isNull(userData.battleId);

/**
 * Merge a player's stacks of the given items, carried or at home, by the Merge button's rules.
 * Callers run it after the change that brought the stacks together has committed, so a merge
 * that loses a race or fails leaves the stacks apart for the Merge button.
 * @param ownerWhere - Owner states that may merge, checked when the stacks are claimed
 * @returns The confirmed quantity changes, or undefined when a merge did not complete
 */
export const mergeUserItemStacks = async (
  client: DrizzleClient,
  userId: string,
  itemIds: Iterable<string>,
  storedAtHome: boolean,
  ownerWhere: SQL,
) => {
  const wanted = new Set(itemIds);
  if (wanted.size === 0) return [];
  try {
    const rows = await listUserItemForMergeAllStacks(client, { userId }, storedAtHome, [
      ...wanted,
    ]);
    // Every merge settles before the caller answers, so a client that reads the inventory
    // again after a failed merge sees what the others did.
    const settled = await Promise.allSettled(
      [
        ...groupBy(
          rows.filter((row) => row.item && getEffectiveStackSize(row.item) > 1),
          "itemId",
        ),
      ].map(([itemId, itemRows]) =>
        executeMergeStacksForItem(
          client,
          userId,
          itemId,
          { userItems: itemRows, item: itemRows[0]?.item },
          ownerWhere,
        ),
      ),
    );
    const failure = settled.find((result) => result.status === "rejected");
    if (failure) throw failure.reason;
    const results = settled.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );
    return results.every((result) => result.success && result.inventoryChanges)
      ? results.flatMap((result) => result.inventoryChanges ?? [])
      : undefined;
  } catch (error) {
    Sentry.captureException(error, { tags: { source: "mergeUserItemStacks" } });
    return undefined;
  }
};
