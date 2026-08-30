"use client";

import { useAtom, useSetAtom } from "jotai";
import { Bot, Hand } from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AutoBattleTypes } from "@/drizzle/constants";
import { type CombatLayoutComponentId, useCombatPreferences } from "@/hooks/combat";
import { useTutorialStep } from "@/hooks/tutorial";
import ActionTimer from "@/layout/ActionTimer";
import { ActionSelector } from "@/layout/CombatActions";
import CombatHistory from "@/layout/CombatHistory";
import CombatTimeline from "@/layout/CombatTimeline";
import Loader from "@/layout/Loader";
import { UserCombatSettings } from "@/layout/UserCombatSettings";
import { availableUserActions } from "@/libs/combat/actions";
import type { BattleState } from "@/libs/combat/types";
import { resolveControlledActorId } from "@/libs/combat/util";
import { showMutationToast } from "@/libs/toast";
import {
  combatActionIdAtom,
  useRequiredUserData,
  userBattleAtom,
} from "@/utils/UserContext";

const Combat = dynamic(() => import("@/layout/Combat"), { ssr: false });

export default function CombatPage() {
  // State
  const router = useRouter();
  const [actionId, setActionId] = useAtom(combatActionIdAtom);
  const config = useCombatPreferences();
  const [battleState, setBattleState] = useState<BattleState | undefined>(undefined);
  const [lastViewedVersion, setLastViewedVersion] = useState<number>(0);
  const [activeTab, setActiveTab] = useState<string>("actions");

  // Data from the DB
  const setBattleAtom = useSetAtom(userBattleAtom);
  const utils = api.useUtils();
  const { data: userData } = useRequiredUserData();
  const { data, isLoading } = api.combat.getBattle.useQuery(
    { battleId: userData?.battleId },
    { enabled: !!userData?.battleId },
  );

  // Mutation for handing turns to / taking them back from the user's AI profile
  const { mutate: toggleAutoCombat, isPending: isTogglingAutoCombat } =
    api.combat.toggleAutoCombat.useMutation({
      onSuccess: async (result) => {
        if (result.message) showMutationToast(result);
        await utils.combat.getBattle.invalidate();
      },
    });

  // Derived variables
  const userId = userData?.userId;
  const results = battleState?.result;
  const battle = battleState?.battle;
  const versionId = battle?.version;
  // The actor the human controls right now: themselves, or their piloted summon
  // on the summon's turn (control is sequential -> exactly one).
  const controlledActorId = resolveControlledActorId(battle, userId);
  const user = battle?.usersState.find((u) => u.userId === controlledActorId);
  // The session user's own battle entry (auto combat is a property of the
  // player, not of whichever actor is currently controlled)
  const sessionBattleUser = battle?.usersState.find((u) => u.userId === userId);
  const isAutoCombatActive = !!sessionBattleUser?.isAutoCombat;
  // Available in every battle except the kage/clan challenges, which are
  // always fully AI-driven and offer no manual control to hand over.
  const canToggleAutoCombat =
    !!battle &&
    !AutoBattleTypes.includes(battle.battleType) &&
    !!sessionBattleUser &&
    !sessionBattleUser.isAi &&
    sessionBattleUser.curHealth > 0 &&
    !sessionBattleUser.fledBattle &&
    !sessionBattleUser.leftBattle;
  const actionGridClass = config.useSmallActions
    ? "grid grid-cols-7 md:grid-cols-9 gap-1"
    : undefined;
  const actionAspect = config.useSmallActions ? "aspect-square" : undefined;
  const showActionLabels = !config.useSmallActions;
  const isInBattle = userData?.status === "BATTLE";

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
      const res = results && battle?.id === data.battle.id ? results : data?.result;
      setBattleAtom(data.battle);
      setBattleState({ battle: data?.battle, result: res, isPending: false });
      if (res) {
        if (currentStep?.onCombatWin && results?.outcome === "Won") {
          handleNextStep(currentStep.onCombatWin);
        } else if (currentStep?.onCombatLoss && results?.outcome !== "Won") {
          handleNextStep(currentStep.onCombatLoss);
        }
      }
    }
  }, [data]);

  // Collect all possible actions for the controlled actor (self, or piloted
  // summon on its turn) so the action panel shows the summon's jutsu/pools.
  const actions = useMemo(() => {
    return availableUserActions(battleState?.battle, controlledActorId);
  }, [versionId, controlledActorId]);

  // Battle scene. Pass the CONTROLLED actor (self, or the piloted summon on its
  // turn) so Combat does not have to re-derive it from the same battle object.
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
    versionId,
    actionId,
    controlledActorId,
    results,
    config.showGridNumbers,
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
    if (!battle || !user || !isInBattle || !battleState) return null;
    return (
      <div
        className="flex flex-row items-center gap-2"
        id="tutorial-combat-action-timer"
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
    actions,
    actionId,
    userId,
    controlledActorId,
    config,
    userData,
  ]);

  const renderBattlefield = useCallback(() => {
    return (
      <div className="relative overflow-hidden rounded-lg border bg-card text-card-foreground shadow-lg">
        {!isLoading && combat}
        {!userData && <Loader explanation="Loading User Data" />}
        {isLoading && <Loader explanation="Loading Battle Data" />}
        {userData && !results && !userData.battleId && (
          <p className="p-3">You are not in any battle</p>
        )}
      </div>
    );
  }, [isLoading, combat, userData, results]);

  const renderActions = useCallback(() => {
    if (!isInBattle || !battle) return null;
    if (isAutoCombatActive && !results) {
      return (
        <AutoCombatPanel
          isToggling={isTogglingAutoCombat}
          onTakeControl={() =>
            toggleAutoCombat({ battleId: battle.id, enabled: false })
          }
        />
      );
    }
    return (
      <>
        <ActionSelector
          showInfoIcon={true}
          items={actions}
          currentRound={battle.round}
          className="p-1"
          showBgColor={true}
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
        {canToggleAutoCombat && !isAutoCombatActive && !results && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-muted-foreground"
            disabled={isTogglingAutoCombat}
            onClick={() => toggleAutoCombat({ battleId: battle.id, enabled: true })}
          >
            <Bot className="mr-2 h-4 w-4" />
            Let my AI profile finish this battle
          </Button>
        )}
      </>
    );
  }, [
    isInBattle,
    battle,
    isAutoCombatActive,
    results,
    isTogglingAutoCombat,
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
        <div className="text-xs">
          <p className="text-orange-700">Hotkey &quot;W&quot;: End turn</p>
          <p className="text-orange-700">Hotkey &quot;M&quot;: Move</p>
        </div>
      </div>
    </div>
  );
}

interface AutoCombatPanelProps {
  isToggling: boolean;
  onTakeControl: () => void;
}

const AutoCombatPanel: React.FC<AutoCombatPanelProps> = (props) => {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border bg-popover/50 p-4 text-center">
      <p className="flex items-center gap-2 font-semibold">
        <Bot className="h-5 w-5 animate-pulse" />
        Auto combat active
      </p>
      <p className="text-muted-foreground text-sm">
        Your AI profile is fighting this battle for you. Sit back and watch, or take
        back control at any time.
      </p>
      <Button
        variant="secondary"
        disabled={props.isToggling}
        onClick={props.onTakeControl}
      >
        <Hand className="mr-2 h-4 w-4" />
        Take control
      </Button>
    </div>
  );
};
