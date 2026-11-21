"use client";

import { getQueryKey } from "@trpc/react-query";
import { useCallback } from "react";
import { api } from "@/app/_trpc/client";
import { getKessenHubWithGrants } from "@/deltas/kessen";
import { useQueryCacheUpdate } from "@/hooks/useQueryCacheUpdate";
import type { KessenHub } from "@/validators/kessen";

/**
 * The Card Hall hub cache (`kessen.getHub`) for mutations anywhere in the game: a
 * snapshot taken when a mutation starts, its confirmed update, granted cards credited to
 * the owned copies, and `reconcileCardMoves` (see `useKessenCardMoves`).
 */
export const useKessenHubCache = () => {
  const { prepareUpdate, updateCache } = useQueryCacheUpdate<KessenHub>(
    getQueryKey(api.kessen.getHub, undefined, "query"),
  );
  const { reconcileCardMoves } = useKessenCardMoves();
  const creditHubGrants = useCallback(
    (
      granted: readonly { itemId: string; quantity: number }[],
      snapshot: ReturnType<typeof prepareUpdate>,
    ) => updateCache((hub) => getKessenHubWithGrants(hub, granted), snapshot),
    [updateCache],
  );
  return {
    prepareHubUpdate: prepareUpdate,
    updateHub: updateCache,
    creditHubGrants,
    reconcileCardMoves,
  };
};

/**
 * The hub counts free card copies, so a mutation that moved copies outside the Card Hall
 * (sold, listed, bought or returned at the auction house) has it read again; other item
 * types leave it alone. Item and auction flows use this alone, without the hub's key.
 */
export const useKessenCardMoves = () => {
  const utils = api.useUtils();
  const reconcileCardMoves = useCallback(
    (itemTypes: readonly (string | null | undefined)[]) =>
      itemTypes.includes("CARD") ? utils.kessen.getHub.invalidate() : Promise.resolve(),
    [utils],
  );
  return { reconcileCardMoves };
};
