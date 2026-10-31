"use client";

import { useAtom, useSetAtom } from "jotai";
import { Bot } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AutoBattleTypes, ManualStartBattleTypes } from "@/drizzle/constants";
import { type CombatLayoutComponentId, useCombatPreferences } from "@/hooks/combat";
import { useNavigationRouter as useRouter } from "@/hooks/navigation";
import { useTutorialStep } from "@/hooks/tutorial";
import ActionTimer from "@/layout/ActionTimer";
import { AutoCombatControl } from "@/layout/AutoCombatControl";
import { ActionSelector } from "@/layout/CombatActions";
import CombatHistory from "@/layout/CombatHistory";
import CombatTimeline from "@/layout/CombatTimeline";
import ContentBox from "@/layout/ContentBox";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import { PyramidRun } from "@/layout/PyramidRunBoundary";
import { UserCombatSettings } from "@/layout/UserCombatSettings";
import { availableUserActions } from "@/libs/combat/actions";
import type { BattleState } from "@/libs/combat/types";
import {
  getBattlefieldHeightRatio,
  resolveControlledActorId,
} from "@/libs/combat/util";
import { isBetweenPyramidBattles } from "@/libs/questRun";
import { cn } from "@/libs/shadui";
import { showMutationToast } from "@/libs/toast";
import {
  combatActionIdAtom,
  useRequiredUserData,
  userBattleAtom,
} from "@/utils/UserContext";

const loadCombat = () => import("@/layout/Combat");
const Combat = dynamic(loadCombat, {
  ssr: false,
  loading: () => <Loader explanation="Loading Battlefield" />,
});

export default function CombatPage() {
  // State
  const router = useRouter();
  const [actionId, setActionId] = useAtom(combatActionIdAtom);
  const config = useCombatPreferences();
  const [battleState, setBattleState] = useState<BattleState | undefined>(undefined);
  const [lastViewedVersion, setLastViewedVersion] = useState<number>(0);
  const [activeTab, setActiveTab] = useState<string>("actions");
  const [autoCombatError, setAutoCombatError] = useState<string>();

  // Download and evaluate the scene while the battle query is in flight.
  useEffect(() => {
    void loadCombat().catch(() => undefined);
  }, []);

  // Data from the DB
  const setBattleAtom = useSetAtom(userBattleAtom);
  const utils = api.useUtils();
  const { data: userData, prepareUserUpdate, updateUser } = useRequiredUserData();
  const { data, isLoading, isSuccess, isError, isFetching, refetch } =
    api.combat.getBattle.useQuery(
      { battleId: userData?.battleId },
      { enabled: !!userData?.battleId },
    );

  // Mutation for handing turns to / taking them back from the user's AI profile
  const { mutate: toggleAutoCombat, isPending: isTogglingAutoCombat } =
    api.combat.toggleAutoCombat.useMutation({
      onMutate: () => {
        setAutoCombatError(undefined);
        return prepareUserUpdate();
      },
      onSuccess: async (result, _input, revision) => {
        setAutoCombatError(result.success ? undefined : result.message);
        if (result.message) showMutationToast(result);
        await Promise.all([
          utils.combat.getBattle.invalidate(),
          ...(result.success ? [updateUser(result.userPatch, { revision })] : []),
        ]);
      },
      onError: (error) => setAutoCombatError(error.message),
    });

  // Derived variables
  const userId = userData?.userId;
  const results = battleState?.result;
  const battle = battleState?.battle;
  const isBattleMissing = isSuccess && data.battle === null;
  const versionId = battle?.version;
  // The actor the human controls right now: themselves, or their piloted summon
  // on the summon's turn (control is sequential -> exactly one).
  const controlledActorId = resolveControlledActorId(battle, userId);
  const user = battle?.usersState.find((u) => u.userId === controlledActorId);
  // The session user's own battle entry (auto combat is a property of the
  // player, not of whichever actor is currently controlled)
  const sessionBattleUser = battle?.usersState.find((u) => u.userId === userId);
  const isAutoCombatActive = !!sessionBattleUser?.isAutoCombat;
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
  const actionGridClass = config.useSmallActions
    ? "grid grid-cols-7 md:grid-cols-9 gap-1"
    : "grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))]";
  const actionAspect = config.useSmallActions ? "aspect-square" : undefined;
  const showActionLabels = !config.useSmallActions;
  // Keep a finished battle's timer and actions dimmed and inert until the player leaves.
  const isInBattle = userData?.status === "BATTLE" || !!results;
  // After "Go Again" the finished battle is held in state until the next one's data is
  // applied; keep the scene back until then rather than remount the finished battle.
  const isBattleLoading =
    isLoading || (!!data?.battle && data.battle.id !== battle?.id);

  // Calculate number of unread actions
  const unreadActions = battle?.version
    ? Math.max(0, battle.version - lastViewedVersion)
    : 0;

  // Update last viewed version when switching to history tab
  useEffect(() => {
    if (activeTab === "history" && battle?.version) {
      setLastViewedVersion(battle.version);
    }
  }, [activeTab, battle?.version]);

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
      !isLoading &&
      !results
    ) {
      router.push("/hospital");
    }
  }, [userData?.status, userData?.battleId, isLoading, results, router]);

  // Redirect to profile if not in battle
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
    if (isBattleMissing) {
      if (userData?.battleId) void utils.profile.getUser.invalidate();
      if (battle?.id === userData?.battleId && battle?.extraState.dungeon && !results) {
        router.push("/dungeon");
      }
    }
  }, [
    isBattleMissing,
    userData?.battleId,
    battle?.id,
    battle?.extraState.dungeon,
    results,
    router,
    utils,
  ]);

  // Collect all possible actions for the controlled actor (self, or piloted
  // summon on its turn) so the action panel shows the summon's jutsu/pools.
  const actions = useMemo(() => {
    return availableUserActions(battleState?.battle, controlledActorId);
  }, [versionId, controlledActorId]);

  // Battle scene. Pass the CONTROLLED actor (self, or the piloted summon on its
  // turn) so Combat does not have to re-derive it from the same battle object.
  // Depend on battleState so isPending / result reach Combat; do not depend on
  // the whole config object — Combat reads grid, aggro and resource visibility.
  // The WebGL scene stays mounted while newly revealed action assets load.
  const combat = useMemo(() => {
    return (
      battleState &&
      controlledActorId && (
        <Combat
          battleState={battleState}
          action={actions.find((a) => a.id === actionId)}
          userId={controlledActorId}
          setBattleState={setBattleState}
          config={config}
        />
      )
    );
  }, [
    battleState,
    actionId,
    controlledActorId,
    config.showGridNumbers,
    config.showAggro,
    config.resourceBarsVisibility,
    actions,
  ]);

  // Handle key-presses
  useEffect(() => {
    const onDocumentKeyDown = (event: KeyboardEvent) => {
      switch (event.key) {
        case "m":
          if (actionId === "move") {
            setActionId(undefined);
          } else {
            setActionId("move");
          }
          break;
      }
    };
    document.addEventListener("keydown", onDocumentKeyDown);
    return () => {
      document.removeEventListener("keydown", onDocumentKeyDown);
    };
  }, [actionId]);

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

  // Component renderers
  const renderTimer = useCallback(() => {
    if (!battle || !user || !isInBattle || !battleState) {
      // Hold the timer's height while the battle loads, so nothing below it moves.
      return isInBattle ? <div className="h-16" /> : null;
    }
    return (
      <div
        className={cn("flex flex-row items-center gap-2", results && "opacity-50")}
        id="tutorial-combat-action-timer"
        inert={!!results}
      >
        <ActionTimer
          action={actions.find((a) => a.id === actionId)}
          user={{
            userId: controlledActorId,
            actionPoints: user?.actionPoints ?? 0,
          }}
          battle={battle}
          isPending={battleState.isPending}
          options={<UserCombatSettings config={config} userData={userData} />}
        />
      </div>
    );
  }, [
    battle,
    user,
    isInBattle,
    battleState,
    results,
    actions,
    actionId,
    userId,
    controlledActorId,
    config,
    userData,
  ]);

  const renderBattlefield = useCallback(() => {
    // Reserve the canvas while loading. Settled results use their content height so
    // rewards and follow-up actions never need a second scrollbar on small screens.
    return (
      <div
        className="relative box-content overflow-hidden rounded-lg border bg-card text-card-foreground shadow-lg"
        style={
          battle && !results
            ? {
                aspectRatio: `1 / ${getBattlefieldHeightRatio(battle.width, battle.height)}`,
              }
            : undefined
        }
      >
        {!isBattleLoading && combat}
        {!userData && <Loader explanation="Loading User Data" />}
        {isBattleLoading && <Loader explanation="Loading Battle Data" />}
        {userData && !results && !userData.battleId && (
          <p className="p-3">You are not in any battle</p>
        )}
      </div>
    );
  }, [isBattleLoading, combat, userData, results, battle]);

  const renderActions = useCallback(() => {
    if (!isInBattle || !battle) return null;
    return (
      <div
        className={cn("flex flex-col gap-1", results && "opacity-50")}
        inert={!!results}
      >
        {isAutoCombatActive ? (
          <AutoCombatPanel
            aiOnly={
              battle.extraState.tournamentAiOnly || battle.extraState.kageMatch?.ai
            }
          />
        ) : (
          <ActionSelector
            showInfoIcon={true}
            items={actions}
            currentRound={battle.round}
            className="p-1"
            showBgColor={true}
            eagerImages={true}
            showLabels={showActionLabels}
            selectedId={actionId}
            combatMode={true}
            userActionPoints={user?.actionPoints}
            battle={battle}
            userId={controlledActorId}
            gridClassNameOverwrite={actionGridClass}
            aspectRatioClass={actionAspect}
            onClick={handleActionClick}
          />
        )}
        {canToggleAutoCombat && !results && (
          <AutoCombatControl
            key={battle.id}
            isActive={isAutoCombatActive}
            isPending={isTogglingAutoCombat}
            requiresConfirmation={ManualStartBattleTypes.includes(battle.battleType)}
            error={autoCombatError}
            onChange={(enabled) => toggleAutoCombat({ battleId: battle.id, enabled })}
          />
        )}
      </div>
    );
  }, [
    userId,
    isInBattle,
    battle,
    isAutoCombatActive,
    results,
    isTogglingAutoCombat,
    autoCombatError,
    toggleAutoCombat,
    canToggleAutoCombat,
    actions,
    showActionLabels,
    actionId,
    user?.actionPoints,
    controlledActorId,
    actionGridClass,
    actionAspect,
    handleActionClick,
  ]);

  const renderTimeline = useCallback(() => {
    if (!config.showTimeline || !battle) return null;
    return (
      <CombatTimeline
        battleId={battle.id}
        battle={battle}
        battleVersion={battle.version}
        showBasicActions={config.showBasicActions}
      />
    );
  }, [config.showTimeline, config.showBasicActions, battle]);

  const renderBattleLog = useCallback(() => {
    if (!config.showBattleLog || !battle) return null;
    return (
      <CombatHistory
        battleId={battle.id}
        battleVersion={battle.version}
        battleRound={battle.round}
        results={results}
      />
    );
  }, [config.showBattleLog, battle, results]);

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
    if (!battle) return null;

    return (
      <Tabs
        defaultValue="actions"
        className="w-full"
        value={activeTab}
        onValueChange={setActiveTab}
      >
        <TabsList className="w-full rounded-lg border">
          <TabsTrigger value="actions" className="flex-1">
            Actions
          </TabsTrigger>
          {config.showTimeline && (
            <TabsTrigger value="timeline" className="flex-1">
              Timeline
            </TabsTrigger>
          )}
          {config.showBattleLog && (
            <TabsTrigger value="history" className="relative flex-1">
              History
              {unreadActions > 0 && activeTab !== "history" && (
                <span className="absolute -top-1 -right-1 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-red-500 text-white text-xs">
                  {unreadActions}
                </span>
              )}
            </TabsTrigger>
          )}
        </TabsList>
        <TabsContent value="actions" className="mt-0 p-1">
          {renderActions()}
        </TabsContent>
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
    activeTab,
    unreadActions,
    renderActions,
    renderTimeline,
    renderBattleLog,
  ]);

  if (!userData) return <Loader explanation="Loading userdata" />;
  if (isBetweenPyramidBattles(userData) && !results) return <PyramidRun />;
  if (!results && (!userData.battleId || isBattleMissing)) {
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

  // Determine which components are tabbed vs standalone
  const tabbedIds: CombatLayoutComponentId[] = ["actions", "timeline", "battlelog"];

  return (
    <div className="flex flex-col gap-1 sm:container">
      {config.useTabs ? (
        // Tabs mode: render non-tabbed components in order, then tabs
        <>
          {config.layoutOrder
            .filter((id) => !tabbedIds.includes(id))
            .map((id) => (
              <div key={id}>{renderComponent(id)}</div>
            ))}
          {battle && renderTabbedContent()}
        </>
      ) : (
        // Non-tabs mode: render all components in order
        config.layoutOrder.map((id) => <div key={id}>{renderComponent(id)}</div>)
      )}

      <div className="flex flex-row">
        {battle && !results && actionId && (
          <div className="text-xs">
            <p className="text-red-500">Red: tile not affected</p>
            <p className="text-green-700">Green: tile affected by attack</p>
            <p className="text-blue-500">Blue: move character</p>
          </div>
        )}
        <div className="grow"></div>
        <div className="hidden text-xs md:block">
          <p className="text-orange-700">Hotkey &quot;W&quot;: End turn</p>
          <p className="text-orange-700">Hotkey &quot;M&quot;: Move</p>
        </div>
      </div>
    </div>
  );
}

interface AutoCombatPanelProps {
  aiOnly?: boolean;
}

const AutoCombatPanel: React.FC<AutoCombatPanelProps> = (props) => {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border bg-popover/50 p-4 text-center">
      <p className="flex items-center gap-2 font-semibold">
        <Bot className="h-5 w-5 animate-pulse" />
        Auto combat active
      </p>
      <p className="text-muted-foreground text-sm">
        {props.aiOnly
          ? "Both sides use AI control for this match. You can edit your rules before your next match."
          : "Your AI profile is fighting this battle for you. Turn AI control off below to take control."}
      </p>
    </div>
  );
};
