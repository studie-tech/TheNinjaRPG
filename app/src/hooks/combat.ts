import { hashKey, useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { useCallback, useEffect, useMemo, useRef } from "react";
import superjson from "superjson";
import { api, type RouterInputs } from "@/app/_trpc/client";
import type { BattleAction } from "@/drizzle/schema";
import { useLocalStorage } from "@/hooks/localstorage";
import { type BattleMaps, computeBattleMaps } from "@/libs/combat/battleMaps";
import { type BattleUpdate, mergeBattleEntries } from "@/libs/combat/log";
import type { BattleState, ReturnedBattle } from "@/libs/combat/types";
import { showMutationToast } from "@/libs/toast";
import { useUserData } from "@/utils/UserContext";

export type { BattleMaps } from "@/libs/combat/battleMaps";
export {
  computeBattleMaps,
  shouldInvalidateEndedBattleCaches,
} from "@/libs/combat/battleMaps";

/**
 * Hook to precompute maps for ground effects, user effects, and user positions.
 * Only recomputes when battle id or version changes — a new battle object with
 * the same snapshot must not rebuild the maps (isPending toggles do this).
 */
export const useBattleMaps = (battle: ReturnedBattle | null): BattleMaps => {
  return useMemo(() => computeBattleMaps(battle), [battle?.id, battle?.version]);
};

/**
 * Apply committed deltas to actor and observer history caches.
 * Only settlement and unversioned saved logs force recovery reads. Ordinary
 * version changes use their normal query keys; newer events refresh active
 * battle state.
 */
export const useCombatUpdates = (state: BattleState) => {
  const { pusher } = useUserData();
  const utils = api.useUtils();
  const queryClient = useQueryClient();
  // Keep the subscription stable while its handler reads the latest battle/result.
  const stateRef = useRef(state);
  stateRef.current = state;
  const battleId = state.battle?.id;
  const pendingActionRef = useRef<{ battleId: string; version: number } | null>(null);
  const responseVersionRef = useRef<{ battle: ReturnedBattle; version: number } | null>(
    null,
  );

  const startAction = useCallback((id: string) => {
    if (pendingActionRef.current) return false;
    pendingActionRef.current = { battleId: id, version: 0 };
    return true;
  }, []);

  const settleAction = useCallback(
    (
      id: string,
      response: Pick<BattleState, "battle" | "result">,
      shouldRefresh: boolean,
    ) => {
      const pending = pendingActionRef.current;
      if (pending?.battleId === id) pendingActionRef.current = null;
      const { battle, result } = stateRef.current;
      if (!battle || battle.id !== id) return;
      // onSettled runs before React necessarily renders onSuccess's state update.
      // Retain its version only for this snapshot; a later poll may replace it.
      const version =
        response.battle?.id === id ? response.battle.version : battle.version;
      responseVersionRef.current = { battle, version };
      if (result || response.result) return;
      // Compare with the response being applied, even if an independent poll
      // already rendered a newer state that onSuccess is about to replace.
      if (shouldRefresh || (pending?.battleId === id && pending.version > version)) {
        void utils.combat.getBattle.invalidate();
      }
    },
    [utils],
  );

  const updateLogs = useCallback(
    async (
      id: string,
      version: number,
      logEntries: BattleAction[] | null,
      finished = false,
    ) => {
      if (logEntries?.length === 0) return;
      const queries = queryClient.getQueryCache().findAll({
        queryKey: getQueryKey(api.combat.getBattleEntries, { battleId: id }, "query"),
      });
      const groups = new Map<
        string,
        {
          target: RouterInputs["combat"]["getBattleEntries"] & { refreshKey: number };
          sources: {
            input: RouterInputs["combat"]["getBattleEntries"];
            query: (typeof queries)[number];
          }[];
        }
      >();
      for (const query of queries) {
        const { input } = query.queryKey[1] as {
          input: RouterInputs["combat"]["getBattleEntries"];
        };
        const target = {
          ...input,
          refreshKey: Math.max(input.refreshKey ?? 0, version),
        };
        const key = hashKey([target]);
        const group = groups.get(key) ?? { target, sources: [] };
        group.sources.push({ input, query });
        groups.set(key, group);
      }
      for (const { target, sources } of groups.values()) {
        let entries: BattleAction[] | undefined;
        if (logEntries) {
          // Try the freshest page first, falling back only when it has gaps or
          // no data. Obsolete versions must not each re-merge the same delta.
          sources.sort((a, b) => (b.input.refreshKey ?? 0) - (a.input.refreshKey ?? 0));
          for (const { input } of sources) {
            entries = mergeBattleEntries(
              utils.combat.getBattleEntries.getData(input),
              logEntries,
              input,
              version,
            );
            if (entries) break;
          }
        }
        if (entries) {
          // refreshKey is a cache key, not a SQL cutoff: this page may already
          // contain later committed rows. Never replace them with an older delta.
          const isNewer = (rows: BattleAction[] | undefined) =>
            rows?.some((row) => row.battleVersion >= target.refreshKey);
          // An ended observer may keep this older key after battle deletion.
          const keys = [
            target,
            ...sources
              .filter(
                ({ input, query }) =>
                  finished &&
                  query.getObserversCount() > 0 &&
                  !!input.refreshKey &&
                  target.refreshKey !== input.refreshKey,
              )
              .map(({ input }) => input),
          ];
          for (const key of keys) {
            if (isNewer(utils.combat.getBattleEntries.getData(key))) continue;
            // A pre-insert response must not overwrite the committed delta.
            await utils.combat.getBattleEntries.cancel(key);
            utils.combat.getBattleEntries.setData(key, (current) =>
              isNewer(current) ? current : entries,
            );
          }
        }
        for (const { input, query } of sources) {
          if (input.refreshKey && entries) {
            if (
              finished &&
              query.getObserversCount() === 0 &&
              input.refreshKey !== target.refreshKey
            ) {
              // Retired keys need fresh data if a held result later remounts.
              // Mark them stale without scanning or rewriting their old rows.
              if (query.state.fetchStatus !== "idle") {
                await utils.combat.getBattleEntries.cancel(input);
              }
              query.invalidate();
            }
            continue;
          }
          if (input.refreshKey && !finished) continue;
          // Ordinary version changes load their new history key naturally. At
          // settlement the battle may be deleted, leaving an older key mounted.
          await utils.combat.getBattleEntries.cancel(input);
          void utils.combat.getBattleEntries.invalidate(input);
        }
      }
    },
    [queryClient, utils],
  );

  useEffect(() => {
    if (!battleId || !pusher) return;
    const channel = pusher.subscribe(battleId);
    const onUpdate = async (data: BattleUpdate) => {
      if (data.logEntries !== undefined) {
        await updateLogs(
          battleId,
          data.version,
          data.logEntries === null
            ? null
            : superjson.deserialize<BattleAction[]>(data.logEntries),
          // Repair this viewer's own settlement, without refetching their held
          // result on every later ordinary turn in a multi-person battle.
          !!data.finished ||
            (!!stateRef.current.result &&
              data.version <= (stateRef.current.battle?.version ?? 0)),
        );
      }
      const { battle, result } = stateRef.current;
      if (!battle || battle.id !== battleId || result) return;
      const pending = pendingActionRef.current;
      if (pending?.battleId === battleId) {
        pending.version = Math.max(pending.version, data.version);
        return;
      }
      const response = responseVersionRef.current;
      const version = Math.max(
        battle.version,
        response?.battle === battle ? response.version : 0,
      );
      if (data.version > version) void utils.combat.getBattle.invalidate();
    };
    channel.bind("event", onUpdate);
    return () => {
      channel.unbind("event", onUpdate);
      pusher.unsubscribe(battleId);
    };
  }, [battleId, pusher, utils, updateLogs]);
  return { updateLogs, startAction, settleAction };
};

/**
 * Layout component identifiers for combat page ordering
 */
export const COMBAT_LAYOUT_COMPONENTS = [
  { id: "timer", label: "Round Timer" },
  { id: "battlefield", label: "Battlefield" },
  { id: "actions", label: "Actions" },
  { id: "timeline", label: "Timeline" },
  { id: "battlelog", label: "Battle Log" },
] as const;

export type CombatLayoutComponentId = (typeof COMBAT_LAYOUT_COMPONENTS)[number]["id"];

export const DEFAULT_LAYOUT_ORDER: CombatLayoutComponentId[] = [
  "timer",
  "battlefield",
  "actions",
  "timeline",
  "battlelog",
];

export type CombatResourceBarsVisibility = "mobile-only" | "on" | "off";

/**
 * Combat UI preferences persisted in localStorage
 */
export const useCombatPreferences = () => {
  const [showGridNumbers, setShowGridNumbers] = useLocalStorage<boolean>(
    "showGridNumbers",
    false,
  );
  const [useSmallActions, setUseSmallActions] = useLocalStorage<boolean>(
    "combatSmallActions",
    false,
  );
  const [resourceBarsVisibility, setResourceBarsVisibility] =
    useLocalStorage<CombatResourceBarsVisibility>(
      "combatResourceBarsVisibility",
      "mobile-only",
    );
  const [showBattleLog, setShowBattleLog] = useLocalStorage<boolean>(
    "combatShowBattleLog",
    false,
  );
  const [showTimeline, setShowTimeline] = useLocalStorage<boolean>(
    "combatShowTimeline",
    true,
  );
  const [showAggro, setShowAggro] = useLocalStorage<boolean>("combatShowAggro", true);
  // Keep the persisted key stable for existing combat animation preferences.
  const [animateBattlefield, setAnimateBattlefield] = useLocalStorage<boolean>(
    "combatAnimateCharacters",
    true,
  );
  const [showBasicActions, setShowBasicActions] = useLocalStorage<boolean>(
    "combatShowBasicActions",
    true,
  );
  const [layoutOrder, setLayoutOrder] = useLocalStorage<CombatLayoutComponentId[]>(
    "combatLayoutOrder",
    DEFAULT_LAYOUT_ORDER,
  );
  const [useTabs, setUseTabs] = useLocalStorage<boolean>("combatUseTabs", false);

  const toggleGridNumbers = useCallback(
    () => setShowGridNumbers(!showGridNumbers),
    [showGridNumbers, setShowGridNumbers],
  );
  const toggleSmallActions = useCallback(
    () => setUseSmallActions(!useSmallActions),
    [useSmallActions, setUseSmallActions],
  );
  const toggleBattleLog = useCallback(
    () => setShowBattleLog(!showBattleLog),
    [showBattleLog, setShowBattleLog],
  );
  const toggleTimeline = useCallback(
    () => setShowTimeline(!showTimeline),
    [showTimeline, setShowTimeline],
  );
  const toggleAggro = useCallback(
    () => setShowAggro(!showAggro),
    [showAggro, setShowAggro],
  );
  const toggleBasicActions = useCallback(
    () => setShowBasicActions(!showBasicActions),
    [showBasicActions, setShowBasicActions],
  );
  const toggleUseTabs = useCallback(() => setUseTabs(!useTabs), [useTabs, setUseTabs]);
  const resetLayoutOrder = useCallback(
    () => setLayoutOrder([...DEFAULT_LAYOUT_ORDER]),
    [setLayoutOrder],
  );

  return useMemo(
    () => ({
      showGridNumbers,
      setShowGridNumbers,
      toggleGridNumbers,
      useSmallActions,
      setUseSmallActions,
      toggleSmallActions,
      resourceBarsVisibility,
      setResourceBarsVisibility,
      showBattleLog,
      setShowBattleLog,
      toggleBattleLog,
      showTimeline,
      setShowTimeline,
      toggleTimeline,
      showAggro,
      animateBattlefield,
      setAnimateBattlefield,
      setShowAggro,
      toggleAggro,
      showBasicActions,
      setShowBasicActions,
      toggleBasicActions,
      layoutOrder,
      setLayoutOrder,
      useTabs,
      setUseTabs,
      toggleUseTabs,
      resetLayoutOrder,
    }),
    [
      showGridNumbers,
      setShowGridNumbers,
      toggleGridNumbers,
      useSmallActions,
      setUseSmallActions,
      toggleSmallActions,
      resourceBarsVisibility,
      setResourceBarsVisibility,
      showBattleLog,
      setShowBattleLog,
      toggleBattleLog,
      showTimeline,
      setShowTimeline,
      toggleTimeline,
      showAggro,
      animateBattlefield,
      setAnimateBattlefield,
      setShowAggro,
      toggleAggro,
      showBasicActions,
      setShowBasicActions,
      toggleBasicActions,
      layoutOrder,
      setLayoutOrder,
      useTabs,
      setUseTabs,
      toggleUseTabs,
      resetLayoutOrder,
    ],
  );
};

export type CombatPreferences = ReturnType<typeof useCombatPreferences>;

/**
 * Whether new battles should start with the player's own AI profile in control
 * (auto combat). Persisted on the user rather than in localStorage so the
 * choice follows the player across devices. Toggling it in a non-PvP battle
 * remembers the preference for next time; PvP choices apply only to that fight.
 * Defaults to true for every account.
 *
 * Returns a [value, setValue] pair mirroring useLocalStorage, so call sites
 * read the same either way.
 */
export const useAutoCombatSetting = (): [boolean, (enabled: boolean) => void] => {
  const utils = api.useUtils();
  const { data: userData, updateUser } = useUserData();
  const { mutate: updatePreferences } = api.profile.updatePreferences.useMutation({
    // Flicking the switch back and forth would otherwise leave two writes in
    // flight with no ordering guarantee, and whichever landed last would win;
    // a shared scope makes react-query run them one after the other.
    scope: { id: "defaultAutoCombat" },
    // The switch moved before the server confirmed anything, so a write that
    // does not land has to be undone. Refetching rather than restoring a
    // remembered value keeps the cache on server truth even if the failure
    // arrives after a later, successful toggle.
    onSuccess: async (data) => {
      if (data.success) return;
      showMutationToast(data);
      await utils.profile.getUser.invalidate();
    },
    onError: async () => {
      await utils.profile.getUser.invalidate();
    },
  });
  const enabled = userData?.defaultAutoCombat ?? true;
  const setEnabled = useCallback(
    (next: boolean) => {
      // Update the cached user first so the switch responds immediately; the
      // mutation persists the same value.
      void updateUser({ defaultAutoCombat: next });
      updatePreferences({ defaultAutoCombat: next });
    },
    [updateUser, updatePreferences],
  );
  return [enabled, setEnabled];
};
