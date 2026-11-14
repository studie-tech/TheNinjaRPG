"use client";

import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { Loader2, Maximize2 } from "lucide-react";
import dynamic from "next/dynamic";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AutoBattleTypes,
  BATTLE_ARENA_HEAL_COST,
  ManualStartBattleTypes,
} from "@/drizzle/constants";
import {
  type CombatLayoutComponentId,
  useAutoCombatSetting,
  useCombatPreferences,
} from "@/hooks/combat";
import { loadCombat } from "@/hooks/combatEntry";
import { useLocalStorage } from "@/hooks/localstorage";
import { useLpcCatalogLoader } from "@/hooks/lpc";
import { useNavigationRouter as useRouter } from "@/hooks/navigation";
import { useTutorialStep } from "@/hooks/tutorial";
import { useBattleHotkeys } from "@/hooks/useBattleHotkeys";
import ActionTimer from "@/layout/ActionTimer";
import { AutoCombatBadge, AutoCombatControl } from "@/layout/AutoCombatControl";
import { BattleFocusView } from "@/layout/BattleFocusView";
import { ActionSelector } from "@/layout/CombatActions";
import { CombatElementalSealNotice } from "@/layout/CombatElementalSealNotice";
import CombatHistory from "@/layout/CombatHistory";
import { CombatNoJutsuNotice } from "@/layout/CombatNoJutsuNotice";
import CombatTimeline from "@/layout/CombatTimeline";
import ContentBox from "@/layout/ContentBox";
import { HotkeyCaptureDialog, type HotkeyTarget } from "@/layout/HotkeyControls";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import { PyramidRun } from "@/layout/PyramidRunBoundary";
import { UserCombatSettings } from "@/layout/UserCombatSettings";
import { showActionReadinessToast } from "@/libs/actionFeedback";
import { canAttemptAwakeAction } from "@/libs/actionReadiness";
import { battleActionGrid } from "@/libs/combat/actionGrid";
import {
  actionPointsAfterAction,
  availableUserActions,
  getActionPointCost,
} from "@/libs/combat/actions";
import { isBattleHotkeyBlocked, toHotkey } from "@/libs/combat/hotkeys";
import { resolveControlledActorId } from "@/libs/combat/turn";
import type { BattleState } from "@/libs/combat/types";
import { hexGridHeightRatio } from "@/libs/hexgrid";
import { isBetweenPyramidBattles } from "@/libs/questRun";
import { cn } from "@/libs/shadui";
import { showMutationToast } from "@/libs/toast";
import { isTutorialActive } from "@/libs/tutorial";
import {
  combatActionIdAtom,
  combatHeldResultAtom,
  combatThemeHeldAtom,
  useRequiredUserData,
  userBattleAtom,
} from "@/utils/UserContext";
import type { StatSchemaType } from "@/validators/combat";

const Combat = dynamic(loadCombat, {
  ssr: false,
  loading: () => <Loader explanation="Loading Battlefield" />,
});

/** Keeps battle state, handover and hotkeys shared between focus and game layouts. */
export default function CombatPage() {
  // State
  const router = useRouter();
  const [actionId, setActionId] = useAtom(combatActionIdAtom);
  const config = useCombatPreferences();
  const [battleState, setBattleState] = useState<BattleState | undefined>(undefined);
  const [lastViewedVersion, setLastViewedVersion] = useState<number>(0);
  const [activeTab, setActiveTab] = useState<string>("actions");
  const [autoCombatError, setAutoCombatError] = useState<string>();
  const [hotkeyTarget, setHotkeyTarget] = useState<HotkeyTarget | null>(null);
  const arenaHealInFlightRef = useRef(false);
  const arenaStartInFlightRef = useRef(false);
  const battleFocusButtonRef = useRef<HTMLButtonElement>(null);
  const layoutRef = useRef<HTMLDivElement>(null);
  const wasBattleFocusRef = useRef(config.battleFocus);
  const [statDistribution] = useLocalStorage<StatSchemaType | undefined>(
    "statDistribution",
    undefined,
  );
  const [autoCombat] = useAutoCombatSetting();

  useEffect(() => {
    const shouldRestoreFocus = wasBattleFocusRef.current && !config.battleFocus;
    wasBattleFocusRef.current = config.battleFocus;
    if (!shouldRestoreFocus) return;
    // The focus button remounts with the layout; finished battle controls are inert.
    const button = battleFocusButtonRef.current;
    const target = button && !button.closest("[inert]") ? button : layoutRef.current;
    target?.focus({ preventScroll: true });
  }, [config.battleFocus]);

  // Download and evaluate the scene while the battle query is in flight.
  useEffect(() => {
    void loadCombat().catch(() => undefined);
  }, []);

  // Data from the DB
  const setBattleAtom = useSetAtom(userBattleAtom);
  // The page owns shared battle state across battlefield layout remounts.
  useEffect(
    () => () => {
      setBattleAtom(undefined);
    },
    [setBattleAtom],
  );
  const utils = api.useUtils();
  const {
    data: userData,
    pusher,
    prepareUserUpdate,
    updateUser,
  } = useRequiredUserData();
  // Another tab can release the profile before this tab receives its completed battle.
  const [lastBattleId, setLastBattleId] = useState(userData?.battleId);
  useEffect(() => {
    if (userData?.battleId) setLastBattleId(userData.battleId);
  }, [userData?.battleId]);
  const requestedBattleId = userData?.battleId ?? lastBattleId;
  // The battlefield reuses the catalog travel already holds, refreshing it for later scenes;
  // a cold cache loads it alongside the battle rather than after it.
  const loadLpcCatalog = useLpcCatalogLoader({
    revalidateInBackground: true,
    preload: !!requestedBattleId,
  });
  const { data, isLoading, isSuccess, isError, isFetching, refetch } =
    api.combat.getBattle.useQuery(
      { battleId: requestedBattleId },
      { enabled: !!requestedBattleId },
    );

  // Mutation for handing turns to / taking them back from the user's AI profile
  const { mutate: toggleAutoCombat, isPending: isTogglingAutoCombat } =
    api.combat.toggleAutoCombat.useMutation({
      onMutate: () => {
        setAutoCombatError(undefined);
        return prepareUserUpdate();
      },
      onSuccess: async (result, input, revision) => {
        if (result.success && !input.enabled) setActiveTab("actions");
        setAutoCombatError(result.success ? undefined : result.message);
        if (result.message) showMutationToast(result);
        await Promise.all([
          utils.combat.getBattle.invalidate(),
          ...(result.success ? [updateUser(result, { revision })] : []),
        ]);
      },
      onError: (error) => {
        setAutoCombatError(error.message);
        // Badge actions remain recoverable even while the settings popover is closed.
        showMutationToast({ success: false, message: error.message });
      },
    });

  // Derived variables
  const userId = userData?.userId;
  const results = battleState?.result;
  const heldResultVersion = useAtomValue(combatHeldResultAtom);
  // Keeps the battle layout while the field replays the action that ended it.
  const resultShown = !!results && heldResultVersion === undefined;
  const setCombatThemeHeld = useSetAtom(combatThemeHeldAtom);
  useEffect(() => {
    setCombatThemeHeld(!!results);
    return () => setCombatThemeHeld(false);
  }, [results, setCombatThemeHeld]);
  const battle = battleState?.battle;
  const isBattleMissing = isSuccess && data.battle === null;
  const versionId = battle?.version;
  // The actor the human controls right now: themselves, or their piloted summon
  // on the summon's turn (control is sequential -> exactly one).
  const controlledActorId = resolveControlledActorId(battle, userId);
  const user = battle?.usersState.find((u) => u.userId === controlledActorId);
  const availableActionPoints = user
    ? actionPointsAfterAction(user, battle).availableActionPoints
    : undefined;
  // The session user's own battle entry (auto combat is a property of the
  // player, not of whichever actor is currently controlled)
  const sessionBattleUser = battle?.usersState.find((u) => u.userId === userId);
  // Keys follow this battle's loadouts, which the lobby can change.
  const hotkeys = useBattleHotkeys({
    jutsuLoadoutId: sessionBattleUser?.jutsuLoadout,
    itemLoadoutId: sessionBattleUser?.itemLoadout,
  });
  const isAutoCombatActive = !!sessionBattleUser?.isAutoCombat;
  const arenaOpponentId = battle?.usersState.find(
    (u) => u.userId !== userId && !u.isSummon && u.isAi,
  )?.controllerId;
  const needsArenaHealing =
    !!userData &&
    !!results &&
    (results.curHealth < userData.maxHealth ||
      results.curStamina < userData.maxStamina ||
      results.curChakra < userData.maxChakra);
  const canAffordArenaHealing = (userData?.money ?? 0) >= BATTLE_ARENA_HEAL_COST;
  const canHealFromCurrentStatus = canAttemptAwakeAction(userData);
  const showNextMatch =
    results?.outcome === "Won" &&
    (battle?.battleType === "ARENA" || battle?.battleType === "TRAINING");
  const visibleTab =
    isAutoCombatActive && activeTab === "actions"
      ? config.showTimeline
        ? "timeline"
        : "history"
      : activeTab;
  // Scheduled title fights retain their agreed mode; automatic battle types have no manual handover.
  const canToggleAutoCombat =
    !!battle &&
    !AutoBattleTypes.includes(battle.battleType) &&
    !battle.extraState.tournamentAiOnly &&
    !battle.extraState.kageMatch &&
    !!sessionBattleUser &&
    !sessionBattleUser.isAi &&
    sessionBattleUser.curHealth > 0 &&
    !sessionBattleUser.fledBattle &&
    !sessionBattleUser.leftBattle;
  const isTutorialRunning = isTutorialActive(userData);
  // Keep a finished battle's actions and settings dimmed and inert until the player leaves.
  const isInBattle = userData?.status === "BATTLE" || !!results;
  // After "Go Again" the finished battle is held in state until the next one's data is
  // applied; keep the scene back until then rather than remount the finished battle.
  const isBattleLoading =
    isLoading ||
    (!!requestedBattleId && !userData?.battleId && !results && isFetching) ||
    (!!data?.battle && data.battle.id !== battle?.id);

  // Calculate number of unread actions
  const unreadActions = battle?.version
    ? Math.max(0, battle.version - lastViewedVersion)
    : 0;

  // Track the history currently visible, including the auto combat tab fallback.
  useEffect(() => {
    if (config.showBattleLog && visibleTab === "history" && battle?.version) {
      setLastViewedVersion(battle.version);
    }
  }, [visibleTab, config.showBattleLog, battle?.version]);

  // Force actions tab when timeline or battle log is hidden
  useEffect(() => {
    if (!config.showBattleLog && activeTab === "history") {
      setActiveTab("actions");
    }
    if (!config.showTimeline && activeTab === "timeline") {
      setActiveTab("actions");
    }
  }, [config.showBattleLog, config.showTimeline, activeTab]);

  // Tutorial step
  const { currentStep, handleNextStep } = useTutorialStep();

  // Redirect hospitalized users without a battle to hospital
  useEffect(() => {
    if (
      userData?.status === "HOSPITALIZED" &&
      !userData?.battleId &&
      (!requestedBattleId || isBattleMissing) &&
      !isLoading &&
      !results
    ) {
      router.push("/hospital");
    }
  }, [
    userData?.status,
    userData?.battleId,
    requestedBattleId,
    isBattleMissing,
    isLoading,
    results,
    router,
  ]);

  // Mirror the fetched battle into local state (keeping held results for the same
  // battle) and advance tutorial steps on a settled outcome.
  useEffect(() => {
    if (data?.battle) {
      // Share Combat's exact query key so the request starts before its mount.
      void utils.misc.getAllGameAssetNames.prefetch({
        ids: [
          ...(data.battle.extraState.textureAssets ?? []),
          ...(data.battle.extraState.sfxAssets ?? []),
        ],
      });
      const res = results && battle?.id === data.battle.id ? results : data?.result;
      setBattleAtom(data.battle);
      setBattleState({ battle: data?.battle, result: res, isPending: false });
      if (res) {
        if (currentStep?.onCombatWin && res.outcome === "Won") {
          handleNextStep(currentStep.onCombatWin);
        } else if (currentStep?.onCombatLoss && res.outcome !== "Won") {
          handleNextStep(currentStep.onCombatLoss);
        }
      }
    }
  }, [data]);

  // A different client can settle combat while this profile still holds its ID.
  // Reconcile from the server without clearing held results or a newer battle.
  useEffect(() => {
    if (userId && !results && (!requestedBattleId || isBattleMissing)) {
      const heldBattleId = battle?.id;
      setBattleAtom((current) =>
        current && current.id === heldBattleId ? undefined : current,
      );
    }
    if (isBattleMissing && !results) {
      if (userData?.battleId) void utils.profile.getUser.invalidate();
      const ownBattleId = userData?.battleId;
      if (battle && battle.id === ownBattleId && battle.extraState.dungeon) {
        router.push("/dungeon");
      }
    }
  }, [
    isBattleMissing,
    userId,
    userData?.battleId,
    requestedBattleId,
    battle?.id,
    battle?.extraState.dungeon,
    results,
    setBattleAtom,
    router,
    utils,
  ]);

  // Collect all possible actions for the controlled actor (self, or piloted
  // summon on its turn) so the action panel shows the summon's jutsu/pools.
  const actions = useMemo(() => {
    return availableUserActions(battleState?.battle, controlledActorId);
  }, [versionId, controlledActorId]);

  // A successful arena heal is a paid, one-shot action for the current finished
  // battle. The page owns settlement and pending requests so battlefield layout
  // remounts cannot expose another charge or a duplicate battle start.
  const arenaHealBattleKey = battle?.id ?? "finished-arena";
  const [arenaHealSettledBattleId, setArenaHealSettledBattleId] = useState<
    string | null
  >(null);
  const hasSettledArenaHeal = arenaHealSettledBattleId === arenaHealBattleKey;

  // Mutation for healing before starting another arena fight
  const { mutate: battleArenaHealAndGo, isPending: isArenaHealPending } =
    api.combat.battleArenaHeal.useMutation({
      onMutate: prepareUserUpdate,
      onSuccess: async (data, _variables, revision) => {
        if (data.success || data.userRecovery)
          await updateUser(data, { revision, refetch: false });
        if (data.success) {
          setArenaHealSettledBattleId(arenaHealBattleKey);
        }
        if (data.success && arenaOpponentId) {
          showActionReadinessToast(data);
          handleStartArenaBattle("post-heal");
        } else {
          showMutationToast(data);
        }
      },
      onSettled: () => {
        arenaHealInFlightRef.current = false;
      },
    });

  // Mutation for starting a fight
  const { mutate: startArenaBattle, isPending: isStartingArenaBattle } =
    api.combat.startArenaBattle.useMutation({
      onMutate: prepareUserUpdate,
      onSuccess: async (result, _variables, revision) => {
        if (result.success && result.battleId) {
          showActionReadinessToast(result);
          setBattleAtom(undefined);
          // The finished battle and its result stay in place until the next battle
          // loads, so the battlefield keeps its reserved size and nothing turns live.
          await updateUser(result, { revision, refetch: false });
          void utils.combat.getBattle.invalidate();
        } else {
          if (result.userRecovery)
            await updateUser(result, { revision, refetch: false });
          showMutationToast(result);
        }
      },
      onSettled: () => {
        arenaStartInFlightRef.current = false;
      },
    });

  /** Reserves one retry, allowing a successful heal to hand off before its mutation settles. */
  const handleStartArenaBattle = (source: "repeat" | "post-heal") => {
    if (
      arenaStartInFlightRef.current ||
      isStartingArenaBattle ||
      (source === "repeat" && isArenaHealPending) ||
      !arenaOpponentId
    ) {
      return;
    }
    arenaStartInFlightRef.current = true;
    startArenaBattle({
      aiId: arenaOpponentId,
      originSocketId: pusher?.connection.socket_id,
      stats: battle?.battleType === "TRAINING" ? statDistribution : undefined,
      autoCombat,
    });
  };

  /** Reserves one paid heal for this result before handing off to the next match. */
  const handleArenaHealAndGo = () => {
    if (
      arenaHealInFlightRef.current ||
      isArenaHealPending ||
      isStartingArenaBattle ||
      hasSettledArenaHeal ||
      !needsArenaHealing ||
      !canAffordArenaHealing ||
      !canHealFromCurrentStatus
    ) {
      return;
    }
    arenaHealInFlightRef.current = true;
    battleArenaHealAndGo();
  };

  const arenaActions = showNextMatch &&
    arenaOpponentId &&
    (!currentStep || !userData?.tutorialOn) && (
      <div className="space-y-2">
        <Button
          id="return"
          className="w-full"
          disabled={isArenaHealPending || isStartingArenaBattle}
          aria-busy={isStartingArenaBattle}
          aria-live="polite"
          onClick={() => handleStartArenaBattle("repeat")}
        >
          {isStartingArenaBattle && (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
          )}
          {isStartingArenaBattle ? "Starting" : "Go Again"}
        </Button>

        <Button
          id="heal-return"
          className="w-full"
          disabled={
            isArenaHealPending ||
            isStartingArenaBattle ||
            hasSettledArenaHeal ||
            !needsArenaHealing ||
            !canAffordArenaHealing ||
            !canHealFromCurrentStatus
          }
          aria-busy={isArenaHealPending || isStartingArenaBattle}
          aria-live="polite"
          onClick={handleArenaHealAndGo}
        >
          {(isArenaHealPending || (hasSettledArenaHeal && isStartingArenaBattle)) && (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
          )}
          {isArenaHealPending
            ? "Healing"
            : hasSettledArenaHeal && isStartingArenaBattle
              ? "Starting"
              : hasSettledArenaHeal
                ? "Healed — use Go Again"
                : !canHealFromCurrentStatus
                  ? "Healing unavailable"
                  : !needsArenaHealing
                    ? "Already fully healed"
                    : !canAffordArenaHealing
                      ? `Need ${BATTLE_ARENA_HEAL_COST} Ryo to heal`
                      : `Heal and Go Again (-${BATTLE_ARENA_HEAL_COST} Ryo)`}
        </Button>
      </div>
    );

  // Battle scene. Pass the CONTROLLED actor (self, or the piloted summon on its
  // turn) so Combat does not have to re-derive it from the same battle object.
  // The WebGL scene stays mounted while newly revealed action assets load.
  const combat = battleState && controlledActorId && (
    <Combat
      battleState={battleState}
      action={actions.find((a) => a.id === actionId)}
      userId={controlledActorId}
      setBattleState={setBattleState}
      config={config}
      endTurnKey={hotkeys.byAction.wait}
      arenaActions={arenaActions}
      loadLpcCatalog={loadLpcCatalog}
    />
  );

  // Battle hotkeys select actions by id. A bound action that is unavailable
  // right now (stealth, disarm, cooldown, too little AP) ignores its key rather
  // than letting another action take its place. End Turn is handled by Combat.
  useEffect(() => {
    const onDocumentKeyDown = (event: KeyboardEvent) => {
      // A held key repeats keydown, which would toggle the selection on and off.
      if (
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.repeat ||
        hotkeyTarget
      )
        return;
      if (isBattleHotkeyBlocked(event)) return;
      if (event.key === "Escape" && actionId) {
        setActionId(undefined);
        return;
      }
      const key = toHotkey(event.key);
      const boundId = key ? hotkeys.byKey[key] : undefined;
      if (!boundId || boundId === "wait" || results) return;
      const action = actions.find((a) => a.id === boundId);
      if (!action || !battle) return;
      const onCooldown =
        !!action.cooldown &&
        action.lastUsedRound !== undefined &&
        battle.round - action.lastUsedRound < action.cooldown;
      const cost = controlledActorId
        ? getActionPointCost(controlledActorId, battle, action)
        : action.actionCostPerc;
      const tooExpensive =
        availableActionPoints !== undefined &&
        cost !== undefined &&
        availableActionPoints < cost;
      if (actionId !== boundId && (onCooldown || tooExpensive)) return;
      event.preventDefault();
      setActionId(actionId === boundId ? undefined : boundId);
    };
    document.addEventListener("keydown", onDocumentKeyDown);
    return () => {
      document.removeEventListener("keydown", onDocumentKeyDown);
    };
  }, [
    actionId,
    actions,
    battle,
    controlledActorId,
    hotkeyTarget,
    hotkeys.byKey,
    results,
    setActionId,
    availableActionPoints,
  ]);

  // Action click handler
  const handleActionClick = useCallback(
    (id: string) => {
      if (id === actionId) {
        setActionId(undefined);
      } else {
        setActionId(id);
      }
    },
    [actionId, setActionId],
  );

  /** Shares the same handover guards and feedback in settings and the focus view. */
  const renderAutoControl = useCallback(() => {
    if (!battle || !canToggleAutoCombat || results) return null;
    // The tutorial teaches manual fighting; it only offers the switch to hand back a
    // battle that is already running on auto.
    if (isTutorialRunning && !isAutoCombatActive) return null;
    return (
      <AutoCombatControl
        key={battle.id}
        isActive={isAutoCombatActive}
        isPending={isTogglingAutoCombat}
        requiresConfirmation={ManualStartBattleTypes.includes(battle.battleType)}
        error={autoCombatError}
        onChange={(enabled) => toggleAutoCombat({ battleId: battle.id, enabled })}
      />
    );
  }, [
    battle,
    canToggleAutoCombat,
    results,
    isAutoCombatActive,
    isTutorialRunning,
    isTogglingAutoCombat,
    autoCombatError,
    toggleAutoCombat,
  ]);

  /** Shares timer controls across layouts while keeping the exit available for held results. */
  const renderTimer = useCallback(
    (focusExit?: ReactNode) => {
      if (!battle || !user || !isInBattle || !battleState) {
        // Hold the timer's height while the battle loads, so nothing below it moves.
        return isInBattle ? <div className="h-16" /> : null;
      }
      return (
        <div
          className={cn(
            "flex flex-row items-center gap-2",
            resultShown && "opacity-50",
          )}
          id="tutorial-combat-action-timer"
        >
          <ActionTimer
            action={actions.find((a) => a.id === actionId)}
            user={{
              userId: controlledActorId,
              actionPoints: user.actionPoints,
            }}
            battle={battle}
            isPending={battleState.isPending}
            options={
              <>
                {focusExit}
                {!config.battleFocus && (
                  <Button
                    ref={battleFocusButtonRef}
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-10 w-10"
                    aria-label="Battle focus"
                    inert={resultShown}
                    title="Battle focus: open the battle dialog"
                    onClick={() => config.setBattleFocus(true)}
                  >
                    <Maximize2 className="h-5 w-5" />
                  </Button>
                )}
                <div className="flex" inert={resultShown}>
                  <UserCombatSettings
                    config={config}
                    userData={userData}
                    autoCombatControl={renderAutoControl()}
                  />
                </div>
              </>
            }
          />
        </div>
      );
    },
    [
      battle,
      user,
      isInBattle,
      battleState,
      resultShown,
      actions,
      actionId,
      controlledActorId,
      config,
      userData,
      renderAutoControl,
    ],
  );

  const renderBattlefield = useCallback(() => {
    // Reserve the canvas while loading. Settled results use their content height so
    // rewards and follow-up actions never need a second scrollbar on small screens.
    return (
      <div
        className="relative box-content overflow-hidden rounded-lg border bg-card text-card-foreground shadow-lg"
        style={
          battle && !resultShown
            ? {
                aspectRatio: `1 / ${hexGridHeightRatio(battle.width, battle.height)}`,
              }
            : undefined
        }
      >
        {!isBattleLoading && combat}
        {!isBattleLoading && !resultShown && battle && isAutoCombatActive && (
          <div className="absolute top-2 left-2 z-20">
            <AutoCombatBadge
              isPending={isTogglingAutoCombat}
              onDisable={
                canToggleAutoCombat
                  ? () => toggleAutoCombat({ battleId: battle.id, enabled: false })
                  : undefined
              }
            />
          </div>
        )}
        {isBattleLoading && <Loader explanation="Loading Battle Data" />}
      </div>
    );
  }, [
    isBattleLoading,
    combat,
    resultShown,
    battle,
    isAutoCombatActive,
    isTogglingAutoCombat,
    canToggleAutoCombat,
    toggleAutoCombat,
  ]);

  /** Both layouts share action selection, editable hotkeys and the small-icon setting. */
  const renderActions = useCallback(
    (focus = false) => {
      if (!isInBattle || !battle || isAutoCombatActive) return null;
      const layout = battleActionGrid({ focus, small: config.useSmallActions });
      return (
        <div
          className={cn("flex flex-col gap-1", resultShown && "opacity-50")}
          inert={resultShown}
        >
          {!isTutorialRunning && (
            <CombatNoJutsuNotice battle={battle} userId={userId} />
          )}
          <CombatElementalSealNotice battle={battle} userId={controlledActorId} />
          <ActionSelector
            showInfoIcon={true}
            items={actions}
            currentRound={battle.round}
            className="p-1"
            showBgColor={true}
            eagerImages={true}
            showLabels={layout.labels}
            selectedId={actionId}
            combatMode={true}
            userActionPoints={availableActionPoints}
            battle={battle}
            userId={controlledActorId}
            gridClassNameOverwrite={layout.grid}
            aspectRatioClass={layout.aspect}
            onClick={handleActionClick}
            hotkeys={hotkeys.byAction}
            onAssignHotkey={(item) =>
              setHotkeyTarget({
                id: item.id,
                name: item.name,
                kind: item.type === "item" ? "item" : "jutsu",
              })
            }
          />
        </div>
      );
    },
    [
      isInBattle,
      battle,
      isAutoCombatActive,
      resultShown,
      actions,
      config.useSmallActions,
      actionId,
      availableActionPoints,
      controlledActorId,
      handleActionClick,
      hotkeys.byAction,
      isTutorialRunning,
      userId,
    ],
  );

  // Focus keeps history available independently of the embedded layout preferences.
  const renderTimeline = useCallback(
    (focus = false) => {
      if ((!focus && !config.showTimeline) || !battle) return null;
      return (
        <CombatTimeline battle={battle} showBasicActions={config.showBasicActions} />
      );
    },
    [config.showTimeline, config.showBasicActions, battle],
  );

  const renderBattleLog = useCallback(
    (focus = false) => {
      if ((!focus && !config.showBattleLog) || !battle) return null;
      return (
        <CombatHistory
          battleId={battle.id}
          battleVersion={battle.version}
          battleRound={battle.round}
          results={results}
        />
      );
    },
    [config.showBattleLog, battle, results],
  );

  // Component renderer based on ID
  const renderComponent = useCallback(
    (id: CombatLayoutComponentId) => {
      switch (id) {
        case "timer":
          return renderTimer();
        case "battlefield":
          return renderBattlefield();
        case "actions":
          return renderActions();
        case "timeline":
          return renderTimeline();
        case "battlelog":
          return renderBattleLog();
        default:
          return null;
      }
    },
    [renderTimer, renderBattlefield, renderActions, renderTimeline, renderBattleLog],
  );

  // Tabs content - groups actions, timeline, and battlelog
  const renderTabbedContent = useCallback(() => {
    if (
      !battle ||
      (isAutoCombatActive && !config.showTimeline && !config.showBattleLog)
    )
      return null;

    return (
      <Tabs
        defaultValue="actions"
        className="w-full"
        value={visibleTab}
        onValueChange={setActiveTab}
      >
        <TabsList className="w-full rounded-lg border">
          {!isAutoCombatActive && (
            <TabsTrigger value="actions" className="flex-1">
              Actions
            </TabsTrigger>
          )}
          {config.showTimeline && (
            <TabsTrigger value="timeline" className="flex-1">
              Timeline
            </TabsTrigger>
          )}
          {config.showBattleLog && (
            <TabsTrigger value="history" className="relative flex-1">
              History
              {unreadActions > 0 && visibleTab !== "history" && (
                <span className="absolute -top-1 -right-1 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-red-500 text-white text-xs">
                  {unreadActions}
                </span>
              )}
            </TabsTrigger>
          )}
        </TabsList>
        {!isAutoCombatActive && (
          <TabsContent value="actions" className="mt-0 p-1">
            {renderActions()}
          </TabsContent>
        )}
        {config.showTimeline && (
          <TabsContent value="timeline" className="mt-0 p-2">
            {renderTimeline()}
          </TabsContent>
        )}
        {config.showBattleLog && (
          <TabsContent value="history" className="mt-0 pt-0">
            {renderBattleLog()}
          </TabsContent>
        )}
      </Tabs>
    );
  }, [
    battle,
    config.showTimeline,
    config.showBattleLog,
    visibleTab,
    isAutoCombatActive,
    unreadActions,
    renderActions,
    renderTimeline,
    renderBattleLog,
  ]);

  if (!userData) return <Loader explanation="Loading userdata" />;
  if (isBetweenPyramidBattles(userData) && !results) return <PyramidRun />;
  if (!results && (!requestedBattleId || isBattleMissing)) {
    return (
      <ContentBox title="Combat">
        <p>You are not in an active battle.</p>
        <Button asChild className="mt-3">
          <Link href="/profile">Return to Profile</Link>
        </Button>
      </ContentBox>
    );
  }
  if (!battle && isError) {
    return (
      <ContentBox title="Combat">
        <p role="alert">Unable to load this battle. Please try again.</p>
        <Button className="mt-3" disabled={isFetching} onClick={() => void refetch()}>
          Retry
        </Button>
      </ContentBox>
    );
  }

  // Both layouts expose the same hotkey editor for the controlled actor's actions.
  const hotkeyDialog = (
    <HotkeyCaptureDialog
      target={hotkeyTarget}
      currentKey={hotkeyTarget ? hotkeys.byAction[hotkeyTarget.id] : undefined}
      onAssign={(key) =>
        hotkeyTarget &&
        hotkeys.setHotkey(
          hotkeyTarget.kind,
          hotkeyTarget.id,
          key,
          Object.fromEntries(actions.map((action) => [action.id, action.name])),
        )
      }
      onClose={() => setHotkeyTarget(null)}
    />
  );

  if (config.battleFocus && battle) {
    return (
      <>
        <BattleFocusView
          battle={battle}
          controlledActorId={controlledActorId}
          swapFocusPanels={config.swapFocusPanels}
          renderTimer={renderTimer}
          field={renderBattlefield()}
          fieldRatio={
            results ? undefined : hexGridHeightRatio(battle.width, battle.height)
          }
          dock={
            <>
              {renderActions(true)}
              {actionId && !results && !isAutoCombatActive && (
                <p className="text-muted-foreground mt-1 text-[11px]">
                  <span className="text-green-700">Green</span>: affected ·{" "}
                  <span className="text-red-500">Red</span>: not affected ·{" "}
                  <span className="text-blue-500">Blue</span>: move
                  {hotkeys.byAction.wait &&
                    ` · ${hotkeys.byAction.wait.toUpperCase()}: end turn`}
                </p>
              )}
            </>
          }
          autoControl={renderAutoControl()}
          log={renderBattleLog(true)}
          timeline={renderTimeline(true)}
          onShowLayout={() => config.setBattleFocus(false)}
        />
        {hotkeyDialog}
      </>
    );
  }

  // Determine which components are tabbed vs standalone
  const tabbedIds: CombatLayoutComponentId[] = ["actions", "timeline", "battlelog"];

  return (
    <div ref={layoutRef} tabIndex={-1} className="flex flex-col gap-1 sm:container">
      {config.useTabs ? (
        // Tabs mode: render non-tabbed components in order, then tabs
        <>
          {config.layoutOrder
            .filter((id) => !tabbedIds.includes(id))
            .map((id) => (
              <div key={id}>{renderComponent(id)}</div>
            ))}
          {renderTabbedContent()}
        </>
      ) : (
        // Non-tabs mode: render all components in order
        config.layoutOrder.map((id) => <div key={id}>{renderComponent(id)}</div>)
      )}

      {!isAutoCombatActive && (
        <div className="flex flex-row">
          {battle && !results && actionId && (
            <div className="text-xs">
              <p className="text-red-500">Red: tile not affected</p>
              <p className="text-green-700">Green: tile affected by attack</p>
              <p className="text-blue-500">Blue: move character</p>
            </div>
          )}
          <div className="grow"></div>
          <div className="hidden text-right text-xs md:any-pointer-fine:block">
            {hotkeys.byAction.wait && (
              <p className="text-orange-700">
                Hotkey &quot;{hotkeys.byAction.wait.toUpperCase()}&quot;: End turn
              </p>
            )}
            <p className="text-orange-700">Right-click an action to set its hotkey</p>
          </div>
        </div>
      )}
      {hotkeyDialog}
    </div>
  );
}
