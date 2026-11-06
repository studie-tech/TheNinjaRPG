import { useCallback, useEffect, useRef } from "react";
import type { BattleAction } from "@/drizzle/schema";
import type { BattleState, ReturnedBattle } from "@/libs/combat/types";

export type CombatTabState = {
  battle: ReturnedBattle;
  result: BattleState["result"];
  logEntries?: BattleAction[] | null;
};

/** One tab drives autonomous turns; committed snapshots keep its same-account peers current without polling. */
export const useCombatTabs = (
  battleId: string | undefined,
  userId: string | undefined,
  onState: (state: CombatTabState) => void,
  isDriverEnabled = true,
) => {
  const key = battleId && userId ? `tnr-combat:${userId}:${battleId}` : undefined;
  const supported =
    typeof navigator !== "undefined" &&
    !!navigator.locks &&
    typeof BroadcastChannel !== "undefined";
  const owner = useRef<string | undefined>(undefined);
  const channel = useRef<BroadcastChannel | null>(null);
  const receive = useRef(onState);
  receive.current = onState;

  useEffect(() => {
    if (!supported || !key) return;
    let messages: BroadcastChannel;
    try {
      messages = new BroadcastChannel(key);
    } catch (error) {
      console.warn("Combat tab coordination unavailable", error);
      owner.current = key;
      return () => {
        if (owner.current === key) owner.current = undefined;
      };
    }
    const controller = new AbortController();
    let release: (() => void) | undefined;
    channel.current = messages;
    messages.onmessage = (event: MessageEvent<CombatTabState>) => {
      if (
        !controller.signal.aborted &&
        event.data?.battle?.id === battleId &&
        Number.isFinite(event.data.battle.version)
      )
        receive.current(event.data);
    };
    // Queue once: closing the owning tab releases the lock and promotes a waiting peer.
    if (isDriverEnabled)
      void navigator.locks
        .request(key, { signal: controller.signal }, async () => {
          if (controller.signal.aborted) return;
          owner.current = key;
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          // Browsers with unavailable coordination retain ordinary autonomous combat.
          console.warn("Combat tab coordination unavailable", error);
          owner.current = key;
        });
    return () => {
      controller.abort();
      release?.();
      messages.close();
      if (channel.current === messages) channel.current = null;
      if (owner.current === key) owner.current = undefined;
    };
  }, [battleId, key, supported, isDriverEnabled]);

  const canDrive = useCallback(
    () => isDriverEnabled && !!key && (!supported || owner.current === key),
    [key, supported, isDriverEnabled],
  );
  const publish = useCallback(
    (state: CombatTabState) => {
      if (state.battle.id === battleId) channel.current?.postMessage(state);
    },
    [battleId],
  );
  return { canDrive, publish };
};
