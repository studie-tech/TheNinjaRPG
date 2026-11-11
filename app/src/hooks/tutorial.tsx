"use client";

import { atom, useAtomValue } from "jotai";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/app/_trpc/client";
import { TUTORIAL_ITEM_ID, TUTORIAL_JUTSU_ID } from "@/drizzle/constants";
import {
  actionPointsAfterAction,
  availableUserActions,
  calcActiveUser,
} from "@/libs/combat/actions";
import type { ReturnedBattle } from "@/libs/combat/types";
import { getDistanceToClosestEnemy } from "@/libs/combat/util";
import {
  getTutorialCombatGuidance,
  isTutorialActive,
  type TutorialCombatGuidance,
  type TutorialTrigger,
} from "@/libs/tutorial";
import { TUTORIAL_STEPS, type TutorialStepConfig } from "@/libs/tutorialSteps";
import { usePublicPathname } from "@/utils/routing";
import {
  combatActionIdAtom,
  userBattleAtom,
  useUserDataSelector,
} from "@/utils/UserContext";

/** Steps the hands-on combat lesson replaces with live guidance once the fight is on. */
const GUIDED_COMBAT_STEP_IDS = ["combat-fight", "mission-find-pup"];
const noBattleAtom = atom<ReturnedBattle | undefined>(undefined);
const noSelectedActionAtom = atom<string | undefined>(undefined);

/**
 * Hook to get the current tutorial step
 * @returns
 */
export const useTutorialStep = () => {
  // State
  const {
    data: userData,
    updateUser,
    timeDiff,
  } = useUserDataSelector((user) => ({
    userId: user.userId,
    tutorialOn: user.tutorialOn,
    tutorialStep: user.tutorialStep,
    status: user.status,
  }));
  const pathname = usePublicPathname();
  const router = useRouter();
  const [isAssistantVisible, setIsAssistantVisible] = useState<boolean>(false);

  // Derived
  const stepNumber = userData?.tutorialStep || 0;
  // A switched-off tutorial has no current step. Callers use `currentStep` to
  // pin UI (hide training sections, pin shop rows, force quest tabs), so a
  // player who stopped the tutorial mid-way must not keep that UI forever.
  const staticStep = isTutorialActive(userData)
    ? TUTORIAL_STEPS?.[stepNumber]
    : undefined;
  const userId = userData?.userId;
  const inBattle = userData?.status === "BATTLE";
  const isGuidedCombat =
    pathname === "/combat" &&
    !!staticStep &&
    GUIDED_COMBAT_STEP_IDS.includes(staticStep.id);

  // Only a guided combat lesson follows the battle; every other caller reads constant
  // atoms, so battle updates and action selection do not re-render it.
  const battle = useAtomValue(isGuidedCombat ? userBattleAtom : noBattleAtom);
  const selectedActionId = useAtomValue(
    isGuidedCombat ? combatActionIdAtom : noSelectedActionAtom,
  );

  // Live guidance for the hands-on combat lesson
  const combatGuidance = (() => {
    if (!battle || !userId || !isGuidedCombat) return undefined;
    const self = battle.usersState.find((u) => u.userId === userId);
    if (!self) return undefined;
    if (self.isAutoCombat) return { kind: "auto" } as const;
    // A snapshot without an acting combatant (between rounds) gives no
    // instruction rather than breaking the battle page.
    let actorId: string;
    try {
      actorId = calcActiveUser(battle, userId, timeDiff).actor.userId;
    } catch {
      return undefined;
    }
    const options = availableUserActions(battle, userId).map((action) => ({
      id: action.id,
      name: action.name,
      type: action.type,
      range: action.range,
      isUsable:
        actionPointsAfterAction(self, battle, action).canAct &&
        (!action.cooldown ||
          !action.lastUsedRound ||
          battle.round - action.lastUsedRound >= action.cooldown),
    }));
    return getTutorialCombatGuidance({
      isPlayersTurn: actorId === userId,
      distanceToEnemy: getDistanceToClosestEnemy(battle, userId),
      selectedActionId,
      options,
    });
  })();
  // Primitive fields, so the step below keeps its identity between renders
  // until the instruction itself changes.
  const guidanceKind = combatGuidance?.kind;
  const guidanceActionId =
    combatGuidance && "actionId" in combatGuidance
      ? combatGuidance.actionId
      : undefined;
  const guidanceActionName =
    combatGuidance && "actionName" in combatGuidance ? combatGuidance.actionName : "";
  const guidanceReason =
    combatGuidance && "reason" in combatGuidance ? combatGuidance.reason : "attack";

  // The step to show, with the combat lesson's live instruction in place of a
  // static one while the player is fighting a guided battle.
  const currentStep = useMemo(() => {
    if (!staticStep) return staticStep;
    if (pathname !== "/combat") return staticStep;
    const isBattleStep = !!staticStep.onCombatWin || !!staticStep.onCombatLoss;
    // After a guided fight the step has already moved on; point at the way back.
    if (!isBattleStep) {
      if (inBattle) return staticStep;
      return {
        ...staticStep,
        title: "Battle over",
        description: "That's the fight done. Let's carry on where we left off.",
        action: "Tap Continue tutorial.",
        elementIds: ["return"],
        page: "/combat",
        // One call to action on the result screen; the next step does the rest.
        advanceOn: undefined,
        relatedValue: undefined,
        showNextButton: false,
        proceedOnHighlightClick: false,
      };
    }
    if (!GUIDED_COMBAT_STEP_IDS.includes(staticStep.id) || !guidanceKind) {
      return staticStep;
    }
    const guidance: TutorialCombatGuidance | { kind: "auto" } =
      guidanceKind === "auto" || guidanceKind === "wait" || !guidanceActionId
        ? { kind: guidanceKind === "auto" ? "auto" : "wait" }
        : {
            kind: guidanceKind,
            actionId: guidanceActionId,
            actionName: guidanceActionName,
            reason: guidanceReason,
          };
    return getGuidedCombatStep(staticStep, guidance);
  }, [
    staticStep,
    pathname,
    inBattle,
    guidanceKind,
    guidanceActionId,
    guidanceActionName,
    guidanceReason,
  ]);

  // Saves the tutorial step: `mutate` for callers that fire and forget,
  // the async form for `saveStep`, which rolls the optimistic step back.
  const {
    mutate: updateTutorialStep,
    mutateAsync: saveTutorialStep,
    isPending,
  } = api.profile.updateTutorialStep.useMutation({
    onSuccess: async (data) => {
      if (data.success && data.userPatch?.tutorialStep !== undefined) {
        await updateUser({ tutorialStep: data.userPatch.tutorialStep });
        const nextStepPage = TUTORIAL_STEPS[data.userPatch.tutorialStep]?.page;
        const onBattlePage = pathname === "/combat";
        if (nextStepPage && !onBattlePage && !isSamePage(nextStepPage, pathname)) {
          router.push(nextStepPage);
        }
      }
    },
  });

  // Hide the assistant once the player is past the last step
  useEffect(() => {
    if (stepNumber >= TUTORIAL_STEPS.length) setIsAssistantVisible(false);
  }, [stepNumber]);

  /**
   * Move to `forceStep`, or to the step after the current one. Saving the same
   * index twice is skipped, so two triggers firing for one action cannot move
   * the player on by two. The step changes on screen at once and is put back
   * if the server does not take it, so a tap on Next never sits unanswered.
   */
  const saveStep = async (nextStep: number) => {
    if (nextStep >= TUTORIAL_STEPS.length) setIsAssistantVisible(false);
    if (isPending || nextStep === stepNumber) return;
    const previousStep = stepNumber;
    await updateUser({ tutorialStep: nextStep });
    try {
      await saveTutorialStep({ step: nextStep });
    } catch {
      await updateUser({ tutorialStep: previousStep });
    }
  };

  const handleNextStepAsync = async (forceStep?: string) => {
    const forcedIndex = TUTORIAL_STEPS.findIndex((step) => step.id === forceStep);
    return saveStep(forceStep && forcedIndex > -1 ? forcedIndex : stepNumber + 1);
  };

  const handleNextStep = (forceStep?: string) => {
    void handleNextStepAsync(forceStep);
  };

  /**
   * Report a game action. Only the step waiting for that action moves on, so
   * an action reported twice, or after the player already moved past the
   * step, changes nothing.
   */
  const completeTutorialAction = async (trigger: TutorialTrigger) => {
    if (!staticStep || staticStep.advanceOn !== trigger) return;
    await saveStep(stepNumber + 1);
  };

  // Return
  return {
    stepNumber,
    currentStep,
    updateTutorialStep,
    handleNextStep,
    handleNextStepAsync,
    completeTutorialAction,
    isAssistantVisible,
    setIsAssistantVisible,
  };
};

/** A step page counts as reached when its path and any requested tab match. */
const isSamePage = (stepPage: string, pathname: string) =>
  stepPage.split("?")[0]?.split("#")[0] === pathname &&
  !stepPage.includes("?") &&
  !stepPage.includes("#");

/** The combat lesson's live instruction, worded for what the player should do now. */
const getGuidedCombatStep = (
  step: TutorialStepConfig,
  guidance: TutorialCombatGuidance | { kind: "auto" },
): TutorialStepConfig => {
  const base = {
    ...step,
    page: "/combat",
    showNextButton: false,
    proceedOnHighlightClick: false,
  };
  if (guidance.kind === "auto") {
    return {
      ...base,
      title: "Auto combat",
      description:
        "Your AI profile is fighting this battle for you. Switch AI control off below the battlefield to take over and learn the controls.",
      elementIds: ["battle-ai-control", "tutorial-combat-field"],
    };
  }
  if (guidance.kind === "wait") {
    return {
      ...base,
      title: "Opponent's turn",
      description:
        "Your opponent is acting now. Watch the battlefield: your turn comes right after.",
      action: undefined,
      elementIds: ["tutorial-combat-action-timer"],
    };
  }
  const name = guidance.actionName;
  if (guidance.kind === "select") {
    if (guidance.reason === "move") {
      return {
        ...base,
        title: "Close the distance",
        description: "Your opponent is out of reach. Moving one tile costs 10 AP.",
        action: `Select ${name}.`,
        elementIds: [`tutorial-combat-action-${guidance.actionId}`],
      };
    }
    if (guidance.reason === "end") {
      return {
        ...base,
        title: "End your turn",
        description:
          "Nothing useful is left to do with the Action Points you have. Ending your turn refills them for the next round.",
        action: `Select ${name}.`,
        elementIds: [`tutorial-combat-action-${guidance.actionId}`],
      };
    }
    return {
      ...base,
      title: "Strike!",
      description:
        guidance.actionId === "basicAttack"
          ? "Your opponent is within reach of a basic attack: 20 AP and a little stamina."
          : guidance.actionId === TUTORIAL_JUTSU_ID
            ? "Your opponent is in range of Sonic Slash. Jutsu hit harder than basic attacks but need a few rounds to recharge."
            : guidance.actionId === TUTORIAL_ITEM_ID
              ? "Your opponent is in throwing range. Each shuriken is used up when thrown."
              : `Your opponent is in range of ${name}.`,
      action: `Select ${name}.`,
      elementIds: [`tutorial-combat-action-${guidance.actionId}`],
    };
  }
  return {
    ...base,
    title:
      guidance.reason === "move"
        ? "Pick a tile"
        : guidance.reason === "end"
          ? "End your turn"
          : "Pick your target",
    description:
      guidance.reason === "move"
        ? "Highlighted tiles are within reach. Step towards your opponent."
        : guidance.reason === "end"
          ? "End Turn targets yourself. Shortcut: press W."
          : "Tap your opponent on the battlefield to attack.",
    action:
      guidance.reason === "move"
        ? "Tap a highlighted tile next to you."
        : guidance.reason === "end"
          ? "Tap your own character."
          : "Tap your opponent.",
    elementIds: ["tutorial-combat-field"],
  };
};
