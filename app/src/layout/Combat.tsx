import type { Grid } from "honeycomb-grid";
import { useAtom, useSetAtom } from "jotai";
import { Check, HelpCircle, Loader2 } from "lucide-react";
import type React from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api, type RouterInputs } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { combatProfilePatch, getCombatInventoryUpdate } from "@/deltas/combat";
import {
  AutoBattleTypes,
  IMG_INITIATIVE_D20,
  PvpBattleTypes,
} from "@/drizzle/constants";
import {
  type CombatPreferences,
  useBattleMaps,
  useCombatUpdates,
} from "@/hooks/combat";
import { useGameScene } from "@/hooks/game-scene";
import { useLocalStorage } from "@/hooks/localstorage";
import { useLpcCatalogLoader } from "@/hooks/lpc";
import { useNavigationRouter as useRouter } from "@/hooks/navigation";
import { TUTORIAL_STEPS, useTutorialStep } from "@/hooks/tutorial";
import { useInventoryCacheUpdate } from "@/hooks/useInventoryCacheUpdate";
import { usePageActive } from "@/hooks/usePageActive";
import { useSectorCacheUpdate } from "@/hooks/useSectorCacheUpdate";
import { CombatAggro } from "@/layout/CombatAggro";
import { CombatResourceBars } from "@/layout/CombatResourceBars";
import { CombatRewards } from "@/layout/CombatRewards";
import { DayNightIndicator } from "@/layout/DayNightIndicator";
import { HuntingBoard } from "@/layout/HuntingBoard";
import Image from "@/layout/Image";
import ItemLoadoutSelector from "@/layout/ItemLoadoutSelector";
import JutsuLoadoutSelector from "@/layout/JutsuLoadoutSelector";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import { QuestUpdateModal } from "@/layout/Logbook";
import { VisualizeEffects, VisualizeGroundEffects } from "@/layout/MenuBoxProfile";
import WebGlError from "@/layout/WebGLError";
import { getAudioPreference } from "@/libs/audioPreferences";
import {
  availableUserActions,
  calcActiveUser,
  stillInBattle,
} from "@/libs/combat/actions";
import { getAggroDisplay } from "@/libs/combat/aggroDisplay";
import { shouldInvalidateEndedBattleCaches } from "@/libs/combat/battleMaps";
import { COMBAT_LOBBY_SECONDS, COMBAT_SECONDS } from "@/libs/combat/constants";
import { isBattleHotkeyBlocked } from "@/libs/combat/hotkeys";
import { isPvpEnergyRewardBattle, sendsToHospital } from "@/libs/combat/settlement";
import { validateActionTarget } from "@/libs/combat/targetValidation";
import { getTurnControl, resolveControlledActorId } from "@/libs/combat/turn";
import type { BattleState, CombatAction, ReturnedBattle } from "@/libs/combat/types";
import type { TerrainHex } from "@/libs/hexgrid";
import { LIGHT_LAYOUT_STORAGE_KEY } from "@/libs/layoutPreference";
import { haptics } from "@/libs/native";
import { findConsecutiveQuestId, getIsolatedPyramid } from "@/libs/questRun";
import {
  type CombatHover,
  type CombatPresented,
  type CombatSceneSnapshot,
  createCombatScene,
} from "@/libs/rendering/scenes/combat";
import type { WorldWeather } from "@/libs/rendering/worldWeather";
import { showMutationToast } from "@/libs/toast";
import { getTutorialBattleReturnPage, isTutorialActive } from "@/libs/tutorial";
import { playPreloadedAudio, preloadAudioBuffers, savedSfxVolume } from "@/utils/audio";
import { isStaffRole } from "@/utils/permissions";
import { secondsFromNow } from "@/utils/time";
import {
  combatActionIdAtom,
  combatHeldResultAtom,
  combatPendingActionAtom,
  combatPresentedBattleAtom,
  combatPresentedLogVersionAtom,
  useRequiredUserData,
  userBattleAtom,
} from "@/utils/UserContext";
import Countdown from "./Countdown";

/** Autonomous requests stay inside the 60-per-minute limit that fines players. */
const AUTONOMOUS_ACTION_MS = 1100;
/** Replays finish between ticks, so the next autonomous action follows them promptly. */
const DRIVER_TICK_MS = 200;
const BATTLE_CHECK_MS = 1000;
/** A result screen never waits longer than this, even if the field stops rendering. */
const RESULT_HOLD_MS = 12000;

interface CombatProps {
  action?: CombatAction | undefined;
  battleState: BattleState;
  userId: string;
  setBattleState: React.Dispatch<React.SetStateAction<BattleState | undefined>>;
  config: CombatPreferences;
  /** Key that ends the turn; follows the player's hotkey for End Turn. */
  endTurnKey?: string;
  /** Arena retries are owned by the page so layout remounts retain paid actions. */
  arenaActions?: React.ReactNode;
}

/** Coordinate battle controls and snapshots with the owned battlefield renderer. */
const Combat: React.FC<CombatProps> = (props) => {
  // Destructure props
  const { battleState, setBattleState, config } = props;
  const router = useRouter();
  const [heldResultVersion, setHeldResultVersion] = useAtom(combatHeldResultAtom);
  /** Settled outcome; everything that acts on the battle reads this, not the display. */
  const settledResult = battleState.result;
  /** The result screen, once the field has replayed the action that decided the battle. */
  const result = heldResultVersion === undefined ? settledResult : null;
  const utils = api.useUtils();
  const loadLpcCatalog = useLpcCatalogLoader();

  // State
  const [isReturningFromTutorial, setIsReturningFromTutorial] = useState(false);
  const tutorialReturnLockRef = useRef(false);
  const [logbookModalQuestId, setLogbookModalQuestId] = useState<string | null>(null);
  const [readySettledBattleId, setReadySettledBattleId] = useState<string | null>(null);
  const [pendingLoadoutSelection, setPendingLoadoutSelection] = useState<{
    battleId: string;
    kind: "item" | "jutsu";
    loadoutId: string;
    displayName: string;
  } | null>(null);

  // Hover tooltip state for effects (can include both user and ground effects)
  const [hoveredEffect, setHoveredEffect] = useState<CombatHover | null>(null);
  const [aggroTarget, setAggroTarget] = useState<CombatHover | null>(null);
  const hoverTooltipRef = useRef<HTMLDivElement | null>(null);

  // Light layout preference state
  const [lightLayout] = useLocalStorage<boolean>(LIGHT_LAYOUT_STORAGE_KEY, false);
  const [lightingPreviewDate, setLightingPreviewDate] = useState<Date | null>(null);
  const [weatherPreview, setWeatherPreview] = useState<WorldWeather | null>(null);
  const [storedZoom, setStoredZoom] = useLocalStorage<number>("combatZoom", 1.5);

  // References which shouldn't update
  const isPageActive = usePageActive();
  const wasPageActiveRef = useRef(true);
  const lastActionsRef = useRef<Date[]>([]);
  const lastAutonomousActionRef = useRef(0);
  const fieldFailedRef = useRef(false);
  const lastBattleCheckRef = useRef(0);
  const actionInFlightRef = useRef(false);
  const readyInFlightBattleIdRef = useRef<string | null>(null);
  const loadoutInFlightRef = useRef<{
    battleId: string;
    kind: "item" | "jutsu";
    loadoutId: string;
  } | null>(null);
  const battleRef = useRef<ReturnedBattle | null | undefined>(battleState.battle);
  const actionRef = useRef<CombatAction | undefined>(props.action);
  const userIdRef = useRef<string>(props.userId);
  const precomputedActionsRef = useRef<CombatAction[]>([]);
  const resultRef = useRef(settledResult);
  const mountRef = useRef<HTMLDivElement | null>(null);
  // Read by the document key listener, which only re-registers on [suid, timeDiff].
  const endTurnKeyRef = useRef(props.endTurnKey ?? "");
  useEffect(() => {
    endTurnKeyRef.current = props.endTurnKey ?? "";
  }, [props.endTurnKey]);
  const gridRef = useRef<Grid<TerrainHex> | null>(null);
  const battleId = battleRef.current?.id;
  const battleType = battleRef.current?.battleType;

  // getUser / travel / raid invalidation after a result must run once per
  // ended battle, not on every later props identity change while result is set.
  const endedBattleInvalidationRef = useRef<string | null>(null);
  const completionRevisionRef = useRef<{
    battleId: string;
    revision: number | undefined;
    inventory?: ReturnType<typeof prepareInventoryUpdate>;
    sector?: ReturnType<typeof prepareSectorUpdate>;
  } | null>(null);

  // Tutorial step
  const { currentStep, handleNextStepAsync } = useTutorialStep();

  // Mutation protection

  // Data from the DB
  const setBattleAtom = useSetAtom(userBattleAtom);
  const setCombatActionId = useSetAtom(combatActionIdAtom);
  const setPendingAction = useSetAtom(combatPendingActionAtom);
  const setPresentedLogVersion = useSetAtom(combatPresentedLogVersionAtom);
  // Fighter meters follow the field while it replays actions the server already resolved.
  const [presentedBattle, setPresentedBattle] = useAtom(combatPresentedBattleAtom);
  // A replay ends with its scene; a new one reports nothing until the battle changes.
  useEffect(
    () => () => {
      setPresentedBattle(null);
      setPresentedLogVersion(undefined);
    },
    [battleState.battle?.id, setPresentedBattle, setPresentedLogVersion],
  );
  const {
    data: userData,
    timeDiff,
    updateUser,
    prepareUserUpdate,
  } = useRequiredUserData();
  const { prepareInventoryUpdate, updateInventory } = useInventoryCacheUpdate();
  const { prepareSectorUpdate, updateSector } = useSectorCacheUpdate(userData?.sector);
  const [isInLobby, setIsInLobby] = useState(
    () =>
      !!battleState.battle &&
      battleState.battle.createdAt.getTime() > Date.now() - timeDiff,
  );
  // Departed players and their summons can retain auto flags; only humans still
  // fighting keep optional auto combat active, matching the server's batch gate.
  const hasAutoCombat =
    !!battleState.battle &&
    (AutoBattleTypes.includes(battleState.battle.battleType) ||
      battleState.battle.usersState.some(
        (user) =>
          !user.isAi &&
          !user.isSummon &&
          user.isAutoCombat &&
          !user.leftBattle &&
          stillInBattle(user),
      ));

  const { updateLogs, startAction, settleAction, canDrive, publishBattle } =
    useCombatUpdates(battleState, !settledResult && (isPageActive || hasAutoCombat));
  const suid = userData?.userId;
  // The actor the human drives right now: themselves on their turn, or their
  // piloted summon on the summon's turn. Resolved by page.tsx from the same
  // battle object and handed down, so there is one derivation, not two.
  const controlledActorId = props.userId;
  // Precompute available actions for the actor the human currently controls;
  // recompute on version change or when control hands off to/from the summon.
  const precomputedActions = useMemo(() => {
    if (battleState.battle && controlledActorId) {
      return availableUserActions(battleState.battle, controlledActorId);
    }
    return [] as CombatAction[];
  }, [battleState.battle?.version, controlledActorId]);

  // Mirror precomputedActions into a ref so the long-lived interval, click, and
  // highlight handlers (which run outside React render and don't re-register on
  // every version change) read current actions instead of a stale snapshot.
  useEffect(() => {
    precomputedActionsRef.current = precomputedActions;
  }, [precomputedActions]);
  useEffect(() => {
    resultRef.current = settledResult;
  }, [settledResult]);
  // Bounds the hold if the field cannot finish, and clears it when the battle unmounts.
  useEffect(() => {
    if (heldResultVersion === undefined) return;
    const timeout = setTimeout(() => setHeldResultVersion(undefined), RESULT_HOLD_MS);
    return () => {
      clearTimeout(timeout);
      setHeldResultVersion(undefined);
    };
  }, [heldResultVersion, setHeldResultVersion]);

  // Precompute maps for ground effects, user effects, and user positions
  const battleMaps = useBattleMaps(battleState.battle ?? null);
  const aggro = useMemo(
    () => getAggroDisplay(battleState.battle?.usersState ?? []),
    [battleState.battle],
  );

  // Clicking a character pins its aggro; hover and long-press still inspect effects.
  const showAggro = !!(
    config.showAggro &&
    aggroTarget?.userId &&
    aggro.has(aggroTarget.userId)
  );
  const detailsTarget = showAggro ? aggroTarget : hoveredEffect;
  const detailsEffects = useMemo(() => {
    if (!detailsTarget) return null;

    const groundEffects =
      battleMaps.groundEffectsByTile.get(detailsTarget.tileKey) || [];
    const userEffects = detailsTarget.userId
      ? battleMaps.userEffectsByUserId.get(detailsTarget.userId) || []
      : [];

    const diffuseDamage = battleState.battle?.usersState.find(
      (user) => user.userId === detailsTarget.userId,
    )?.diffuseDamage;
    if (
      groundEffects.length === 0 &&
      userEffects.length === 0 &&
      !diffuseDamage?.length &&
      !showAggro
    )
      return null;

    return {
      groundEffects,
      userEffects,
      diffuseDamage,
      userId: detailsTarget.userId,
    };
  }, [detailsTarget, battleMaps, battleState.battle, showAggro]);

  useLayoutEffect(() => {
    const tooltip = hoverTooltipRef.current;
    if (!tooltip || !detailsTarget) return;
    const { width, height } = tooltip.getBoundingClientRect();
    const { x, y } = detailsTarget.position;
    const above = y - height - 10;
    tooltip.style.left = `${Math.max(8, Math.min(x + 15, window.innerWidth - width - 8))}px`;
    tooltip.style.top = `${Math.max(8, Math.min(above >= 8 ? above : y + 15, window.innerHeight - height - 8))}px`;
  }, [detailsTarget, detailsEffects]);

  // Store precomputed maps in refs for use in render loop
  const setHoveredEffectRef = useRef(setHoveredEffect);
  const lastHoverKeyRef = useRef<string | null>(null);
  // Touch effects use a held gesture so their tooltip cannot intercept a quick
  // action tap. Aggro inspection is selected independently on pointer release.
  const isTouchInputRef = useRef(false);
  const touchDetailsOpenRef = useRef(false);
  const touchDetailsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressClickUntilRef = useRef(0);

  // Update refs when memos change
  useEffect(() => {
    setHoveredEffectRef.current = setHoveredEffect;
  }, [battleMaps, setHoveredEffect]);

  // Session battle user state (the human's own account — used for lobby/ready
  // UI and loadout selection, NOT for piloting; piloting reads userIdRef).
  const battleSessionUser = battleRef.current?.usersState.find(
    (u) => u.userId === userData?.userId,
  );
  // Once this participant's readiness has been proven by the mutation response,
  // do not let an older query snapshot expose the action again. Battle IDs are
  // immutable, so a genuinely new lobby resets this local settlement naturally.
  const hasSettledReady =
    !!battleId &&
    (battleSessionUser?.iAmHere === true || readySettledBattleId === battleId);
  const activePendingLoadout =
    pendingLoadoutSelection?.battleId === battleId ? pendingLoadoutSelection : null;

  // Asset IDs to fetch
  const textureAssets = battleRef.current?.extraState.textureAssets || [];
  const sfxAssets = battleRef.current?.extraState.sfxAssets || [];
  const allAssets = [...textureAssets, ...sfxAssets];

  // Query data
  const {
    data: gameAssets,
    isPlaceholderData: hasPreviousGameAssets,
    isError: hasGameAssetsError,
    isFetching: isFetchingGameAssets,
    refetch: refetchGameAssets,
  } = api.misc.getAllGameAssetNames.useQuery(
    { ids: allAssets },
    { enabled: !!battleRef.current, placeholderData: (previous) => previous },
  );
  const hasGameAssets = gameAssets !== undefined;
  const gameAssetsRef = useRef({
    assets: gameAssets ?? [],
    requestedIds: new Set(allAssets),
  });
  useEffect(() => {
    if (gameAssets && !hasPreviousGameAssets) {
      gameAssetsRef.current = { assets: gameAssets, requestedIds: new Set(allAssets) };
    }
  }, [gameAssets, hasPreviousGameAssets, allAssets]);

  // Preload combat-related SFX (AudioBuffers via Web Audio API) once assets list is ready
  useEffect(() => {
    if (!gameAssets || gameAssets.length === 0) return;
    const sfxIds = battleRef.current?.extraState.sfxAssets || [];
    if (!sfxIds || sfxIds.length === 0) return;
    const urls = gameAssets
      .filter((a) => sfxIds.includes(a.id))
      .map((a) => a.url)
      .filter(Boolean);
    void preloadAudioBuffers(urls);
  }, [battleRef.current?.id, battleRef.current?.version, gameAssets]);

  // Convenience method for helping people to not move too fast
  const canPerformAction = () => {
    const minuteAgo = secondsFromNow(-60);
    const newActions = lastActionsRef.current.filter((a) => a > minuteAgo);
    newActions.push(new Date());
    if (newActions.length < 55) {
      lastActionsRef.current = newActions;
      return true;
    } else {
      document.body.style.cursor = "default";
      showMutationToast({
        success: false,
        message: "You are acting very fast. Much faster and you will be penalized.",
      });
      return false;
    }
  };

  // User Action
  const { mutate: mutateAction, isPending } = api.combat.performAction.useMutation({
    onMutate: () => {
      document.body.style.cursor = "wait";
      setBattleState({ battle: battleRef.current, result: null, isPending: true });
      return {
        revision: prepareUserUpdate(),
        inventory: prepareInventoryUpdate(),
        sector: prepareSectorUpdate(),
      };
    },
    onSettled: (data, error, variables) => {
      document.body.style.cursor = "default";
      settleAction(
        variables.battleId,
        {
          battle: data?.updateClient ? data.battleUpdate : undefined,
          result: data?.result,
        },
        !!error || (!!data?.updateClient && !data.battleUpdate),
      );
    },
    onError: () => {
      actionInFlightRef.current = false;
      setPendingAction(undefined);
      setBattleState((current) =>
        current?.result
          ? { ...current, isPending: false }
          : { battle: battleRef.current, result: null, isPending: false },
      );
    },
    onSuccess: async (data, _variables, context) => {
      actionInFlightRef.current = false;
      // A resolved action keeps its slot until the field reaches its log entry.
      if (!data.updateClient || !data.battleUpdate || !combat.scene.current)
        setPendingAction(undefined);
      // A peer can finish while this tab still awaits an earlier action response.
      if (resultRef.current) {
        setBattleState((current) =>
          current ? { ...current, isPending: false } : current,
        );
        return;
      }
      if (data.result && data.battleUpdate) {
        completionRevisionRef.current = { battleId: data.battleUpdate.id, ...context };
        if (
          data.updateClient &&
          combat.scene.current &&
          data.battleUpdate.playback?.length
        )
          setHeldResultVersion(data.battleUpdate.version);
      }
      // Clear the selected action only when control actually hands off to (or
      // away from) another actor — e.g. to/from a piloted summon. On the
      // player's own consecutive actions the controlled actor is unchanged, so
      // the highlight persists and the same jutsu/item can be chained across AP
      // spends (matching pre-pilot behaviour). No-op responses (e.g. "Not your
      // turn") omit battleUpdate and so never clear it. Reset here in onSuccess
      // rather than a useEffect (React Compiler lints the effect form).
      if (data.updateClient && data.battleUpdate) {
        const prevControlled = resolveControlledActorId(battleRef.current, suid);
        const nextControlled = resolveControlledActorId(data.battleUpdate, suid);
        if (prevControlled !== nextControlled) {
          setCombatActionId(undefined);
        }
      }
      // Physical feedback for the two moments worth feeling: an action landing, and the
      // battle ending. Both no-op on the web and when the player has haptics off, so
      // there is nothing to branch on here.
      if (data.result) {
        void haptics.notify(data.result.outcome === "Won" ? "SUCCESS" : "ERROR");
      } else if (data.updateClient && data.battleUpdate) {
        void haptics.impact("LIGHT");
      }
      // Notifications (if any)
      if (data.notification) {
        showMutationToast({ success: false, message: data.notification });
      }
      if (!data.battleUpdate) {
        setBattleState((current) =>
          current?.result
            ? { ...current, isPending: false }
            : { battle: battleRef.current, result: null, isPending: false },
        );
        return;
      }
      if (data.updateClient) {
        // Display committed outcomes before history recovery or tutorial navigation can suspend this handler.
        battleRef.current = data.battleUpdate;
        setBattleState({
          battle: data.battleUpdate,
          result: data.result,
          isPending: false,
        });
        setBattleAtom(data.battleUpdate);
        publishBattle({
          battle: data.battleUpdate,
          result: data.result,
          logEntries: data.logEntries,
        });
      }
      if (data?.result?.notifications.length !== 0) {
        data?.result?.notifications.forEach((notification) => {
          // Check if this is a durability warning (contains "durability is now" or "has broken")
          const isDurabilityWarning =
            notification.includes("durability is now") ||
            notification.includes("durability is critically low") ||
            notification.includes("has broken");
          const isBrokenItem = notification.includes("has broken");
          // Check if this is a war notification
          const isWarNotification =
            notification.includes("townhall") || notification.includes("Shrine");
          showMutationToast({
            success: !isDurabilityWarning, // Durability warnings are not "success" (they're warnings)
            title: isDurabilityWarning
              ? isBrokenItem
                ? "Item Broken"
                : "Low Durability Warning"
              : isWarNotification
                ? "War Update"
                : "Quest Update",
            message: notification,
          });
        });
      }
      // Check for quest updates
      // The tutorial claims its own quest rewards from the assistant panel
      if (data.updatedQuestIds?.length && !isTutorialActive(userData)) {
        // Show popup for consecutive quests
        const questId = findConsecutiveQuestId(
          userData?.userQuests,
          data.updatedQuestIds,
        );
        if (questId) setLogbookModalQuestId(questId);
      }
      // Reuse the same committed-delta path as PvP websocket observers.
      if (data.logEntries && data.battleUpdate) {
        await updateLogs(
          data.battleUpdate.id,
          data.battleUpdate.version,
          data.logEntries,
          !!data.result,
        );
      }
      // Check if tutorial should progress
      if (data.result) {
        if (currentStep?.onCombatWin && data.result?.outcome === "Won") {
          await handleNextStepAsync(currentStep.onCombatWin);
        } else if (currentStep?.onCombatLoss && data.result?.outcome !== "Won") {
          await handleNextStepAsync(currentStep.onCombatLoss);
        }
      }
    },
  });

  const performAction = (input: RouterInputs["combat"]["performAction"]) => {
    // Reserve synchronously for keyboard, pointer and automatic submissions.
    if (!startAction(input.battleId)) return;
    actionInFlightRef.current = true;
    const action = precomputedActionsRef.current.find(
      ({ id }) => id === input.actionId,
    );
    setPendingAction(
      action && input.version !== undefined
        ? {
            battleId: input.battleId,
            version: input.version,
            userId: userIdRef.current,
            name: action.name,
            image: action.image,
            cost: action.actionCostPerc,
          }
        : undefined,
    );
    mutateAction(input);
  };

  // I am here call
  const { mutate: iAmHere, isPending: isMarkingReady } = api.combat.iAmHere.useMutation(
    {
      onSuccess: (data, variables) => {
        const readinessWasProven =
          "battle" in data &&
          data.success &&
          data.battle?.usersState.some((user) => user.userId === suid && user.iAmHere);

        if (readinessWasProven && data.battle) {
          setReadySettledBattleId(variables.battleId);

          // Do not replace a newer battle with a response from a lobby the user
          // has already left. The settlement is keyed to the old battle and is
          // therefore harmless when the new battle renders.
          if (battleRef.current?.id === variables.battleId) {
            battleRef.current = data.battle;
            setBattleAtom(data.battle);
            setBattleState({ battle: data.battle, result: null, isPending: false });
            void utils.combat.getBattle.invalidate();
          }
        } else {
          showMutationToast({
            success: false,
            message:
              data.message ||
              "The combat lobby has expired. Refresh to see the current battle.",
          });
        }
      },
      onSettled: (_data, _error, variables) => {
        if (readyInFlightBattleIdRef.current === variables.battleId) {
          readyInFlightBattleIdRef.current = null;
        }
      },
    },
  );

  const handleMarkReady = () => {
    const currentBattleId = battleRef.current?.id;
    const sessionUser = battleRef.current?.usersState.find(
      (user) => user.userId === suid,
    );
    if (
      !currentBattleId ||
      !suid ||
      isMarkingReady ||
      loadoutInFlightRef.current?.battleId === currentBattleId ||
      readyInFlightBattleIdRef.current === currentBattleId ||
      sessionUser?.iAmHere ||
      readySettledBattleId === currentBattleId
    ) {
      return;
    }

    readyInFlightBattleIdRef.current = currentBattleId;
    iAmHere({ battleId: currentBattleId });
  };

  // Mutation for selecting loadouts
  const { mutate: selectLoadout } = api.combat.updateCombatLoadout.useMutation({
    onSuccess: (data, variables) => {
      if (
        "battle" in data &&
        data.success &&
        data.battle &&
        data.battle.id === variables.battleId
      ) {
        // The response belongs to an immutable lobby ID. Never allow a slow
        // response from a lobby the player has left to replace the new battle.
        if (battleRef.current?.id === variables.battleId) {
          battleRef.current = data.battle;
          setBattleAtom(data.battle);
          setBattleState({ battle: data.battle, result: null, isPending: false });
          if (data.message) {
            showMutationToast({
              success: true,
              title: "Loadout updated",
              message: data.message,
            });
          }
          void utils.combat.getBattle.invalidate();
        }
      } else {
        showMutationToast({
          success: false,
          message:
            data.message ||
            "The combat lobby changed before this loadout could be saved.",
        });
      }
    },
    onSettled: (_data, _error, variables) => {
      const kind = variables.itemLoadoutId ? "item" : "jutsu";
      const loadoutId = variables.itemLoadoutId ?? variables.jutsuLoadoutId;
      const currentRequest = loadoutInFlightRef.current;
      if (
        loadoutId &&
        currentRequest?.battleId === variables.battleId &&
        currentRequest.kind === kind &&
        currentRequest.loadoutId === loadoutId
      ) {
        loadoutInFlightRef.current = null;
        setPendingLoadoutSelection((pending) =>
          pending?.battleId === variables.battleId &&
          pending.kind === kind &&
          pending.loadoutId === loadoutId
            ? null
            : pending,
        );
      }
    },
  });

  const handleSelectLoadout = (
    kind: "item" | "jutsu",
    loadoutId: string,
    displayName: string,
  ) => {
    const currentBattle = battleRef.current;
    const currentUser = currentBattle?.usersState.find((user) => user.userId === suid);
    if (
      !currentBattle ||
      !currentUser ||
      currentUser.iAmHere ||
      readySettledBattleId === currentBattle.id ||
      readyInFlightBattleIdRef.current === currentBattle.id ||
      loadoutInFlightRef.current?.battleId === currentBattle.id
    ) {
      return;
    }

    const selectedId =
      kind === "item" ? currentUser.itemLoadout : currentUser.jutsuLoadout;
    if (selectedId === loadoutId) return;

    const pending = { battleId: currentBattle.id, kind, loadoutId, displayName };
    loadoutInFlightRef.current = pending;
    setPendingLoadoutSelection(pending);
    selectLoadout({
      battleId: currentBattle.id,
      ...(kind === "item"
        ? { itemLoadoutId: loadoutId }
        : { jutsuLoadoutId: loadoutId }),
    });
  };

  // Handle key-presses
  const onDocumentKeyDown = (event: KeyboardEvent) => {
    if (isBattleHotkeyBlocked(event)) return;
    if (event.key === "Escape") {
      setAggroTarget(null);
      return;
    }
    // A finished battle takes no actions; the result screen stays until the player leaves.
    if (battleRef.current && suid && !resultRef.current) {
      // Read the refs rather than render-scope state: this listener only
      // re-registers on [suid, timeDiff], so a captured value would go stale.
      // Both refs are kept current, which also lets the precompute be reused on
      // the summon's turn (the old precomputedUserId: suid only ever hit on the
      // player's own turn, and dropping it recomputed actions on every keypress).
      const { actor } = calcActiveUser(battleRef.current, suid, timeDiff, {
        precomputedUserId: userIdRef.current,
        precomputedActions: precomputedActionsRef.current,
      });
      // Modifier chords belong to the browser or OS, not to battle keys.
      // A held key repeats keydown; one press ends one turn.
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
      // An `if`, not a `switch`: React Compiler cannot compile a ref read as a `case` label.
      if (event.key.toLowerCase() === endTurnKeyRef.current) {
        // Same predicate the server authorizes with, so "w" fires on my own
        // turn and on my piloted summon's turn, but not on my AI summon's
        // (that one is auto-driven). actor.userId is the acting entity.
        if (getTurnControl(actor, suid).isUserTurn) {
          document.body.style.cursor = "wait";
          if (canPerformAction()) {
            performAction({
              battleId: battleRef.current.id,
              version: battleRef.current.version,
              actionId: "wait",
              longitude: actor.longitude,
              latitude: actor.latitude,
            });
          }
        }
      }
    }
  };
  // Re-register on [suid, timeDiff] (mirrors the auto-drive interval) so the
  // handler never reads a stale session id or clock offset — including the case
  // where suid is still undefined at mount and resolves later. Battle data stays
  // live via battleRef.current, and the actor is recomputed from
  // battle.activeUserId, so no render-scope state is captured.
  useEffect(() => {
    document.addEventListener("keydown", onDocumentKeyDown);
    return () => {
      document.removeEventListener("keydown", onDocumentKeyDown);
    };
  }, [suid, timeDiff]);

  const clearTouchDetailsTimer = () => {
    if (touchDetailsTimerRef.current) clearTimeout(touchDetailsTimerRef.current);
    touchDetailsTimerRef.current = null;
  };
  // Real mouse/pen pointers restore hover-driven details.
  const onDocumentPointerMove = (event: PointerEvent) => {
    if (event.pointerType !== "touch") isTouchInputRef.current = false;
  };
  // Releasing a long-press closes the details and swallows its trailing click.
  const onDocumentTouchEnd = () => {
    clearTouchDetailsTimer();
    if (touchDetailsOpenRef.current && lastHoverKeyRef.current) {
      suppressClickUntilRef.current = Date.now() + 600;
    }
    touchDetailsOpenRef.current = false;
    lastHoverKeyRef.current = null;
    setHoveredEffectRef.current(null);
  };
  // Long presses inspect effects without submitting a combat action.
  const onDocumentTouchStart = (event: TouchEvent) => {
    isTouchInputRef.current = true;
    touchDetailsOpenRef.current = false;
    clearTouchDetailsTimer();
    if (event.touches.length === 1) {
      touchDetailsTimerRef.current = setTimeout(() => {
        touchDetailsOpenRef.current = true;
      }, 400);
    }
  };

  // Keep held rewards paused; refresh battle data only when the page resumes.
  useEffect(() => {
    const wasActive = wasPageActiveRef.current;
    wasPageActiveRef.current = isPageActive;
    combat.scene.current?.refresh();
    if (!isPageActive || wasActive || result) return;
    void utils.combat.getBattle.invalidate();
  }, [isPageActive, result, utils]);

  // Hidden manual battles catch up on resume; keep driving auto combat in the
  // background so AI actions and idle opponent timeouts can still advance it.
  useEffect(() => {
    if (!isPageActive && !hasAutoCombat) return;
    const interval = setInterval(() => {
      if (
        suid &&
        battleRef.current &&
        userIdRef.current &&
        !isPending &&
        !settledResult &&
        canDrive() &&
        // Each action plays out before the next is requested, which keeps a response's
        // replay ahead of the next one rather than racing it.
        !combat.scene.current?.isPresenting()
      ) {
        const now = Date.now();
        const { actor, changedActor } = calcActiveUser(
          battleRef.current,
          suid,
          timeDiff,
          {
            precomputedUserId: controlledActorId,
            precomputedActions: precomputedActionsRef.current,
          },
        );
        // Scenario 1: a pure AI's turn -> auto-act. Gate on the SAME predicate the
        // server authorizes with (getTurnControl.isAITurn = isAi && !isPiloted), so
        // we never auto-fire for a piloted summon — mine (I drive it via the action
        // menu) or another player's (they drive it on their own client). Otherwise
        // every non-controller observer would spam performAction once a second and
        // the server would reject each with "Not your turn". Clones keep isPiloted
        // falsy, so they stay AI-driven.
        // Never auto-fire while the battle lobby is still counting down: the
        // server rejects early actions ("Battle has not started yet"), so
        // firing would only spam error toasts — relevant now that a player on
        // auto combat can be the initiative winner of a PvP lobby battle.
        const inLobby = battleRef.current.createdAt.getTime() > Date.now() - timeDiff;
        const { isAITurn } = getTurnControl(actor, suid);
        // Spectators follow the battle's channel; only its fighters drive its AI turns.
        const isFighter = battleRef.current.usersState.some(
          (user) => user.controllerId === suid,
        );
        if (isAITurn && isFighter && !isPending && !inLobby) {
          // Nothing resolves until a visible field can show it. Hidden pages and
          // fields that cannot load still advance, or the battle would wait forever.
          if (isPageActive && !combat.scene.current && !fieldFailedRef.current) return;
          if (now - lastAutonomousActionRef.current < AUTONOMOUS_ACTION_MS) return;
          lastAutonomousActionRef.current = now;
          if (canPerformAction()) {
            performAction({ battleId: battleRef.current.id });
          }
        } else if (now - lastBattleCheckRef.current >= BATTLE_CHECK_MS) {
          lastBattleCheckRef.current = now;
          // Scenario 2: more than 10 seconds passed, or actor is no longer the same as active user - refetch
          const updatePassed =
            Date.now() - timeDiff - battleRef.current.roundStartAt.getTime();
          const createPassed =
            Date.now() - timeDiff - battleRef.current.createdAt.getTime();
          const check1 = updatePassed > COMBAT_SECONDS * 1000;
          const check2 = createPassed > (COMBAT_LOBBY_SECONDS + COMBAT_SECONDS) * 1000;
          if ((check1 && check2) || changedActor) {
            battleRef.current.roundStartAt = new Date();
            void utils.combat.getBattle.invalidate();
          }
        }
      }
    }, DRIVER_TICK_MS);
    return () => clearInterval(interval);
  }, [
    isPageActive,
    hasAutoCombat,
    isPending,
    timeDiff,
    settledResult,
    suid,
    controlledActorId,
    canDrive,
  ]);

  useEffect(() => {
    actionRef.current = props.action;
    // props.userId IS the controlled actor (page.tsx resolves it), so this keeps
    // the ref following a piloted summon on its turn.
    userIdRef.current = props.userId;
    battleRef.current = props.battleState.battle;
  }, [props.action, props.userId, props.battleState.battle]);

  useEffect(() => {
    const endedBattleId = props.battleState.battle?.id;
    // Held until the screen appears: settling the profile can leave the battle route.
    const hasResult = !!result;
    if (!hasResult) {
      endedBattleInvalidationRef.current = null;
      return;
    }
    if (
      !shouldInvalidateEndedBattleCaches(
        endedBattleInvalidationRef.current,
        endedBattleId,
        hasResult,
      )
    ) {
      return;
    }
    endedBattleInvalidationRef.current = endedBattleId ?? null;
    const profileUpdate = props.battleState.result?.profileUpdate;
    const capturedCompletion =
      completionRevisionRef.current?.battleId === endedBattleId
        ? completionRevisionRef.current
        : null;
    const revision = capturedCompletion
      ? capturedCompletion.revision
      : prepareUserUpdate();
    const reconcileProfile = async () => {
      const inventory = capturedCompletion?.inventory ?? prepareInventoryUpdate();
      const sector = capturedCompletion?.sector ?? prepareSectorUpdate();
      const profileApplied = await updateUser(
        profileUpdate
          ? (current) => combatProfilePatch(current, profileUpdate)
          : undefined,
        { revision, delta: profileUpdate?.userDelta },
      );
      // A recovery read can grant achievement items beyond the combat settlement.
      await Promise.all([
        updateInventory(
          profileApplied
            ? (rows) => getCombatInventoryUpdate(rows, profileUpdate)
            : undefined,
          inventory,
        ),
        // PvP, raids and world encounters can also change opponents and public objectives.
        updateSector(
          profileApplied && props.battleState.battle?.battleType === "ARENA",
          sector,
        ),
      ]);
    };
    void Promise.all([
      reconcileProfile(),
      // Both scoring battle types are public; their frozen competitors stay private.
      ...(["TERRITORY_WAR", "COMBAT"].includes(
        props.battleState.battle?.battleType ?? "",
      )
        ? [
            utils.territoryWar.invalidate(),
            utils.village.invalidate(),
            utils.clan.invalidate(),
          ]
        : []),
      // Invalidate raid queries when a RAID battle ends so boss HP is refreshed
      ...(props.battleState.battle?.battleType === "RAID"
        ? [
            utils.profile.getDashboard.invalidate(),
            utils.raids.getRaidDetails.invalidate(),
            utils.raids.getAvailableRaids.invalidate(),
            utils.raids.getRaidLeaderboard.invalidate(),
          ]
        : []),
    ]);
  }, [result, props.battleState.battle?.id]);

  // Lobby for non-arena battles, letting both oppoenents join
  useEffect(() => {
    if (isInLobby) {
      const interval = setInterval(() => {
        const syncedTime = Date.now() - timeDiff;
        if (battleRef.current && battleRef.current.createdAt.getTime() > syncedTime) {
          setIsInLobby(true);
        } else {
          setIsInLobby(false);
        }
      }, 500);
      return () => clearInterval(interval);
    }
  }, [battleRef.current?.version, timeDiff, isInLobby]);

  const combatCallbacks = useRef({
    onTap: (_tile: TerrainHex, _character?: CombatHover) => {},
    onPresent: (_presented: CombatPresented) => {},
  });
  combatCallbacks.current.onPresent = ({ battle, logVersion }) => {
    const caughtUp = logVersion === undefined;
    setPresentedBattle(caughtUp ? null : battle);
    setPresentedLogVersion(logVersion);
    if (caughtUp && !actionInFlightRef.current) setPendingAction(undefined);
    if (
      caughtUp &&
      heldResultVersion !== undefined &&
      battle.version >= heldResultVersion
    )
      setHeldResultVersion(undefined);
  };
  combatCallbacks.current.onTap = (target, character) => {
    if (
      touchDetailsOpenRef.current ||
      Date.now() < suppressClickUntilRef.current ||
      document.body.style.cursor === "wait" ||
      resultRef.current
    )
      return;
    setAggroTarget(
      config.showAggro && character?.userId && aggro.has(character.userId)
        ? character
        : null,
    );
    const battle = battleRef.current,
      action = actionRef.current,
      grid = gridRef.current;
    if (!battle || !action || !grid) return;
    const user = battle.usersState.find((user) => user.userId === userIdRef.current);
    if (!user) return;
    const { isValid } = validateActionTarget({
      user,
      battle,
      action,
      grid,
      target,
      timeDiff,
      precomputedUserId: userIdRef.current,
      precomputedActions: precomputedActionsRef.current,
    });
    if (!isValid || !canPerformAction()) return;
    document.body.style.cursor = "wait";
    performAction({
      battleId: battle.id,
      version: battle.version,
      actionId: action.id,
      longitude: target.col,
      latitude: target.row,
    });
  };
  const sceneSnapshot = useRef<CombatSceneSnapshot | null>(null);
  sceneSnapshot.current = battleState.battle
    ? {
        battle: battleState.battle,
        action: props.action,
        actions: precomputedActions,
        userId: props.userId,
        viewer: userData,
        aggro: config.showAggro ? aggro : undefined,
        timeDiff,
        cycleEnabled: true,
        // Staff previews affect only rendering; turn deadlines use the server clock.
        lightDate: isStaffRole(userData?.role) ? lightingPreviewDate : null,
        weather: isStaffRole(userData?.role) ? weatherPreview : null,
        assets: gameAssetsRef.current.assets,
        requestedIds: gameAssetsRef.current.requestedIds,
        active: isPageActive && !result,
        sound: getAudioPreference("sfxOn", userData?.sfxOn),
        volume: savedSfxVolume(),
        showGridNumbers: config.showGridNumbers,
        inspect: !isTouchInputRef.current || touchDetailsOpenRef.current,
      }
    : null;
  const combat = useGameScene(
    "combat",
    mountRef,
    async (mount, signal, onError) =>
      createCombatScene({
        // Keep one artwork snapshot for this scene; later scene loads pick up saved edits.
        lpcCatalog: await loadLpcCatalog(),
        mount,
        signal,
        onError,
        lightLayout,
        initialZoom: storedZoom,
        onZoom: setStoredZoom,
        getSnapshot: () => {
          const snapshot = sceneSnapshot.current;
          if (!snapshot) throw new Error("Battlefield snapshot unavailable");
          return {
            ...snapshot,
            weatherTime: Date.now() - snapshot.timeDiff,
            assets: gameAssetsRef.current.assets,
            requestedIds: gameAssetsRef.current.requestedIds,
            inspect: !isTouchInputRef.current || touchDetailsOpenRef.current,
          };
        },
        onTap: (tile, character) => combatCallbacks.current.onTap(tile, character),
        onPresent: (presented) => combatCallbacks.current.onPresent(presented),
        play: (url, volume) => {
          void playPreloadedAudio(url, volume);
        },
        onHover: (hover) => {
          const key = hover ? `${hover.tileKey}-${hover.userId ?? ""}` : null;
          if (key !== lastHoverKeyRef.current) {
            lastHoverKeyRef.current = key;
            setHoveredEffectRef.current(hover);
          }
        },
      }),
    `${battleId}:${lightLayout}`,
    hasGameAssets && !!battleState.battle && !result,
  );
  const webglError = combat.error;
  fieldFailedRef.current = webglError || hasGameAssetsError;
  useEffect(() => {
    gridRef.current = combat.scene.current?.grid ?? null;
    const mount = mountRef.current;
    if (!combat.isReady || !mount) return;
    const dismissAggro = () => setAggroTarget(null);
    mount.addEventListener("pointerdown", dismissAggro, { passive: true });
    mount.addEventListener("touchstart", onDocumentTouchStart, { passive: true });
    mount.addEventListener("touchend", onDocumentTouchEnd, { passive: true });
    mount.addEventListener("touchcancel", onDocumentTouchEnd, { passive: true });
    mount.addEventListener("pointermove", onDocumentPointerMove, { passive: true });
    return () => {
      clearTouchDetailsTimer();
      mount.removeEventListener("pointerdown", dismissAggro);
      mount.removeEventListener("touchstart", onDocumentTouchStart);
      mount.removeEventListener("touchend", onDocumentTouchEnd);
      mount.removeEventListener("touchcancel", onDocumentTouchEnd);
      mount.removeEventListener("pointermove", onDocumentPointerMove);
    };
  }, [combat.isReady]);
  useEffect(() => {
    combat.scene.current?.refresh();
  }, [
    battleState.battle,
    props.action,
    props.userId,
    gameAssets,
    userData,
    isPageActive,
    config,
    combat.isReady,
    lightingPreviewDate,
    weatherPreview,
  ]);
  useEffect(() => {
    lastHoverKeyRef.current = null;
    setHoveredEffect(null);
    setAggroTarget(null);
  }, [battleId, result, config.showAggro]);

  // Clear hover state on mouse leave from combat area
  useEffect(() => {
    const sceneRef = mountRef.current;
    if (!sceneRef) return;

    const handleMouseLeave = () => {
      setHoveredEffect(null);
      setAggroTarget(null);
    };

    sceneRef.addEventListener("mouseleave", handleMouseLeave);
    return () => {
      sceneRef.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, []);

  // Derived variables
  const showShrineAgain = result?.outcome === "Won" && battleType === "SHRINE_WAR";
  const showTravelBtn = battleType === "QUEST" && !getIsolatedPyramid(userData);
  const initiveWinner = battleRef.current?.usersState.find(
    (u) => u.userId === battleRef.current?.activeUserId,
  );
  const toHospital =
    !!battleRef.current &&
    !!result &&
    sendsToHospital(battleRef.current, result.curHealth);

  const handleTutorialBattleReturn = async (
    event: React.MouseEvent<HTMLAnchorElement>,
    destination: string,
  ) => {
    if (!currentStep || !userData?.tutorialOn || getIsolatedPyramid(userData)) return;
    event.preventDefault();
    if (tutorialReturnLockRef.current) return;
    tutorialReturnLockRef.current = true;
    setIsReturningFromTutorial(true);
    try {
      // Navigation must wait for the confirmed profile: a cached BATTLE status
      // otherwise makes the tutorial redirect back to the fight that just ended.
      const profile = await utils.profile.getUser.fetch(undefined, { staleTime: 0 });
      router.push(
        getTutorialBattleReturnPage(
          TUTORIAL_STEPS,
          profile.userData,
          result?.outcome,
          destination,
        ),
      );
    } catch {
      showMutationToast({
        success: false,
        message: "Could not load your updated character. Please try returning again.",
      });
    } finally {
      tutorialReturnLockRef.current = false;
      setIsReturningFromTutorial(false);
    }
  };

  return (
    <>
      <div id="tutorial-combat-field" ref={mountRef} hidden={!!result}></div>

      {!result && !isInLobby && !webglError && combat.isReady && battleState.battle && (
        <div className="absolute top-2 right-2 z-10">
          <DayNightIndicator
            previewDate={lightingPreviewDate}
            onPreviewDateChange={setLightingPreviewDate}
            previewWeather={weatherPreview}
            onPreviewWeatherChange={setWeatherPreview}
          />
        </div>
      )}

      {!result &&
        (!hasGameAssets || !combat.isReady) &&
        !webglError &&
        (hasGameAssetsError ? (
          <div className="p-3 text-center" role="alert">
            <p>Unable to load battlefield assets.</p>
            <Button
              onClick={() => void refetchGameAssets()}
              disabled={isFetchingGameAssets}
            >
              {isFetchingGameAssets ? "Retrying..." : "Retry"}
            </Button>
          </div>
        ) : (
          <Loader explanation="Loading Battlefield" />
        ))}

      {!result && !isInLobby && !webglError && battleState.battle && (
        <CombatResourceBars
          battle={presentedBattle ?? battleState.battle}
          userId={controlledActorId}
          visibility={config.resourceBarsVisibility}
        />
      )}

      {/* Character clicks reveal aggro; hover and long-press reveal effects. */}
      {!result && detailsTarget && detailsEffects && (
        <div
          role="tooltip"
          ref={hoverTooltipRef}
          className="pointer-events-none fixed z-50 flex max-h-[calc(100dvh-1rem)] w-64 max-w-[calc(100vw-1rem)] flex-col gap-3 overflow-y-auto rounded-lg bg-black/90 p-3 text-white shadow-xl"
        >
          {showAggro && detailsEffects.userId && (
            <CombatAggro aggro={aggro} userId={detailsEffects.userId} />
          )}
          {detailsEffects.userId && (
            <VisualizeEffects
              effects={detailsEffects.userEffects}
              userId={detailsEffects.userId}
              diffuseDamage={detailsEffects.diffuseDamage}
            />
          )}
          {detailsEffects.groundEffects.length > 0 && (
            <VisualizeGroundEffects effects={detailsEffects.groundEffects} />
          )}
        </div>
      )}

      {webglError && <WebGlError />}
      {/* BATTLE LOBBY SCREEN */}
      {isInLobby &&
        battleRef.current &&
        PvpBattleTypes.includes(battleRef.current.battleType) && (
          <div className="absolute top-0 right-0 bottom-0 left-0 z-20 m-auto overflow-y-auto bg-black/90">
            <div className="flex h-full flex-col items-center justify-center text-white">
              <p className="text-3xl">Waiting for opponent</p>
              <p className="text-xl">
                Time Left:{" "}
                <Countdown
                  targetDate={battleRef.current.createdAt}
                  timeDiff={timeDiff}
                />
              </p>
              <p className="mb-2 flex flex-row text-lg">
                Initiative Winner: {initiveWinner?.username}{" "}
                <Link href="/manual/combat">
                  <HelpCircle className="h6 ml-2 w-6 hover:text-orange-500" />
                </Link>
              </p>
              <div className="flex flex-row gap-4">
                {battleRef.current.usersState
                  .filter((u) => u.isOriginal && !u.isAi)
                  .map((u) => {
                    return (
                      <div
                        key={`${u.userId}-initiative-${u.initiative}`}
                        className="relative flex flex-col items-center font-bold"
                      >
                        <Image
                          alt={`roll-${u.userId}`}
                          src={IMG_INITIATIVE_D20}
                          height={60}
                          width={60}
                        ></Image>
                        <p className="absolute top-7 text-md">
                          {Math.floor(u.initiative)}
                        </p>
                        <p>
                          {u.username}{" "}
                          {u.iAmHere ||
                          (u.userId === suid && readySettledBattleId === battleId)
                            ? "(✓)"
                            : ""}
                        </p>
                      </div>
                    );
                  })}
              </div>
              <fieldset
                className="mt-3 flex flex-row items-end gap-3"
                disabled={isMarkingReady || hasSettledReady || !!activePendingLoadout}
                aria-busy={isMarkingReady || !!activePendingLoadout}
              >
                {(battleRef.current.battleType === "COMBAT" ||
                  battleRef.current.battleType === "SPARRING") && (
                  <>
                    <ItemLoadoutSelector
                      variant="dropdown"
                      label="Item Loadout"
                      onSelectOverride={(loadoutId, displayName) =>
                        handleSelectLoadout("item", loadoutId, displayName)
                      }
                      selectedOverrideId={battleSessionUser?.itemLoadout}
                    />
                    <JutsuLoadoutSelector
                      variant="dropdown"
                      label="Jutsu Loadout"
                      onSelectOverride={(loadoutId, displayName) =>
                        handleSelectLoadout("jutsu", loadoutId, displayName)
                      }
                      selectedOverrideId={battleSessionUser?.jutsuLoadout}
                    />
                  </>
                )}
                <Button
                  variant="secondary"
                  className="shrink-0"
                  disabled={isMarkingReady || hasSettledReady || !!activePendingLoadout}
                  aria-busy={isMarkingReady || !!activePendingLoadout}
                  onClick={handleMarkReady}
                >
                  {isMarkingReady ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                      Confirming
                    </>
                  ) : hasSettledReady ? (
                    <>
                      <Check className="mr-2 h-4 w-4" aria-hidden />
                      Ready
                    </>
                  ) : (
                    "I'm Ready"
                  )}
                </Button>
              </fieldset>
              {activePendingLoadout && (
                <p
                  className="mt-2 flex items-center text-sm text-white/80"
                  role="status"
                  aria-live="polite"
                >
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                  Saving
                </p>
              )}
            </div>
          </div>
        )}
      {/* FINAL DONE SCREEN */}
      {result && (
        <div className="relative z-20 bg-black/90">
          <div className="mx-auto max-w-3xl px-3 pb-3 text-center text-white sm:px-5 sm:pb-5">
            <p className="p-5 pb-2 text-3xl">You {result.outcome}</p>
            <div className="space-y-4 bg-background p-3 text-foreground sm:p-4">
              {result.hunting && (
                <HuntingBoard
                  victory={result.hunting}
                  onStarted={() => setBattleAtom(undefined)}
                />
              )}
              <CombatRewards
                result={result}
                isOutlaw={!!userData?.isOutlaw}
                isQuest={battleType === "QUEST"}
                showPvpEnergy={
                  !!battleRef.current &&
                  isPvpEnergyRewardBattle(battleRef.current, props.userId)
                }
              />
            </div>
            <div className="grid gap-2 pt-3 sm:grid-cols-2 [&>:only-child]:sm:col-span-2">
              <Link
                href={
                  getIsolatedPyramid(userData)
                    ? "/combat"
                    : toHospital
                      ? "/hospital"
                      : "/profile"
                }
                className="w-full"
                onClick={(event) => {
                  void handleTutorialBattleReturn(
                    event,
                    toHospital ? "/hospital" : "/profile",
                  );
                }}
              >
                <Button
                  id="return"
                  className="w-full"
                  disabled={isReturningFromTutorial}
                  aria-busy={isReturningFromTutorial}
                  onClick={() => {
                    if (getIsolatedPyramid(userData)) setBattleState(undefined);
                  }}
                >
                  {isReturningFromTutorial
                    ? "Returning..."
                    : getIsolatedPyramid(userData)
                      ? "Continue Pyramid"
                      : currentStep && userData?.tutorialOn
                        ? "Continue tutorial"
                        : `Return to ${toHospital ? "Hospital" : "Profile"}`}
                </Button>
              </Link>
              {showShrineAgain && (
                <Link href="/shrine" className="w-full">
                  <Button id="return" className="w-full">
                    Back to Shrine
                  </Button>
                </Link>
              )}
              {props.arenaActions}
              {battleType === "RANKED_PVP" && (
                <Link href="/battlearena#PVP%20Rank" className="w-full">
                  <Button id="toPvpRank" className="w-full">
                    Back to PvP Queue
                  </Button>
                </Link>
              )}
              {battleRef.current?.extraState.dungeon && (
                <Link href="/dungeon" className="w-full">
                  <Button className="w-full">Return to party</Button>
                </Link>
              )}
              {showTravelBtn && (
                <Link
                  href="/travel"
                  className="w-full"
                  onClick={(event) => {
                    void handleTutorialBattleReturn(event, "/travel");
                  }}
                >
                  <Button
                    id="toTravel"
                    className="w-full"
                    disabled={isReturningFromTutorial}
                    aria-busy={isReturningFromTutorial}
                  >
                    {isReturningFromTutorial ? "Returning..." : "To Map"}
                  </Button>
                </Link>
              )}
            </div>
          </div>
        </div>
      )}
      {logbookModalQuestId && (
        <QuestUpdateModal
          questId={logbookModalQuestId}
          onClose={() => setLogbookModalQuestId(null)}
        />
      )}
    </>
  );
};

export default Combat;
