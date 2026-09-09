import { useCallback, useMemo } from "react";
import { api } from "@/app/_trpc/client";
import { useLocalStorage } from "@/hooks/localstorage";
import { type BattleMaps, computeBattleMaps } from "@/libs/combat/battleMaps";
import type { ReturnedBattle } from "@/libs/combat/types";
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
  const [showBattleLog, setShowBattleLog] = useLocalStorage<boolean>(
    "combatShowBattleLog",
    false,
  );
  const [showTimeline, setShowTimeline] = useLocalStorage<boolean>(
    "combatShowTimeline",
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
      showBattleLog,
      setShowBattleLog,
      toggleBattleLog,
      showTimeline,
      setShowTimeline,
      toggleTimeline,
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
      showBattleLog,
      setShowBattleLog,
      toggleBattleLog,
      showTimeline,
      setShowTimeline,
      toggleTimeline,
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
 * choice follows the player across devices, and so toggling it mid-battle can
 * remember the preference for next time. Defaults to true for every account.
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
