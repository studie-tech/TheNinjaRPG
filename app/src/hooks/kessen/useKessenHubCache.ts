"use client";

import { getQueryKey } from "@trpc/react-query";
import { useCallback } from "react";
import { api } from "@/app/_trpc/client";
import { getKessenHubWithGrants, kessenGrantsPacks } from "@/deltas/kessen";
import { useQueryCacheUpdate } from "@/hooks/useQueryCacheUpdate";
import type { KessenHub } from "@/validators/kessen";

/**
 * The Card Hall hub cache (`kessen.getHub`) for mutations anywhere in the game: a
 * snapshot taken when a mutation starts, its confirmed update and granted cards credited
 * to the owned copies.
 */
export const useKessenHubCache = () => {
  const { prepareUpdate, updateCache } = useQueryCacheUpdate<KessenHub>(
    getQueryKey(api.kessen.getHub, undefined, "query"),
  );
  const utils = api.useUtils();
  // Granted packs add stacks whose ids only a hub read names.
  const creditHubGrants = useCallback(
    (
      granted: readonly { itemId: string; quantity: number }[],
      snapshot: ReturnType<typeof prepareUpdate>,
    ) =>
      kessenGrantsPacks(granted)
        ? utils.kessen.getHub.invalidate()
        : updateCache((hub) => getKessenHubWithGrants(hub, granted), snapshot),
    [updateCache, utils],
  );
  return {
    prepareHubUpdate: prepareUpdate,
    updateHub: updateCache,
    creditHubGrants,
  };
};

/**
 * The hub counts free and listed card copies and lists pack stacks (consumables), so a
 * mutation that moved cards or consumables outside the Card Hall (sold, listed, bought or
 * returned at the auction house) has it read again; other item types leave it alone.
 * Item and auction flows use this alone, without the hub's key.
 */
export const useKessenCardMoves = () => {
  const utils = api.useUtils();
  const reconcileCardMoves = useCallback(
    (itemTypes: readonly (string | null | undefined)[]) =>
      itemTypes.includes("CARD") || itemTypes.includes("CONSUMABLE")
        ? utils.kessen.getHub.invalidate()
        : Promise.resolve(),
    [utils],
  );
  return { reconcileCardMoves };
};
