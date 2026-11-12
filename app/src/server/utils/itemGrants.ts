import { nanoid } from "nanoid";
import { getEffectiveStackSize, splitIntoStacks } from "@/libs/item";
import {
  insertUserItems,
  listItemForGrantUserItems,
  updateUserItemForGrantUserItems,
} from "@/queries/item";
import type { DrizzleClient } from "@/server/db";

/**
 * Add granted items to a player's backpack. Grants of one item are combined, fill the
 * stacks the Merge button would combine them with (fullest first, up to the stack size),
 * and the rest opens as few new stacks as the stack size allows. Updates run one after
 * another, each locking only the stack it fills; a stack that changed meanwhile is skipped.
 * @param options.preloaded - Stacks listed earlier by `listItemForGrantUserItems`, for callers
 *   that may not read here; their guarded updates still refuse stacks that changed since
 * @param options.excludeUserItemIds - Stacks the caller removes in the same step
 * @param options.topUpOnly - Leave what does not join a stack out instead of opening stacks
 * @returns The quantities that joined no stack, opened as new stacks unless `topUpOnly`
 */
export const grantUserItems = async (
  client: Pick<DrizzleClient, "select" | "update" | "insert">,
  userId: string,
  grants: ItemGrant[],
  options: GrantOptions = {},
) => {
  const totals = new Map<string, number>();
  for (const grant of grants) {
    totals.set(grant.itemId, (totals.get(grant.itemId) ?? 0) + grant.quantity);
  }
  const unstacked: ItemGrant[] = [];
  if (totals.size === 0) return { unstacked };
  const now = new Date();
  const listed =
    options.preloaded ??
    (await listItemForGrantUserItems(client, userId, [...totals.keys()], now));
  for (const [itemId, total] of totals) {
    const rows = listed.filter((row) => row.itemId === itemId);
    const settings = rows[0];
    // Without the item's settings, keep the caller's own split.
    if (!settings) {
      unstacked.push(...grants.filter((grant) => grant.itemId === itemId));
      continue;
    }
    const stackSize = getEffectiveStackSize(settings);
    const targets = rows
      .flatMap((row) =>
        row.stackId &&
        row.quantity !== null &&
        !options.excludeUserItemIds?.includes(row.stackId)
          ? [{ id: row.stackId, quantity: row.quantity }]
          : [],
      )
      .sort((a, b) => b.quantity - a.quantity || a.id.localeCompare(b.id));
    let remaining = total;
    for (const target of targets) {
      const fill = Math.min(stackSize - target.quantity, remaining);
      if (fill <= 0) continue;
      const result = await updateUserItemForGrantUserItems(
        client,
        userId,
        target.id,
        fill,
        now,
      );
      if (result.rowsAffected === 1) remaining -= fill;
      if (remaining === 0) break;
    }
    unstacked.push(
      ...splitIntoStacks(remaining, stackSize).map((quantity) => ({
        itemId,
        quantity,
      })),
    );
  }
  if (unstacked.length > 0 && !options.topUpOnly) {
    await insertUserItems(
      client,
      unstacked.map((grant) => ({ id: nanoid(), userId, ...grant })),
    );
  }
  return { unstacked };
};

/** A granted quantity of one item. */
export type ItemGrant = { itemId: string; quantity: number };

/** Stacks listed by `listItemForGrantUserItems`. */
export type GrantStackListing = Awaited<ReturnType<typeof listItemForGrantUserItems>>;

type GrantOptions = {
  preloaded?: GrantStackListing;
  excludeUserItemIds?: string[];
  topUpOnly?: boolean;
};
