import { getQueryKey } from "@trpc/react-query";
import { useCallback, useMemo, useRef } from "react";
import { api, type RouterOutputs } from "@/app/_trpc/client";
import {
  type CombatStateUpdate,
  getCombatEventUpdate,
  getCombatStateUpdate,
} from "@/deltas/combat";
import { useQueryCacheUpdate } from "@/hooks/useQueryCacheUpdate";
import type { BattleState } from "@/libs/combat/types";

/** Bind confirmed actions and public events to exact battle snapshots and coalesced recovery. */
export const useBattleCacheUpdate = (
  battleId: string | undefined,
  userId: string | undefined,
) => {
  const utils = api.useUtils();
  const key = useMemo(
    () => getQueryKey(api.combat.getBattle, { battleId }, "query"),
    [battleId],
  );
  const cache = useQueryCacheUpdate<RouterOutputs["combat"]["getBattle"]>(key);
  const refreshRef = useRef<{ battleId: string; version: number } | null>(null);
  /** Capture the exact battle key and settled revision before an action or public event. */
  const prepareBattleUpdate = cache.prepareUpdate;

  /** Coalesce duplicate versions; failed actions and newer events can request immediate recovery. */
  const refreshBattle = useCallback(
    (id: string, version: number, force = false) => {
      const pending = refreshRef.current;
      if (!force && pending?.battleId === id && pending.version >= version) return;
      const request = { battleId: id, version };
      refreshRef.current = request;
      void utils.combat.getBattle.invalidate({ battleId: id }).finally(() => {
        if (refreshRef.current === request) refreshRef.current = null;
      });
    },
    [utils],
  );

  /** Apply the committed actor response only to its captured query revision. */
  const updateBattle = useCallback(
    (
      id: string,
      response: Pick<BattleState, "battle" | "result">,
      snapshot: ReturnType<typeof prepareBattleUpdate>,
    ) =>
      cache.updateCache(
        (current) => getCombatStateUpdate(current, response, id),
        snapshot,
      ),
    [cache.updateCache],
  );

  /** Apply eligible public changes; gaps, private changes and cache races retain one recovery. */
  const updateBattleEvent = useCallback(
    async (id: string, version: number, update: CombatStateUpdate) => {
      if (update.fields.id !== id || update.fields.version !== version) {
        refreshBattle(id, version);
        return;
      }
      const snapshot = prepareBattleUpdate();
      const current = utils.combat.getBattle.getData({ battleId: id });
      if (
        snapshot.revision === undefined ||
        !current ||
        !getCombatEventUpdate(current, update, userId)
      ) {
        refreshBattle(id, version);
        return;
      }
      const pending = refreshRef.current;
      if (pending?.battleId === id && pending.version >= version) return;
      const applying = { battleId: id, version };
      refreshRef.current = applying;
      try {
        await cache.updateCache(
          (current) => getCombatEventUpdate(current, update, userId),
          snapshot,
        );
      } finally {
        if (refreshRef.current === applying) refreshRef.current = null;
      }
    },
    [prepareBattleUpdate, cache.updateCache, refreshBattle, userId, utils],
  );

  return { prepareBattleUpdate, updateBattle, updateBattleEvent, refreshBattle };
};
