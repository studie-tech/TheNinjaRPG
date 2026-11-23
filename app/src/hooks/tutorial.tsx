"use client";

import { atom, useAtomValue } from "jotai";
import { useMemo, useSyncExternalStore } from "react";
import { api } from "@/app/_trpc/client";
import { TUTORIAL_ITEM_ID, TUTORIAL_JUTSU_ID } from "@/drizzle/constants";
import {
  actionPointsAfterAction,
  availableUserActions,
  calcActiveUser,
  getActionSelectionId,
} from "@/libs/combat/actions";
import type { ReturnedBattle } from "@/libs/combat/types";
import { getDistanceToClosestEnemy } from "@/libs/combat/util";
import {
  getTutorialCombatCoaching,
  getTutorialCombatGuidance,
  getTutorialStepPath,
  isTutorialActive,
  TUTORIAL_ANY_PAGE,
  type TutorialCombatCoaching,
  type TutorialCombatGuidance,
  type TutorialTrigger,
} from "@/libs/tutorial";
import { TUTORIAL_STEPS, type TutorialStepConfig } from "@/libs/tutorialSteps";
import { getTutorialWay, type TutorialWay } from "@/libs/tutorialWay";
import { usePublicPathname } from "@/utils/routing";
import {
  combatActionIdAtom,
  userBattleAtom,
  useUserDataSelector,
} from "@/utils/UserContext";

/** Steps the hands-on combat lesson replaces with live guidance once the fight is on. */
const GUIDED_COMBAT_STEP_IDS = ["combat-fight", "arena-fight", "mission-find-pup"];
/** Guided fights that coach from the first turn: the player has been shown a turn before. */
const COACHED_COMBAT_STEP_IDS = ["mission-find-pup"];
/** Title of a lost lesson's rematch, whose advice stays on screen beside the fight. */
export const TUTORIAL_REMATCH_TITLE = "Rematch";
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
    battleId: user.battleId,
    sector: user.sector,
    villageName: user.village?.name,
    villageSector: user.village?.sector,
    hasUnassignedExperience: (user.earnedExperience ?? 0) > 0,
  }));
  const pathname = usePublicPathname();

  // Derived
  const savedStepNumber = userData?.tutorialStep || 0;
  // A step that ends where its control leads is behind the player as soon as they are
  // there, whichever way they came; saving that follows.
  const hasArrived =
    isTutorialActive(userData) &&
    !!TUTORIAL_STEPS[savedStepNumber]?.arrivesAt &&
    TUTORIAL_STEPS[savedStepNumber]?.arrivesAt === pathname;
  const stepNumber = hasArrived ? savedStepNumber + 1 : savedStepNumber;
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
  // A step past a fight, shown on /combat while the profile still says BATTLE: the fight
  // that moved the tutorial on has ended, or the player is in another one.
  const isAfterFight =
    pathname === "/combat" &&
    inBattle &&
    !!staticStep &&
    !staticStep.onCombatWin &&
    !staticStep.onCombatLoss;
  // Touch screens have no keyboard shortcuts to teach.
  const isTouch = useSyncExternalStore(
    subscribeToPointer,
    isCoarsePointer,
    () => false,
  );

  // Only a guided combat lesson, or one just past a fight, follows the battle; every
  // other caller reads constant atoms, so battle updates and action selection do not
  // re-render it.
  const battle = useAtomValue(
    isGuidedCombat || isAfterFight ? userBattleAtom : noBattleAtom,
  );
  // The battle on the page is over for the player: its result is in, though the profile
  // may still say BATTLE.
  const hasLeftBattle =
    isAfterFight &&
    !!battle &&
    (!userData?.battleId || battle.id === userData.battleId) &&
    !!battle.usersState.find((u) => u.userId === userId)?.leftBattle;
  const selectedActionId = useAtomValue(
    isGuidedCombat ? combatActionIdAtom : noSelectedActionAtom,
  );

  // Whose turn it is in the guided battle; a snapshot without an acting combatant
  // (between rounds) has no answer rather than breaking the battle page.
  const isPlayersTurn = (() => {
    if (!battle || !userId || !isGuidedCombat) return undefined;
    try {
      return calcActiveUser(battle, userId, timeDiff).actor.userId === userId;
    } catch {
      return undefined;
    }
  })();

  // Live guidance for the hands-on combat lesson
  const combatGuidance = (() => {
    if (!battle || !userId || !isGuidedCombat) return undefined;
    const self = battle.usersState.find((u) => u.userId === userId);
    if (!self) return undefined;
    if (self.isAutoCombat) return { kind: "auto" } as const;
    if (isPlayersTurn === undefined) return undefined;
    const actions = availableUserActions(battle, userId);
    const options = actions.map((action) => ({
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
    const distanceToEnemy = getDistanceToClosestEnemy(battle, userId);
    const selectedId = actions.find(
      (action) => getActionSelectionId(action) === selectedActionId,
    )?.id;
    // Everyone acts once a round, so from round 2 the player has played a turn under
    // instruction; from then on, and in a fight that instructs no turn, they choose and are
    // only coached.
    if (battle.round > 1 || COACHED_COMBAT_STEP_IDS.includes(staticStep.id)) {
      const coaching = getTutorialCombatCoaching({
        isPlayersTurn,
        distanceToEnemy,
        actionPoints: Math.floor(self.actionPoints),
        selectedActionId: selectedId,
        options,
      });
      if (coaching.kind === "coach") return coaching;
    }
    return {
      ...getTutorialCombatGuidance({
        isPlayersTurn,
        distanceToEnemy,
        selectedActionId: selectedId,
        options,
      }),
      distanceToEnemy,
    };
  })();
  // Primitive fields, so the step below keeps its identity between renders
  // until the instruction itself changes.
  const guidanceKind =
    combatGuidance?.kind === "coach" ? undefined : combatGuidance?.kind;
  const guidanceActionId =
    combatGuidance && "actionId" in combatGuidance
      ? combatGuidance.actionId
      : undefined;
  const guidanceActionName =
    combatGuidance && combatGuidance.kind !== "coach" && "actionName" in combatGuidance
      ? combatGuidance.actionName
      : "";
  const guidanceReason =
    combatGuidance && "reason" in combatGuidance ? combatGuidance.reason : "attack";
  const guidanceDistance =
    combatGuidance && "distanceToEnemy" in combatGuidance
      ? combatGuidance.distanceToEnemy
      : null;
  // The coaching as one value, so the step below changes only when its words do.
  const coachingKey =
    combatGuidance?.kind === "coach" ? JSON.stringify(combatGuidance) : undefined;

  // On another page than the step's own, the lesson shows the way there. A fight keeps the
  // player until it ends, and the hospital has a lesson of its own.
  const isOnTheWay =
    !!staticStep &&
    staticStep.page !== TUTORIAL_ANY_PAGE &&
    getTutorialStepPath(staticStep.page) !== "/combat" &&
    pathname !== "/combat" &&
    userData?.status !== "BATTLE" &&
    userData?.status !== "HOSPITALIZED";
  const wayPage = isOnTheWay ? staticStep.page : undefined;
  const arrivesAt = staticStep?.arrivesAt;
  const sector = userData?.sector;
  const villageName = userData?.villageName;
  const villageSector = userData?.villageSector;
  const hasUnassignedExperience = !!userData?.hasUnassignedExperience;
  const way = useMemo(
    () =>
      wayPage
        ? getTutorialWay({
            page: wayPage,
            arrivesAt,
            pathname,
            sector,
            village:
              villageName && villageSector !== undefined
                ? { name: villageName, sector: villageSector }
                : undefined,
            hasUnassignedExperience,
          })
        : undefined,
    [
      wayPage,
      arrivesAt,
      pathname,
      sector,
      villageName,
      villageSector,
      hasUnassignedExperience,
    ],
  );

  // The step to show, with the combat lesson's live instruction in place of a
  // static one while the player is fighting a guided battle.
  const currentStep = useMemo(() => {
    if (!staticStep) return staticStep;
    if (pathname !== "/combat") return way ? getWayStep(staticStep, way) : staticStep;
    const isBattleStep = !!staticStep.onCombatWin || !!staticStep.onCombatLoss;
    // After a guided fight the step has already moved on; point at the way back.
    const battleOver = {
      ...staticStep,
      title: "Battle over",
      description: "That's the fight done. Let's carry on where we left off.",
      action: "Tap the highlighted button.",
      elementIds: ["return"],
      isPageLit: false,
      revealId: undefined,
      page: "/combat",
      // One call to action on the result screen; the next step does the rest.
      advanceOn: undefined,
      relatedValue: undefined,
      showNextButton: false,
    };
    if (!isBattleStep) return inBattle && !hasLeftBattle ? staticStep : battleOver;
    if (!GUIDED_COMBAT_STEP_IDS.includes(staticStep.id)) {
      // A rematch started from another page keeps its lesson's advice on screen.
      if (inBattle && getTutorialStepPath(staticStep.page) !== "/combat") {
        return {
          ...staticStep,
          title: TUTORIAL_REMATCH_TITLE,
          action: "Win the fight.",
          elementIds: [],
          page: "/combat",
          advanceOn: undefined,
          showNextButton: false,
        };
      }
      // A rematch that was lost again stays on its lesson, whose page is elsewhere.
      return getTutorialStepPath(staticStep.page) === "/combat"
        ? staticStep
        : battleOver;
    }
    if (coachingKey) {
      return getCoachedCombatStep(
        staticStep,
        JSON.parse(coachingKey) as Extract<TutorialCombatCoaching, { kind: "coach" }>,
        isTouch,
      );
    }
    // Until the battle shows whose turn it is (loading, or between rounds), a fight
    // begun from another page keeps its lesson here rather than pointing back there.
    if (!guidanceKind) {
      return staticStep.page === "/combat" || !inBattle
        ? staticStep
        : {
            ...staticStep,
            page: "/combat",
            action: undefined,
            elementIds: [],
            showNextButton: false,
          };
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
    return getGuidedCombatStep(staticStep, guidance, guidanceDistance, isTouch);
  }, [
    staticStep,
    way,
    pathname,
    inBattle,
    hasLeftBattle,
    isTouch,
    guidanceKind,
    guidanceActionId,
    guidanceActionName,
    guidanceReason,
    guidanceDistance,
    coachingKey,
  ]);

  // Saves the tutorial step: `mutate` for callers that fire and forget, the async
  // form for `saveStep`. The step changes at once; one the server does not take is put
  // back. The page stays: the lesson shows the way to its own.
  const {
    mutate: updateTutorialStep,
    mutateAsync: saveTutorialStep,
    isPending,
  } = api.profile.updateTutorialStep.useMutation({
    onMutate: async ({ step }) => {
      const previousStep = savedStepNumber;
      await updateUser({ tutorialStep: step });
      return { previousStep };
    },
    onSuccess: async (data) => {
      const savedStep = data.success ? data.userPatch?.tutorialStep : undefined;
      if (savedStep !== undefined) {
        await updateUser({ tutorialStep: savedStep });
      }
    },
    // Settled rather than onError, which would replace the shared transport-failure feedback.
    onSettled: async (data, error, _variables, context) => {
      if (
        context &&
        (error || !data?.success || data.userPatch?.tutorialStep === undefined)
      ) {
        await updateUser({ tutorialStep: context.previousStep });
      }
    },
  });

  /**
   * Move to `forceStep`, or to the step after the current one. Saving the same
   * index twice is skipped, so two triggers firing for one action cannot move
   * the player on by two. The step changes on screen at once and is put back
   * if the server does not take it, so a tap on Next never sits unanswered.
   */
  const saveStep = async (nextStep: number) => {
    if (isPending || nextStep === savedStepNumber) return;
    // A failed save is already rolled back by the mutation.
    await saveTutorialStep({ step: nextStep }).catch(() => undefined);
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
    // A step with closing words shows them once game data proves the action, and moves
    // on from its own button.
    if (staticStep.afterAction) return;
    await saveStep(stepNumber + 1);
  };

  // Return
  return {
    stepNumber,
    /** The step to save on arriving where the last one led, if it is not saved yet. */
    arrivedStep: hasArrived ? stepNumber : undefined,
    /** The step itself, without the words a fight or the way to it puts in its place. */
    lessonStep: staticStep,
    currentStep,
    updateTutorialStep,
    handleNextStep,
    handleNextStepAsync,
    completeTutorialAction,
  };
};

/** A step as it shows on the way to its page: where to go next, and nothing to do yet. */
const getWayStep = (
  step: TutorialStepConfig,
  way: TutorialWay,
): TutorialStepConfig => ({
  id: step.id,
  chapter: step.chapter,
  title: step.title,
  description: step.wayLead ?? way.lead,
  action: way.action,
  elementIds: way.elementIds,
  page: TUTORIAL_ANY_PAGE,
  wayHref: way.href,
  autoTravelLabel: "Take me there",
  requiresGameMenu: way.isInGameMenu,
  gameMenuLead: typeof step.wayLead === "string" ? step.wayLead : way.lead,
});

/** A primary pointer as coarse as a finger: a touch screen. */
const COARSE_POINTER_QUERY = "(pointer: coarse)";

const coarsePointerQuery = () =>
  typeof window.matchMedia === "function"
    ? window.matchMedia(COARSE_POINTER_QUERY)
    : null;

const isCoarsePointer = () => coarsePointerQuery()?.matches ?? false;

const subscribeToPointer = (onChange: () => void) => {
  const query = coarsePointerQuery();
  query?.addEventListener("change", onChange);
  return () => query?.removeEventListener("change", onChange);
};

/** The combat lesson's live instruction, worded for what the player should do now. */
const getGuidedCombatStep = (
  step: TutorialStepConfig,
  guidance: TutorialCombatGuidance | { kind: "auto" },
  distanceToEnemy: number | null,
  isTouch: boolean,
): TutorialStepConfig => {
  // A move ends next to the opponent once only one tile separates them.
  const isOneTileAway = distanceToEnemy === 2;
  const base = {
    ...step,
    page: "/combat",
    showNextButton: false,
  };
  if (guidance.kind === "auto") {
    return {
      ...base,
      title: "Auto combat",
      description:
        "Your AI profile is fighting this battle for you. Tap Auto combat on the battlefield to take over and learn the controls.",
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
        title: isOneTileAway ? "One more tile" : "Close the distance",
        description: isOneTileAway
          ? "One step and your opponent is in reach. Moving one tile costs 10 AP."
          : "Your opponent is out of reach. Moving one tile costs 10 AP.",
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
      title: "In reach: attack!",
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
        ? isOneTileAway
          ? "One more tile"
          : "Pick a tile"
        : guidance.reason === "end"
          ? "End your turn"
          : "Pick your target",
    description:
      guidance.reason === "move"
        ? "Highlighted tiles are within reach. Step onto a tile next to your opponent."
        : guidance.reason === "end"
          ? isTouch
            ? "End Turn targets yourself."
            : "End Turn targets yourself. Shortcut: press W."
          : "Tap your opponent on the battlefield to attack.",
    action:
      guidance.reason === "move"
        ? "Tap a highlighted tile next to your opponent."
        : guidance.reason === "end"
          ? "Tap your own character."
          : "Tap your opponent.",
    elementIds: ["tutorial-combat-field"],
  };
};

/**
 * The combat lesson once the player has played a turn under instruction: Lemu describes
 * the situation and explains a choice that cannot work, and the player picks every action.
 * Phones show only the title and action during a fight, so each action line carries the
 * facts the player needs on its own.
 */
const getCoachedCombatStep = (
  step: TutorialStepConfig,
  coaching: Extract<TutorialCombatCoaching, { kind: "coach" }>,
  isTouch: boolean,
): TutorialStepConfig => {
  const { distanceToEnemy: distance, actionPoints, inReach } = coaching;
  const name = coaching.actionName ?? "";
  const base = {
    ...step,
    page: "/combat",
    showNextButton: false,
    // Nothing is spotlit: the whole battlefield and action bar are the player's to read.
    elementIds: [],
  };
  const away = `${distance} ${distance === 1 ? "tile" : "tiles"}`;
  switch (coaching.situation) {
    case "outOfReach":
      return {
        ...base,
        title: "Out of reach",
        description: `${name} reaches ${coaching.actionRange} ${coaching.actionRange === 1 ? "tile" : "tiles"}, but your opponent is ${away} away. Move closer first, or pick something with more range.`,
        action: `${name} reaches ${coaching.actionRange}; your opponent is ${away} away.`,
      };
    case "unavailable":
      return {
        ...base,
        title: "Not available",
        description: `${name} needs more Action Points than you have left (${actionPoints} AP), or it is still recharging from its last use. Its button tells you which.`,
        action: "Too few AP, or still recharging: pick another action.",
      };
    case "move":
      return {
        ...base,
        title: "Pick a tile",
        description: `Highlighted tiles are within reach, and each tile costs 10 AP. You have ${actionPoints} AP left.`,
        action: `Tap a highlighted tile: 10 AP each, ${actionPoints} AP left.`,
      };
    case "end":
      return {
        ...base,
        title: "End your turn",
        description:
          "Ending your turn hands it to your opponent and refills your Action Points for the next round.",
        action: isTouch
          ? "Tap yourself to end the turn."
          : "Tap yourself to end the turn, or press W.",
      };
    case "endEarly":
      return {
        ...base,
        title: "Your call",
        description:
          inReach.length > 0
            ? `End Turn is selected, but you still have ${actionPoints} AP, and your opponent is ${away} away. In reach right now: ${inReach.join(", ")}.`
            : `End Turn is selected, but you still have ${actionPoints} AP. Your opponent is ${away} away, so you could still close the distance.`,
        action: `${actionPoints} AP left: choose an action, or tap yourself to end early.`,
      };
    case "target":
      return {
        ...base,
        title: "Pick your target",
        description: `${name} reaches your opponent from here.`,
        action: "Tap your opponent.",
      };
    case "spent":
      return {
        ...base,
        title: "Turn spent",
        description: `With ${actionPoints} AP left there is nothing more you can do this turn.`,
        action: isTouch
          ? `${actionPoints} AP left: end your turn with End Turn.`
          : `${actionPoints} AP left: end your turn with End Turn, or press W.`,
      };
    default:
      return {
        ...base,
        title: "Your call",
        description:
          inReach.length > 0
            ? `You have ${actionPoints} AP, and your opponent is ${away} away. In reach right now: ${inReach.join(", ")}. Watch your chakra and stamina too: jutsu spend chakra, basic attacks stamina.`
            : `You have ${actionPoints} AP, and your opponent is ${away} away, out of reach of everything you have. Close the distance first.`,
        action:
          inReach.length > 0
            ? `${actionPoints} AP · in reach: ${inReach.join(", ")}`
            : `${actionPoints} AP · nothing reaches yet: move closer`,
      };
  }
};
