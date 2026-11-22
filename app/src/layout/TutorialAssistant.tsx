"use client";

import { useAtomValue, useSetAtom } from "jotai";
import {
  ArrowRight,
  Gift,
  Loader2,
  MapPin,
  RotateCcw,
  Settings2,
  Sparkles,
} from "lucide-react";
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "@/app/_trpc/client";
import { SIDEBAR_COLUMNS_SHOWN_QUERY } from "@/components/layout/shared/layoutUtils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { SortableItem } from "@/components/ui/sortable-list";
import { SortableList } from "@/components/ui/sortable-list";
import type { QuestType } from "@/drizzle/constants";
import {
  IMG_URL_ASSISTANT,
  IMG_URL_HANDPOINTER,
  OrderedQuestTypesInTutorial,
  TUTORIAL_STEPS_COUNT,
} from "@/drizzle/constants";
import type { UserQuest } from "@/drizzle/schema";
import { useLocalStorage } from "@/hooks/localstorage";
import { useNavigationRouter as useRouter } from "@/hooks/navigation";
import { useRetryQuestBattle } from "@/hooks/quest";
import {
  TUTORIAL_REMATCH_TITLE,
  tutorialPageGuidanceAtom,
  useTutorialStep,
} from "@/hooks/tutorial";
import { useStoryGuidance } from "@/hooks/useStoryGuidance";
import { ActivityDock } from "@/layout/ActivityDock";
import { SETTINGS_HREF } from "@/layout/GameSettings";
import Image from "@/layout/Image";
import Link from "@/layout/Link";
import { QuestObjectives, useCheckRewards } from "@/layout/Logbook";
import { StorySpotlight, useStoryDockCard } from "@/layout/StoryDock";
import { ExpressTrialsScreen, TutorialScreen } from "@/layout/TutorialScreens";
import { CoachCard } from "@/layout/tutorial/CoachCard";
import {
  type GuidedLessonMark,
  type GuidedLessonStep,
  guidedLessonAtom,
} from "@/layout/tutorial/guidedLesson";
import {
  getUsableHighlightElement,
  isSameBox,
  Spotlight,
  type SpotlightMark,
  SpotlightMarks,
  trackLayout,
} from "@/layout/tutorial/Spotlight";
import { VillageChooser } from "@/layout/VillageChooser";
import { isBrowserAuthPath } from "@/libs/native/deepLink";
import {
  canRetryQuestBattle,
  dialogChoiceContentId,
  getActiveObjective,
  isQuestComplete,
} from "@/libs/objectives";
import { levelUpBlockMessage } from "@/libs/profile";
import { sceneCharactersAtom } from "@/libs/questScene";
import { questsTabLessonAtom } from "@/libs/questsTabLesson";
import { cn } from "@/libs/shadui";
import { getChapterForQuest, getNavigationLevel } from "@/libs/storyGuidance";
import {
  canPositionTutorialHighlight,
  getTutorialCatchUpStepIndex,
  getTutorialChapterProgress,
  getTutorialRewindStepIndex,
  getTutorialStrandedBattleStepId,
  hasOutgrownTutorial,
  isTutorialActive,
  isTutorialJutsuPickStep,
  isTutorialPageMatch,
  isUsableHighlightRect,
  TUTORIAL_VILLAGE_CHOICE_STEP_ID,
  toObjectiveIds,
} from "@/libs/tutorial";
import type { TutorialStepConfig } from "@/libs/tutorialSteps";
import {
  TUTORIAL_CHAPTERS,
  TUTORIAL_HOSPITALIZED_STEP,
  TUTORIAL_STEPS,
} from "@/libs/tutorialSteps";
import type { UserWithRelations } from "@/routers/profile";
import { parseHtml } from "@/utils/parse";
import { usePublicPathname } from "@/utils/routing";
import { capitalizeFirstLetter } from "@/utils/string";
import { useUserDataSelector } from "@/utils/UserContext";
import type { QuestTrackerType } from "@/validators/objectives";

/** Marks the assistant panel so the highlight logic can measure what it covers. */
const TUTORIAL_ASSISTANT_PANEL_ID = "tutorial-assistant-panel";

/** Where the Activity dock lands when it dodges a highlight (its `top-20`), in rem. */
const DODGED_PANEL_TOP_REM = 5;

/** Width the Activity dock narrows to in a fight (`--activity-dock-width`), set on the root. */
const ACTIVITY_DOCK_WIDTH_PROPERTY = "--activity-dock-width";
/** The Activity dock's own width, which a fight narrows but never widens. */
const ACTIVITY_DOCK_FULL_WIDTH_PX = 420;
/** Narrowest dock that still fits its tabs; below it the dock keeps its width instead. */
const ACTIVITY_DOCK_MIN_WIDTH_PX = 176;
/** Space kept between the battlefield's highlight ring and the narrowed dock. */
const ACTIVITY_DOCK_FIELD_GAP_PX = 16;

/** Seconds a step without a Next button stays up before a "skip" escape appears. */
const STUCK_STEP_SECONDS = 60;
/** Idle seconds before a lesson that teaches a game control offers its own button. */
const SHORTCUT_IDLE_SECONDS = 10;

/**
 * Grace before a combat lesson without a running fight is moved on, so the
 * navigation to a battle that just started can land on /combat first.
 */
const STRANDED_BATTLE_STEP_MS = 1500;

/** Delay before a tutorial redirect is sent a second time. */
const REDIRECT_RETRY_MS = 1500;

/**
 * Tutorial assistant component
 * @param rightSideBarOpen - Whether the right side bar is open
 * @param setRightSideBarOpen - Function to set the right side bar open
 * @param rightSideBarRef - Reference to the right side bar
 * @returns
 */
const TutorialAssistant: React.FC<TutorialAssistantProps> = (props) => {
  const pathname = usePublicPathname();
  const { data: userData } = useUserDataSelector((user) => ({
    userId: user.userId,
    tutorialStep: user.tutorialStep,
  }));
  const tutorialIdentityRef = React.useRef({
    userId: userData?.userId,
    tutorialStep: userData?.tutorialStep,
  });
  React.useLayoutEffect(() => {
    tutorialIdentityRef.current = {
      userId: userData?.userId,
      tutorialStep: userData?.tutorialStep,
    };
  }, [userData?.userId, userData?.tutorialStep]);
  // A guided lesson on screen (an Academy table) takes the tutorial tab while it is
  // registered, whether or not the main tutorial is on: the player is doing that lesson
  // now. The main tutorial's saved step is untouched and its assistant returns, leading
  // the player back to its page as on any reopening, once the lesson clears.
  const guidedLesson = useAtomValue(guidedLessonAtom);
  // Account-scoped presentation resets when the player changes; progress stays in the profile.
  if (!userData || isBrowserAuthPath(pathname)) return null;
  return (
    <ActivityDock
      key={userData.userId}
      hiddenLesson={<TutorialCompletionSync />}
      guidedLesson={
        guidedLesson
          ? { id: guidedLesson.id, awaitsAnswer: guidedLesson.step.blocking === true }
          : undefined
      }
    >
      {guidedLesson ? (
        <GuidedLessonAssistant step={guidedLesson.step} />
      ) : (
        <PlayerTutorialAssistant {...props} tutorialIdentityRef={tutorialIdentityRef} />
      )}
    </ActivityDock>
  );
};

export default TutorialAssistant;

/**
 * A guided lesson for a visitor without a character, who has no tutorial assistant: the
 * same Activity dock, Lemu, coach card and spotlight, holding the lesson alone. Pages
 * that teach guests (the Card Hall's guest Academy) mount it; it stands down whenever a
 * character's assistant is on screen. The dock is portalled to the body, as the page's
 * layout columns open their own stacking contexts and would leave it under the blocking
 * layer of a step that waits for an answer.
 */
export const GuestGuidedLesson: React.FC = () => {
  const { data: userData } = useUserDataSelector(selectUserId);
  const guidedLesson = useAtomValue(guidedLessonAtom);
  if (userData || !guidedLesson) return null;
  return createPortal(
    <ActivityDock
      guidedLesson={{
        id: guidedLesson.id,
        awaitsAnswer: guidedLesson.step.blocking === true,
      }}
    >
      <GuidedLessonAssistant step={guidedLesson.step} />
    </ActivityDock>,
    document.body,
  );
};

/**
 * Catches up a player who graduated with the lesson collapsed, on the Quests tab or
 * behind chat: they are moved on to the graduation moments that close the trials,
 * which are full-screen and so are shown from here as well. The assistant only runs
 * while the lesson is on screen, so without this they stay on a lesson that is done.
 */
const TutorialCompletionSync: React.FC = () => {
  const { data: userData, updateUser } = useUserDataSelector((user) => ({
    tutorialOn: user.tutorialOn,
    tutorialStep: user.tutorialStep,
    rank: user.rank,
    userQuests: user.userQuests,
  }));
  const { currentStep, handleNextStep } = useTutorialStep();
  const { mutate: saveStep } = api.profile.updateTutorialStep.useMutation({
    onSuccess: async (data) => {
      if (data.success && data.userPatch?.tutorialStep !== undefined) {
        await updateUser({ tutorialStep: data.userPatch.tutorialStep });
      }
    },
  });
  const screenStep = TUTORIAL_STEPS.findIndex((step) => !!step.screen);
  // Without graduation screens, outgrowing the trials finishes them.
  const graduationStep = screenStep === -1 ? TUTORIAL_STEPS_COUNT : screenStep;
  const isOutgrown =
    hasOutgrownTutorial(userData) && (userData?.tutorialStep ?? 0) < graduationStep;
  const requestedRef = React.useRef(false);
  useEffect(() => {
    if (!isOutgrown || requestedRef.current) return;
    requestedRef.current = true;
    saveStep({ step: graduationStep });
  }, [isOutgrown, graduationStep, saveStep]);
  if (!currentStep?.screen) return null;
  return createPortal(
    <TutorialScreen kind={currentStep.screen} onContinue={() => handleNextStep()} />,
    document.body,
  );
};

const PlayerTutorialAssistant: React.FC<
  TutorialAssistantProps & { tutorialIdentityRef: TutorialIdentityRef }
> = ({
  tutorialIdentityRef,
  rightSideBarOpen,
  setRightSideBarOpen,
  rightSideBarRef,
  sidebarBreakpoint,
}) => {
  // State
  const { data: userData, updateUser } = useUserDataSelector((user) => ({
    userId: user.userId,
    tutorialOn: user.tutorialOn,
    tutorialStep: user.tutorialStep,
    status: user.status,
    battleId: user.battleId,
    level: user.level,
    rank: user.rank,
    experience: user.experience,
    village: user.village,
    sector: user.sector,
    earnedExperience: user.earnedExperience,
    curStamina: user.curStamina,
    maxStamina: user.maxStamina,
    curChakra: user.curChakra,
    maxChakra: user.maxChakra,
    petAcquisitions: user.petAcquisitions,
    playedBefore: user.playedBefore,
    userQuests: user.userQuests,
    questData: user.questData,
  }));
  const pathname = usePublicPathname();
  const router = useRouter();

  // While the lesson is open it leads the player to each step's page itself.
  const setPageGuidance = useSetAtom(tutorialPageGuidanceAtom);
  useEffect(() => {
    setPageGuidance(true);
    return () => setPageGuidance(false);
  }, [setPageGuidance]);

  const {
    isDisablingTutorial,
    disableTutorialError,
    showCancelConfirmDialog,
    setShowCancelConfirmDialog,
    handleDisableTutorial,
  } = useDisableTutorial(userData, updateUser, tutorialIdentityRef);

  const [gameMenuHighlight, setGameMenuHighlight] = useState<{
    top: number;
    left: number;
    width: number;
    height: number;
  } | null>(null);

  // Check if we're on mobile
  const [usesGameMenuDrawer, setUsesGameMenuDrawer] = useState<boolean>(
    sidebarBreakpoint === null ||
      (typeof window !== "undefined" && window.innerWidth < sidebarBreakpoint),
  );

  // Drawer-only frames keep their menu guidance at every viewport width.
  useEffect(() => {
    const handleResize = () => {
      setUsesGameMenuDrawer(
        sidebarBreakpoint === null || window.innerWidth < sidebarBreakpoint,
      );
    };

    window.addEventListener("resize", handleResize);
    handleResize();
    return () => window.removeEventListener("resize", handleResize);
  }, [sidebarBreakpoint]);

  // State to track if we should show the special game menu tutorial
  const [showGameMenuTutorial, setShowGameMenuTutorial] = useState<boolean>(false);
  // The village choice opens as a full page; the player may close it to look around.
  const [isVillageChooserHidden, setIsVillageChooserHidden] = useState(false);
  // The control that opened the chooser is gone once it hides, so focus its reopen button.
  const reopenVillageChooserRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (isVillageChooserHidden) reopenVillageChooserRef.current?.focus();
  }, [isVillageChooserHidden]);
  // Returning players are offered Express Trials until they reach the exam or decline.
  const [hasDeclinedExpress, setHasDeclinedExpress] = useLocalStorage(
    `expressTrialsDeclined:${userData?.userId}`,
    false,
  );

  // Tutorial management hook
  const {
    stepNumber,
    currentStep,
    updateTutorialStep,
    handleNextStep,
    handleNextStepAsync,
    isAssistantVisible,
    setIsAssistantVisible,
  } = useTutorialStep();

  const { checkRewards, isCheckingRewards } = useCheckRewards();

  // Initialize tutorial visibility
  useEffect(() => {
    if (userData) {
      // Early exit if tutorial is disabled
      if (userData?.tutorialOn === false) return;

      // Handle the tutorial step
      const tutorialStep = userData.tutorialStep;
      const isActiveStep = tutorialStep < TUTORIAL_STEPS.length;

      // Get current step config
      const isHospitalized = userData.status === "HOSPITALIZED";
      const currentStepConfig = isHospitalized
        ? TUTORIAL_HOSPITALIZED_STEP
        : currentStep;
      const inBattle = userData.status === "BATTLE";
      const onBattlePage = pathname === "/combat";
      const toBattlePage = currentStepConfig?.page === "/combat";

      // Abandoned tutorial fights leave the user in BATTLE; pull them back
      // before trying to render a later step on the wrong page. Only for a
      // step that is actually about the fight - players past the tutorial (or
      // on an unrelated step) stay free to browse while a battle runs, and a
      // stale BATTLE status with no battle row must not pin them to /combat.
      const isBattleStep =
        toBattlePage ||
        Boolean(currentStepConfig?.onCombatWin) ||
        Boolean(currentStepConfig?.onCombatLoss);
      if (
        inBattle &&
        !onBattlePage &&
        userData.battleId &&
        isActiveStep &&
        isBattleStep
      ) {
        return navigateWithRetry(() => router.replace("/combat"));
      }

      // Show the menu prompt when using a drawer, it is closed, and the step
      // points at something inside the game menu
      const shouldShowGameMenuTutorial =
        usesGameMenuDrawer &&
        !rightSideBarOpen &&
        isActiveStep &&
        currentStepConfig?.requiresGameMenu === true &&
        isTutorialPageMatch(currentStepConfig.page, pathname);

      setShowGameMenuTutorial(shouldShowGameMenuTutorial);

      // Scroll to top when requiresGameMenu is true and menu is not open
      if (shouldShowGameMenuTutorial) {
        window.scrollTo({ top: 0, behavior: "smooth" });
        setIsAssistantVisible(false);
        return;
      }

      // Show tutorial if we have a valid step and we're on the right page
      const onCorrectPage = isTutorialPageMatch(currentStepConfig?.page, pathname);
      const hasRequiredGameMenu =
        currentStepConfig?.requiresGameMenu && usesGameMenuDrawer
          ? rightSideBarOpen
          : true;
      setIsAssistantVisible(isActiveStep && onCorrectPage && hasRequiredGameMenu);

      // If we're at a valid step but not on the correct page, redirect
      if (isActiveStep && !onCorrectPage && currentStepConfig) {
        const keepMenuOpen =
          sidebarBreakpoint === null &&
          window.matchMedia(SIDEBAR_COLUMNS_SHOWN_QUERY).matches;
        if (!keepMenuOpen && !currentStepConfig?.requiresGameMenu) {
          setRightSideBarOpen(false);
        }
        const battleCheck =
          (!onBattlePage && !toBattlePage) || // Unrelated to battle
          (inBattle && toBattlePage); // In battle and going to battle page
        if (battleCheck) {
          return navigateWithRetry(() => router.push(currentStepConfig.page));
        }
      }
    }
  }, [
    userData,
    currentStep,
    pathname,
    router,
    rightSideBarOpen,
    usesGameMenuDrawer,
    sidebarBreakpoint,
  ]);

  // Skip steps that have nothing to do: spending experience the player does
  // not have, adopting a companion when they already formed a bond, or
  // travelling somewhere the player already is.
  useEffect(() => {
    if (userData?.tutorialOn !== true || !currentStep) return;
    const nothingToAssign =
      currentStep.needsUnassignedExperience && userData.earnedExperience === 0;
    // A level-up the player cannot take and has no experience left to assign towards.
    const nothingToLevel =
      currentStep.advanceOn === "levelUp" &&
      userData.earnedExperience === 0 &&
      !!levelUpBlockMessage(userData);
    // On the sanctuary page the new companion is being revealed; Next moves on.
    const alreadyBonded =
      currentStep.advanceOn === "petAdopt" &&
      (userData.petAcquisitions ?? 0) > 0 &&
      pathname !== "/pets";
    // A trip to the sector the player is already standing in has nowhere to go.
    const alreadyThere =
      currentStep.advanceOn === "travelArrive" &&
      currentStep.relatedValue === userData.sector &&
      userData.status === "AWAKE";
    if (nothingToAssign || nothingToLevel || alreadyBonded || alreadyThere) {
      void handleNextStepAsync();
    }
  }, [currentStep, userData, pathname]);

  // A combat lesson whose fight ended while the player was away has nothing to
  // show anywhere: pick the tutorial up at the win, or back at the arena.
  const strandedBattleStepId =
    userData?.tutorialOn === true
      ? getTutorialStrandedBattleStepId(TUTORIAL_STEPS, stepNumber, userData, pathname)
      : undefined;
  useEffect(() => {
    if (!strandedBattleStepId) return;
    const timer = setTimeout(
      () => handleNextStep(strandedBattleStepId),
      STRANDED_BATTLE_STEP_MS,
    );
    return () => clearTimeout(timer);
  }, [strandedBattleStepId, stepNumber]);

  // The hospital step overrides every other step's target.
  const placedStep =
    userData?.status === "HOSPITALIZED" ? TUTORIAL_HOSPITALIZED_STEP : currentStep;
  const { highlight, panelDodgesHighlight } = useHighlightPlacement({
    step: placedStep,
    // A switched-off tutorial, a hidden lesson and a step on another page place nothing.
    enabled:
      userData?.tutorialOn !== false &&
      isAssistantVisible &&
      (!placedStep || isTutorialPageMatch(placedStep.page, pathname)),
    find: (step) => findElementToHighlight(step, rightSideBarRef, rightSideBarOpen),
    // In a fight the field and the action bar must stay in view together.
    revealOnly: pathname === "/combat",
    pathname,
  });

  // Update game menu highlight position when showing game menu tutorial
  useEffect(() => {
    // Early exit if tutorial is disabled
    if (userData?.tutorialOn === false) return;
    if (!showGameMenuTutorial) {
      setGameMenuHighlight(null);
      return;
    }

    return trackLayout(() => {
      const element = getUsableHighlightElement("tutorial-gameBtn");
      const rect = element?.getBoundingClientRect();
      if (rect) {
        const next = {
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
        };
        setGameMenuHighlight((prev) => (prev && isSameBox(prev, next) ? prev : next));
      } else {
        setGameMenuHighlight(null);
      }
      return element;
    });
  }, [
    showGameMenuTutorial,
    pathname,
    rightSideBarRef,
    rightSideBarOpen,
    userData?.tutorialOn,
  ]);

  // Enter or ArrowRight presses the step's Next button
  useEffect(() => {
    // Early exit if tutorial is disabled
    if (userData?.tutorialOn === false) return;
    // Only add keyboard listener when tutorial is visible (either regular or game menu)
    if (!isAssistantVisible && !showGameMenuTutorial) return;

    const handleKeyPress = (event: KeyboardEvent) => {
      // Let the confirmation dialog own its keyboard interactions. In particular,
      // Enter on its focused action must not also advance the obscured tutorial.
      if (event.defaultPrevented || showCancelConfirmDialog) return;
      const target = event.target;
      // Focused controls own their keys, including Activity tabs and panel actions.
      if (
        target instanceof Element &&
        target.closest(
          'button, a, input, textarea, select, [contenteditable="true"], [role="dialog"]',
        )
      )
        return;
      // Check for Enter key or ArrowRight key
      if (event.key === "Enter" || event.key === "ArrowRight") {
        if (isDisablingTutorial) return;
        if (showGameMenuTutorial) {
          event.preventDefault();
          event.stopPropagation();
          setRightSideBarOpen(true);
        } else if (
          currentStep?.showNextButton ||
          currentStep?.proceedOnHighlightClick
        ) {
          event.preventDefault();
          event.stopPropagation();
          handleNextStep();
        }
      }
    };

    // Use capture phase to ensure we get the event before other handlers
    window.addEventListener("keydown", handleKeyPress, true);

    return () => {
      window.removeEventListener("keydown", handleKeyPress, true);
    };
  }, [
    isAssistantVisible,
    showGameMenuTutorial,
    pathname,
    userData?.status,
    userData?.tutorialOn,
    handleNextStep,
    setRightSideBarOpen,
    router,
    currentStep?.showNextButton,
    currentStep?.proceedOnHighlightClick,
    isDisablingTutorial,
    showCancelConfirmDialog,
  ]);

  // A step whose only exit is one specific game action can strand a player
  // when that action fails for a reason the lesson does not cover. After a
  // minute on the same step, offer to move on.
  const [stuckStepId, setStuckStepId] = useState<string>();
  useEffect(() => {
    const stepId = currentStep?.id;
    if (!stepId || currentStep?.showNextButton || !isAssistantVisible) return;
    const timer = setTimeout(() => setStuckStepId(stepId), STUCK_STEP_SECONDS * 1000);
    return () => clearTimeout(timer);
  }, [currentStep?.id, currentStep?.showNextButton, isAssistantVisible]);

  // A lesson that teaches a control in the game itself offers its own button once the
  // player has done nothing for a few seconds; any tap or key press restarts the wait.
  const teachesInGame = !!(currentStep?.teachOnPage || currentStep?.questsTabPrompt);
  const [idleStepId, setIdleStepId] = useState<string>();
  useEffect(() => {
    const stepId = currentStep?.id;
    if (!stepId || !teachesInGame || !isAssistantVisible || idleStepId === stepId)
      return;
    let timer = setTimeout(() => setIdleStepId(stepId), SHORTCUT_IDLE_SECONDS * 1000);
    const restart = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setIdleStepId(stepId), SHORTCUT_IDLE_SECONDS * 1000);
    };
    window.addEventListener("pointerdown", restart, { passive: true });
    window.addEventListener("keydown", restart);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("pointerdown", restart);
      window.removeEventListener("keydown", restart);
    };
  }, [currentStep?.id, teachesInGame, isAssistantVisible, idleStepId]);

  // A lesson answered or claimed on the Quests tab tells that tab what to prompt.
  const setQuestsTabLesson = useSetAtom(questsTabLessonAtom);
  const questsTabQuestId =
    currentStep?.questsTabPrompt && typeof currentStep.relatedValue === "string"
      ? currentStep.relatedValue
      : undefined;
  const questsTabPrompt = currentStep?.questsTabPrompt;
  useEffect(() => {
    setQuestsTabLesson(
      questsTabQuestId && questsTabPrompt
        ? { questId: questsTabQuestId, prompt: questsTabPrompt }
        : null,
    );
  }, [questsTabQuestId, questsTabPrompt, setQuestsTabLesson]);

  // Once the trials are over the story leads: its chapter and Leads come before other quests.
  const { story, user: storyUser } = useStoryGuidance();
  const storyQuestIds = [
    ...(story?.currentQuestId ? [story.currentQuestId] : []),
    ...(story?.activeLeadIds ?? []),
  ];
  const storyCard = useStoryDockCard();

  // Dialog state for quest type ordering
  const [showOrderingDialog, setShowOrderingDialog] = useState(false);

  const {
    postTutorialQuest,
    showPostTutorialQuest,
    questTypePriority,
    setQuestTypePriority,
  } = usePostTutorialQuest(userData, stepNumber, storyQuestIds);

  // Determine which step to show - hospitalized overrides everything
  const isHospitalized = userData?.status === "HOSPITALIZED";

  // The guided quest's current objective, for its text and its characters
  const postTutorialObjective =
    showPostTutorialQuest && postTutorialQuest
      ? getActiveObjective(postTutorialQuest.userQuest.quest, postTutorialQuest.tracker)
      : undefined;

  // Create a dynamic tutorial step for post-tutorial quest guidance
  let dynamicQuestStep: TutorialStepConfig | null = null;
  if (showPostTutorialQuest && postTutorialQuest) {
    const quest = postTutorialQuest.userQuest.quest;

    // Determine the text to show
    let description = quest.description;
    if (quest.consecutiveObjectives && postTutorialObjective?.description) {
      description = postTutorialObjective.description;
    }

    dynamicQuestStep = {
      id: `quest-${quest.id}`,
      chapter: "genin",
      title: quest.name,
      description: description,
      page: pathname,
      relatedValue: quest.id,
      showNextButton: false,
      // Early chapters still offer the one-tap trip; later ones leave the way to the player.
      autoTravelLabel: (() => {
        const chapter = getChapterForQuest(quest.id);
        if (!chapter) return undefined;
        const navigation = getNavigationLevel(chapter, storyUser?.guidanceLevel);
        return navigation === "G3" || navigation === "G2" ? "Take me there" : undefined;
      })(),
    };
  }

  const hasBonded =
    currentStep?.advanceOn === "petAdopt" && (userData?.petAcquisitions ?? 0) > 0;
  // Ramen only restores stamina and chakra; with both full there is nothing to buy.
  const isWellFed =
    currentStep?.advanceOn === "buyRamen" &&
    !!userData &&
    userData.curStamina >= userData.maxStamina &&
    userData.curChakra >= userData.maxChakra;
  const currentTutorialStep =
    dynamicQuestStep ||
    (isHospitalized
      ? TUTORIAL_HOSPITALIZED_STEP
      : hasBonded && currentStep
        ? {
            ...currentStep,
            title: "A bond is formed",
            description:
              "The Bondkeepers bless your new bond. Your companion's portrait takes a few minutes to paint; it will be ready by the time you graduate.",
            action: undefined,
            elementIds: ["tutorial-pet-acquisition"],
          }
        : isWellFed && currentStep
          ? {
              ...currentStep,
              description:
                "Your stamina and chakra are full right now, so the bowls are greyed out. Remember this place for after a fight: a bowl costs only a few ryo. Health comes back by resting, or at the hospital.",
              action: "Tap Next.",
            }
          : currentStep);

  // The quest the current step talks about, with its live tracker
  const relatedQuest = (() => {
    if (userData?.tutorialOn === false || !currentTutorialStep?.relatedValue) return;
    const userQuest = userData?.userQuests?.find(
      (uq) => uq.questId === currentTutorialStep.relatedValue && !uq.endAt,
    );
    const tracker = userQuest
      ? userData?.questData?.find((q) => q.id === userQuest.questId)
      : undefined;
    return userQuest && tracker ? { userQuest, tracker } : undefined;
  })();

  // Dialog options when the related quest is waiting on a dialog answer
  const activeRelatedObjective = relatedQuest
    ? getActiveObjective(relatedQuest.userQuest.quest, relatedQuest.tracker)
    : undefined;
  // A lost lesson fight the player can start again from the lesson itself.
  const retryQuestId = (() => {
    const objectiveId = currentTutorialStep?.objectiveId;
    if (!relatedQuest || !objectiveId || !currentTutorialStep?.onCombatLoss) return;
    const ids = toObjectiveIds(objectiveId);
    const goal = relatedQuest.tracker.goals.find((entry) => ids.includes(entry.id));
    return canRetryQuestBattle(goal) ? relatedQuest.tracker.id : undefined;
  })();
  const { retryBattle, isRetrying } = useRetryQuestBattle();
  // Placement-bound choices belong to the NPC's dialog on the map.
  const isVillageChoice = currentTutorialStep?.id === TUTORIAL_VILLAGE_CHOICE_STEP_ID;
  const dialogOptions =
    activeRelatedObjective?.task === "dialog" &&
    !activeRelatedObjective.overworldPlacementId &&
    (dynamicQuestStep || currentTutorialStep?.advanceOn === "questDialog")
      ? {
          questId: relatedQuest?.userQuest.questId ?? "",
          objectiveId: activeRelatedObjective.id,
          options: activeRelatedObjective.nextObjectiveId,
        }
      : null;

  // Reward waiting to be claimed on a claim step
  const claimable = (() => {
    if (currentTutorialStep?.advanceOn !== "questReward" || !relatedQuest) return;
    const quest = relatedQuest.userQuest.quest;
    const objective = quest.content.objectives.find(
      (entry) => entry.id === currentTutorialStep.objectiveId,
    );
    const goal = relatedQuest.tracker.goals.find((entry) => entry.id === objective?.id);
    if (!objective) return;
    // Winning the quest pays the quest's own reward rather than the objective's.
    const reward = objective.task === "win_quest" ? quest.content.reward : objective;
    const rank =
      reward.reward_rank !== "NONE"
        ? capitalizeFirstLetter(reward.reward_rank.toLowerCase())
        : "";
    return {
      questId: relatedQuest.userQuest.questId,
      // Winning collects itself; what is left to claim is the finished quest.
      isReady:
        objective.task === "win_quest"
          ? isQuestComplete(quest, relatedQuest.tracker)
          : !!goal?.done && !goal.collected,
      objectiveText: objective.description,
      rewards: [
        rank ? `${rank} rank` : "",
        reward.reward_exp ? `${reward.reward_exp.toLocaleString()} XP` : "",
        reward.reward_money ? `${reward.reward_money.toLocaleString()} ryo` : "",
      ].filter(Boolean),
    };
  })();

  // Where the related quest wants the player to go next, for a one-tap trip there
  const autoTravelHref = (() => {
    if (!currentTutorialStep?.autoTravelLabel) return;
    // A travel step names its sector; finding the spot there is the next lesson.
    if (
      currentTutorialStep.advanceOn === "travelArrive" &&
      typeof currentTutorialStep.relatedValue === "number"
    ) {
      // Nothing to start while already on the way.
      if (userData?.status !== "AWAKE") return;
      return `/travel?sector=${currentTutorialStep.relatedValue}`;
    }
    if (!activeRelatedObjective || !relatedQuest) return;
    // The tracker holds the location instantiated for this player, which the
    // server checks arrival against; the content is the fallback.
    const objective = activeRelatedObjective;
    const goal = relatedQuest.tracker.goals.find((entry) => entry.id === objective.id);
    const sector =
      goal?.sector ?? ("sector" in objective ? objective.sector : undefined);
    const longitude =
      goal?.longitude ?? ("longitude" in objective ? objective.longitude : undefined);
    const latitude =
      goal?.latitude ?? ("latitude" in objective ? objective.latitude : undefined);
    if (sector === undefined || longitude === undefined || latitude === undefined)
      return;
    return `/travel?sector=${sector}&longitude=${longitude}&latitude=${latitude}`;
  })();

  // The starter quest can be further along than the step expects (a player
  // who came back after the trials changed, or whose action landed while
  // another tab was on an earlier step). Move them to the first step that
  // still has something to do, or back when they skipped past what the quest
  // still needs.
  const catchUpIndex = isTutorialActive(userData)
    ? (getTutorialCatchUpStepIndex(TUTORIAL_STEPS, stepNumber, userData) ??
      getTutorialRewindStepIndex(TUTORIAL_STEPS, stepNumber, userData))
    : undefined;
  const catchUpRef = React.useRef<string>("");
  useEffect(() => {
    if (catchUpIndex === undefined) return;
    const key = `${stepNumber}:${catchUpIndex}`;
    if (catchUpRef.current === key) return;
    catchUpRef.current = key;
    void updateTutorialStep({ step: catchUpIndex });
  }, [catchUpIndex, stepNumber, updateTutorialStep]);

  // Get character images for post-tutorial quest (no background)
  // For starter quests, skip fetching scene characters - we'll use the A/B tested assistant image instead
  const postTutorialCharacterIds: string[] = [];
  if (showPostTutorialQuest && postTutorialQuest) {
    const quest = postTutorialQuest.userQuest.quest;
    const isStarterQuest = quest.questType === "starter";
    // Only consecutive quests have an active objective, which may cast its own scene.
    if (!isStarterQuest) {
      postTutorialCharacterIds.push(
        ...(postTutorialObjective?.sceneCharacters?.length
          ? postTutorialObjective.sceneCharacters
          : quest.content.sceneCharacters || []),
      );
    }
  }

  // Query to fetch character assets for post-tutorial quest
  const { data: postTutorialCharacterAssets } = api.gameAsset.getSceneAssets.useQuery(
    { assetIds: postTutorialCharacterIds },
    { enabled: postTutorialCharacterIds.length > 0 },
  );

  // Past the trials the close button only switches off story guidance.
  const isPostTutorial = stepNumber >= TUTORIAL_STEPS.length;
  const disableLabel = isPostTutorial ? "Hide story guidance" : "Skip tutorial";
  const openDisableModal = () => {
    if (isPostTutorial) {
      void handleDisableTutorial();
    } else {
      setShowCancelConfirmDialog(true);
    }
  };

  // Chapter label and progress for the header
  const chapterProgress = getTutorialChapterProgress(TUTORIAL_STEPS, stepNumber);
  const chapterIndex = TUTORIAL_CHAPTERS.findIndex(
    (chapter) => chapter.id === chapterProgress?.chapter,
  );
  const chapterEyebrow =
    chapterIndex > -1
      ? `Chapter ${chapterIndex + 1} of ${TUTORIAL_CHAPTERS.length} · ${TUTORIAL_CHAPTERS[chapterIndex]?.title}`
      : undefined;

  // Keep the game-menu highlight on the viewport and its explanation in Activity.
  const renderGameMenuTutorial = () => {
    if (gameMenuHighlight) {
      return (
        <>
          <Spotlight box={gameMenuHighlight}>
            <button
              type="button"
              className="pointer-events-auto absolute inset-0 z-[2] cursor-pointer disabled:cursor-wait"
              disabled={isDisablingTutorial}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (isDisablingTutorial) return;
                setRightSideBarOpen(true);
              }}
            />
          </Spotlight>
          <AssistantDialog
            title={currentStep?.title ?? "Game menu"}
            eyebrow={chapterEyebrow}
            progress={chapterProgress}
            stepId={`menu-${currentStep?.id}`}
            action="Tap the highlighted menu button."
            isBusy={isDisablingTutorial}
            errorMessage={disableTutorialError}
            onOpenDisableModal={openDisableModal}
            disableLabel={disableLabel}
            lead={
              <p className="text-base leading-relaxed">
                The location and main menus live in the game menu.
              </p>
            }
            footer={
              <div className="flex justify-end">
                <Button size="lg" onClick={() => setRightSideBarOpen(true)}>
                  Open menu <ArrowRight className="ml-2 h-5 w-5" />
                </Button>
              </div>
            }
          />
        </>
      );
    }

    // Fallback dialog if button not found
    return (
      <Dialog open={true}>
        <DialogContent className="z-[60] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Continue the tutorial</DialogTitle>
            <DialogDescription>
              Open the game menu with the button in the top right corner to continue.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 flex justify-between">
            <Button onClick={() => setRightSideBarOpen(true)}>Open menu</Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  };

  // Early return if tutorial is disabled
  if (userData?.tutorialOn === false) {
    return null;
  }

  // Get character image for post-tutorial quest
  const characterImage =
    showPostTutorialQuest && postTutorialQuest
      ? postTutorialCharacterAssets
          ?.filter((asset) => asset.type === "SCENE_CHARACTER")
          .map((asset) => asset.image)?.[0]
      : undefined;

  // Derived
  const pointerEvents =
    !isDisablingTutorial &&
    currentTutorialStep?.proceedOnHighlightClick &&
    highlight?.isPrimaryElement
      ? "pointer-events-auto"
      : "pointer-events-none";
  // Point at the highlight only when the step wants it pressed.
  const showPointer =
    !!currentTutorialStep?.action || !!currentTutorialStep?.proceedOnHighlightClick;

  // If showing the special Game Menu tutorial
  if (showGameMenuTutorial) {
    return (
      <>
        {!showCancelConfirmDialog && renderGameMenuTutorial()}
        <CancelTutorialConfirmDialog
          open={showCancelConfirmDialog}
          onOpenChange={setShowCancelConfirmDialog}
          onConfirm={() => void handleDisableTutorial()}
          isPending={isDisablingTutorial}
          errorMessage={disableTutorialError}
        />
      </>
    );
  }

  // After the trials the story card leads whenever it outranks the quest on show, and
  // stands in for an empty dock otherwise.
  if (
    isPostTutorial &&
    storyCard &&
    (STORY_CARD_OVERRIDES.some((prefix) => storyCard.id.startsWith(prefix)) ||
      !showPostTutorialQuest)
  ) {
    return (
      <>
        <StorySpotlight />
        <AssistantDialog
          title={storyCard.title}
          eyebrow={storyCard.eyebrow}
          stepId={storyCard.id}
          lead={storyCard.lead}
          footer={storyCard.footer}
          onOpenDisableModal={openDisableModal}
          disableLabel={disableLabel}
        />
      </>
    );
  }

  if ((!isAssistantVisible && !showPostTutorialQuest) || !currentTutorialStep) {
    return (
      <div className="text-muted-foreground space-y-2 p-4 text-sm">
        <p>
          {isTutorialActive(userData)
            ? "There is no tutorial guidance on this page."
            : "Tutorial complete. Quest guidance will appear here when available."}
        </p>
        <Link
          className="text-primary underline dark:text-amber-300"
          href={`${SETTINGS_HREF}&settings=help&setting=tutorial`}
        >
          Open tutorial settings
        </Link>
      </div>
    );
  }

  const isQuestOverlay = !!dynamicQuestStep;
  // A lesson that teaches the page's own control offers its shortcut only to a stuck player.
  const isShortcutWithheld =
    !!(currentTutorialStep.teachOnPage || currentTutorialStep.questsTabPrompt) &&
    idleStepId !== currentTutorialStep.id;
  // Fights end on their own; skipping a step mid-battle would lose the lesson.
  // The quest cannot go on without Sonic Slash, so its lesson has no skip either.
  const isStuck =
    !isQuestOverlay &&
    !isTutorialJutsuPickStep(currentTutorialStep) &&
    stuckStepId === currentTutorialStep.id &&
    !currentTutorialStep.showNextButton &&
    !currentTutorialStep.onCombatWin &&
    pathname !== "/combat" &&
    !dialogOptions &&
    !claimable?.isReady;
  // In a phone battle, or a fight's dock narrowed beside the field, a step with an
  // instruction shows only that, so the field and the controls stay visible. A rematch's
  // instruction only says to win, so its advice stays.
  const leadClassName = cn(
    "text-base leading-relaxed",
    pathname === "/combat" &&
      currentTutorialStep.action &&
      currentTutorialStep.title !== TUTORIAL_REMATCH_TITLE &&
      "max-md:hidden @max-[17rem]/dock:hidden",
  );

  // Render the tutorial overlay with highlight and assistant panel
  return (
    <>
      {userData?.playedBefore &&
        userData.rank === "STUDENT" &&
        !hasDeclinedExpress &&
        stepNumber < EXPRESS_TRIALS_EXAM_STEP &&
        createPortal(
          <ExpressTrialsScreen
            examStep={EXPRESS_TRIALS_EXAM_STEP}
            onDecline={() => setHasDeclinedExpress(true)}
          />,
          document.body,
        )}
      {currentStep?.screen &&
        isTutorialActive(userData) &&
        createPortal(
          <TutorialScreen
            kind={currentStep.screen}
            onContinue={() => handleNextStep()}
          />,
          document.body,
        )}
      {highlight &&
        highlight.stepId === currentTutorialStep.id &&
        !showCancelConfirmDialog && (
          // Only the highlighted control captures clicks; game controls stay reachable.
          <Spotlight
            box={highlight}
            ping={showPointer}
            pointer={showPointer}
            holeClassName={cn("bg-transparent", pointerEvents)}
          >
            <button
              type="button"
              className={cn("absolute inset-0 z-[2] cursor-pointer", pointerEvents)}
              aria-label={currentTutorialStep.action ?? "Continue tutorial"}
              disabled={isDisablingTutorial}
              onClick={(e) => {
                if (currentTutorialStep.proceedOnHighlightClick) {
                  e.preventDefault();
                  e.stopPropagation();
                  if (!isDisablingTutorial) handleNextStep();
                }
              }}
            />
          </Spotlight>
        )}

      {/* Assistant panel */}
      {!showOrderingDialog && !showCancelConfirmDialog && (
        <AssistantDialog
          title={currentTutorialStep.title}
          eyebrow={isQuestOverlay ? "Active quest" : chapterEyebrow}
          progress={isQuestOverlay ? undefined : chapterProgress}
          stepId={currentTutorialStep.id}
          action={isQuestOverlay ? undefined : currentTutorialStep.action}
          isBusy={isDisablingTutorial}
          errorMessage={disableTutorialError}
          onOpenDisableModal={openDisableModal}
          disableLabel={disableLabel}
          characterImage={characterImage}
          dodgeHighlight={panelDodgesHighlight}
          onOpenOrderingDialog={() => setShowOrderingDialog(true)}
          showOrderingButton={showPostTutorialQuest}
          footer={
            <>
              {autoTravelHref &&
                currentTutorialStep.autoTravelLabel &&
                !isShortcutWithheld && (
                  <ClaimHighlight
                    // The trip button is the step's action until a page control takes over.
                    active={
                      currentTutorialStep.advanceOn === "travelArrive" &&
                      highlight?.stepId !== currentTutorialStep.id
                    }
                  >
                    <Button
                      size="lg"
                      className="w-full"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        router.push(autoTravelHref);
                      }}
                    >
                      <MapPin className="mr-2 h-5 w-5" aria-hidden="true" />
                      {currentTutorialStep.autoTravelLabel}
                    </Button>
                  </ClaimHighlight>
                )}
              {retryQuestId && (
                <Button
                  size="lg"
                  decoration="gold"
                  className="w-full"
                  disabled={isRetrying || userData?.status !== "AWAKE"}
                  onClick={() => retryBattle({ questId: retryQuestId })}
                >
                  <RotateCcw className="mr-2 h-5 w-5" aria-hidden="true" />
                  {isRetrying ? "Retrying..." : "Retry battle"}
                </Button>
              )}
              {dialogOptions && isVillageChoice && isVillageChooserHidden && (
                <Button
                  ref={reopenVillageChooserRef}
                  size="lg"
                  decoration="gold"
                  className="w-full"
                  onClick={() => setIsVillageChooserHidden(false)}
                >
                  Choose your village
                </Button>
              )}
              {dialogOptions &&
                isVillageChoice &&
                !isVillageChooserHidden &&
                createPortal(
                  <VillageChooser
                    options={dialogOptions.options}
                    isPending={isCheckingRewards}
                    onHide={() => setIsVillageChooserHidden(true)}
                    onChoose={(option) =>
                      checkRewards({
                        questId: dialogOptions.questId,
                        nextObjectiveId: dialogChoiceContentId(
                          option.nextObjectiveId ?? undefined,
                          dialogOptions.objectiveId,
                        ),
                      })
                    }
                  />,
                  document.body,
                )}
              {dialogOptions && !isVillageChoice && !isShortcutWithheld && (
                <div>
                  <h3 className="mb-2 flex items-center text-base font-semibold">
                    Your answer
                    {isCheckingRewards && (
                      <Loader2
                        className="ml-2 inline h-4 w-4 shrink-0 animate-spin"
                        aria-label="Loading"
                      />
                    )}
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {!isCheckingRewards &&
                      dialogOptions.options.map((entry) => (
                        <Button
                          key={entry.nextObjectiveId ?? entry.text}
                          variant={isQuestOverlay ? "outline" : "default"}
                          size="lg"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            checkRewards({
                              questId: dialogOptions.questId,
                              nextObjectiveId: dialogChoiceContentId(
                                entry.nextObjectiveId,
                                dialogOptions.objectiveId,
                              ),
                            });
                          }}
                          className="min-w-[120px] flex-1"
                        >
                          {entry.text}
                        </Button>
                      ))}
                  </div>
                </div>
              )}
              {claimable && !isShortcutWithheld && (
                <div className="bg-muted/40 rounded-lg border p-3">
                  {claimable.isReady ? (
                    <ClaimHighlight
                      // Without a logbook entry on the page, this is the only place to claim.
                      active={!currentTutorialStep.elementIds?.length}
                    >
                      <Button
                        size="lg"
                        decoration="gold"
                        animation={
                          currentTutorialStep.elementIds?.length || isCheckingRewards
                            ? undefined
                            : "pulse"
                        }
                        className="w-full"
                        disabled={isCheckingRewards}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          checkRewards({ questId: claimable.questId });
                        }}
                      >
                        {isCheckingRewards ? (
                          <Loader2
                            className="mr-2 h-5 w-5 animate-spin"
                            aria-hidden="true"
                          />
                        ) : (
                          <Gift className="mr-2 h-5 w-5" aria-hidden="true" />
                        )}
                        {isCheckingRewards
                          ? "Claiming"
                          : `Claim${claimable.rewards.length ? ` ${claimable.rewards.join(" + ")}` : " reward"}`}
                      </Button>
                    </ClaimHighlight>
                  ) : (
                    <p className="text-muted-foreground text-base">
                      Objective:{" "}
                      {parseHtml(claimable.objectiveText || "Complete the task.")}
                    </p>
                  )}
                </div>
              )}
              {(currentTutorialStep.showNextButton || isStuck) && (
                <div className="flex items-center justify-end gap-3">
                  {isStuck && (
                    <span className="text-muted-foreground text-sm">Stuck here?</span>
                  )}
                  <Button
                    size="lg"
                    variant={isStuck ? "outline" : "default"}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleNextStep();
                    }}
                  >
                    {isStuck && !currentTutorialStep.showNextButton
                      ? "Skip this step"
                      : (currentTutorialStep.nextLabel ??
                        (stepNumber === TUTORIAL_STEPS.length - 1 ? "Finish" : "Next"))}
                    <ArrowRight className="ml-2 h-5 w-5" />
                  </Button>
                </div>
              )}
            </>
          }
          lead={
            typeof currentTutorialStep.description === "string" ? (
              <p className={leadClassName}>
                {parseHtml(currentTutorialStep.description)}
              </p>
            ) : (
              <div className={leadClassName}>{currentTutorialStep.description}</div>
            )
          }
        >
          {currentTutorialStep.quoteObjective &&
            activeRelatedObjective?.description && (
              <blockquote className="border-primary bg-muted/40 border-l-4 py-2 pr-3 pl-3 text-base leading-relaxed italic">
                {parseHtml(activeRelatedObjective.description)}
              </blockquote>
            )}
          {isQuestOverlay && postTutorialQuest?.userQuest.quest.content.objectives && (
            <PostTutorialQuestObjectives
              postTutorialQuest={postTutorialQuest}
              userData={userData}
              checkRewards={checkRewards}
            />
          )}
        </AssistantDialog>
      )}

      {/* Quest Type Ordering Dialog */}
      <Dialog open={showOrderingDialog} onOpenChange={setShowOrderingDialog}>
        <DialogContent className="z-[70] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Quest Priority Order</DialogTitle>
            <DialogDescription>
              Drag to reorder which quest types should be shown first in the assistant.
            </DialogDescription>
          </DialogHeader>
          <SortableList
            items={questTypePriority.map((type) => ({
              id: type,
              label: capitalizeFirstLetter(type),
            }))}
            onReorder={(items: SortableItem[]) => {
              setQuestTypePriority(items.map((item) => item.id as QuestType));
            }}
            className="max-h-[60vh] overflow-y-auto"
          />
          <div className="mt-4 flex justify-between">
            <Button
              variant="outline"
              onClick={() => {
                setQuestTypePriority([...OrderedQuestTypesInTutorial]);
              }}
            >
              Reset to Default
            </Button>
            <Button onClick={() => setShowOrderingDialog(false)}>Done</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Cancel Tutorial Confirmation Dialog */}
      <CancelTutorialConfirmDialog
        open={showCancelConfirmDialog}
        onOpenChange={setShowCancelConfirmDialog}
        onConfirm={() => void handleDisableTutorial()}
        isPending={isDisablingTutorial}
        errorMessage={disableTutorialError}
      />
    </>
  );
};

/**
 * A guided lesson's step in the tutorial assistant: the same lesson panel, spotlight,
 * hand pointer and placement as the main tutorial, with the step supplied by the scene
 * that registered it. Its target is only revealed, never centred, so a game table stays
 * in view around it, and taps fall through the ring to the real control. A blocking
 * step dims the whole page behind the dock and waits for an answer in its footer.
 */
const GuidedLessonAssistant: React.FC<{ step: GuidedLessonStep }> = ({ step }) => {
  const pathname = usePublicPathname();
  // Keyed by the step's id and target, so a re-registered step with fresh footer
  // handlers keeps its placement.
  const placedTarget = React.useMemo(
    () => (step.target ? { id: step.id, selector: step.target } : null),
    [step.id, step.target],
  );
  const { highlight, panelDodgesHighlight } = useHighlightPlacement({
    step: placedTarget,
    enabled: true,
    find: (target) => findGuidedTarget(target.selector),
    revealOnly: true,
    pathname,
  });
  // A blocking step takes the keyboard focus, so its answers are one Tab away.
  React.useEffect(() => {
    if (!step.blocking) return;
    document
      .getElementById(TUTORIAL_ASSISTANT_PANEL_ID)
      ?.querySelector<HTMLElement>("[data-guided-footer] button:not(:disabled)")
      ?.focus({ preventScroll: true });
  }, [step.id, step.blocking]);
  const box = highlight?.stepId === step.id ? highlight : null;
  const marks = useGuidedMarks(step);
  return (
    <>
      {box && !step.blocking ? (
        <Spotlight
          box={box}
          marks={marks}
          holeClassName="pointer-events-none bg-transparent"
        />
      ) : null}
      {step.blocking
        ? createPortal(
            // Below the open lesson's dock (z-[61]), taking the page's taps; the cards
            // the notice names stay uncovered and marked.
            <div
              data-battle-focus-layer
              data-guided-lesson-block=""
              aria-hidden="true"
              className={cn(
                "fixed inset-0 z-[60]",
                marks.length === 0 && "bg-black/55",
              )}
            >
              {marks.length > 0 ? <SpotlightMarks marks={marks} /> : null}
            </div>,
            document.body,
          )
        : null}
      <AssistantDialog
        title={step.title}
        eyebrow={step.eyebrow}
        progress={step.progress}
        stepId={step.id}
        action={step.action}
        lead={step.lead}
        dodgeHighlight={panelDodgesHighlight}
        footer={
          step.footer ? <div data-guided-footer="">{step.footer}</div> : undefined
        }
      />
    </>
  );
};

/**
 * Lemu, or whoever speaks in the lesson, in a column down the card's left side,
 * facing the text on a tint that fades into the card behind a tapered divider. She
 * fills the column's height from just below its top, and her picture reaches a
 * little past the divider into the text's left padding (both in rem, so at every
 * size), letting her raised hand cross it without covering the words.
 */
const AssistantPortrait: React.FC<{ image: string }> = ({ image }) => (
  <div
    aria-hidden="true"
    data-tutorial-portrait
    className="from-primary/10 relative w-1/5 max-w-36 min-w-[4.5rem] shrink-0 rounded-bl-xl bg-linear-to-r to-transparent"
  >
    <span className="via-primary/50 absolute inset-y-4 right-0 w-px bg-linear-to-b from-transparent to-transparent" />
    <Image
      src={image}
      width={512}
      height={768}
      alt=""
      // Her whole figure at its own proportions. The picture's transparent margin is
      // about 30% of its width, so this shift lets her hair step a little past the card's
      // left edge at any lesson height, inside the dock's margin to the screen.
      className="pointer-events-none absolute top-2 bottom-0 left-0 h-[calc(100%-0.5rem)] w-auto max-w-none -translate-x-[30%] scale-x-[-1] drop-shadow-md select-none"
    />
  </div>
);

/**
 * The tutorial lesson inside the Activity dock: a header naming the chapter and
 * a progress bar, so a player always knows where they are in the trials, then
 * scrolling text above the call to action and the controls that answer it.
 */
const AssistantDialog: React.FC<{
  title: string;
  eyebrow?: string;
  progress?: { position: number; total: number };
  stepId?: string;
  action?: string;
  /** What Lemu says, shown above the call to action. */
  lead?: React.ReactNode;
  children?: React.ReactNode;
  /** Controls that answer the step, kept in view under the scrolling text. */
  footer?: React.ReactNode;
  onOpenDisableModal?: () => void;
  /** Accessible name of the close button that calls `onOpenDisableModal`. */
  disableLabel?: string;
  characterImage?: string;
  onOpenOrderingDialog?: () => void;
  showOrderingButton?: boolean;
  /** Anchor to the top instead, to uncover a highlight it would otherwise sit on. */
  dodgeHighlight?: boolean;
  isBusy?: boolean;
  errorMessage?: string;
}> = ({
  title,
  eyebrow,
  progress,
  stepId,
  action,
  lead,
  children,
  footer,
  onOpenDisableModal,
  disableLabel = "Skip tutorial",
  characterImage,
  onOpenOrderingDialog,
  showOrderingButton,
  dodgeHighlight,
  isBusy = false,
  errorMessage,
}) => {
  const sectionRef = React.useRef<HTMLElement>(null);
  const lemuImage = characterImage || IMG_URL_ASSISTANT;
  // A speaker already standing in the page's quest scene is not shown twice.
  const isSpeakerInScene = useAtomValue(sceneCharactersAtom).some((scene) =>
    scene.includes(lemuImage),
  );
  // The dock is fixed over the foot of the page; while a lesson is open the game
  // layouts pad their content by its height, so whatever it covers can be
  // scrolled clear of it.
  React.useLayoutEffect(() => {
    const dock = sectionRef.current?.closest<HTMLElement>("[data-activity-dock]");
    if (!dock) return;
    const root = document.documentElement;
    const reserve = () =>
      root.style.setProperty("--activity-dock-space", `${dock.offsetHeight}px`);
    reserve();
    const observer = new ResizeObserver(reserve);
    observer.observe(dock);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--activity-dock-space");
    };
  }, []);
  return (
    <section
      ref={sectionRef}
      id={TUTORIAL_ASSISTANT_PANEL_ID}
      data-tutorial-step={stepId}
      data-dodge-highlight={dodgeHighlight || undefined}
      aria-label={`Tutorial: ${title}`}
      aria-live="polite"
      className="pointer-events-auto"
    >
      <CoachCard
        title={title}
        eyebrow={eyebrow}
        progress={progress}
        action={action}
        lead={lead}
        footer={footer}
        onDismiss={onOpenDisableModal}
        dismissLabel={disableLabel}
        portrait={
          isSpeakerInScene ? undefined : <AssistantPortrait image={lemuImage} />
        }
        isBusy={isBusy}
        errorMessage={errorMessage}
      >
        {children}
        {showOrderingButton && onOpenOrderingDialog && (
          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onOpenOrderingDialog();
              }}
              className="opacity-60 hover:opacity-100"
              title="Sort quest priorities"
            >
              <Settings2 className="mr-1 h-4 w-4" />
              <span className="text-sm">Priority</span>
            </Button>
          </div>
        )}
      </CoachCard>
    </section>
  );
};

/**
 * Confirmation dialog for cancelling the tutorial
 * Shows the assistant character and warns the user
 */
const CancelTutorialConfirmDialog: React.FC<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  isPending: boolean;
  errorMessage?: string;
}> = ({ open, onOpenChange, onConfirm, isPending, errorMessage }) => {
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!isPending) onOpenChange(nextOpen);
      }}
    >
      <DialogContent
        className="z-[70] sm:max-w-md"
        closeDisabled={isPending}
        aria-busy={isPending}
        onEscapeKeyDown={(event) => {
          if (isPending) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (isPending) event.preventDefault();
        }}
      >
        <div className="flex gap-4">
          <div className="min-w-0 flex-1 space-y-4">
            <DialogHeader>
              <DialogTitle>Skip the Academy Trials?</DialogTitle>
              <DialogDescription className="pt-2">
                The trials teach combat, training, travel and companions, and they grant
                the experience you need for the Genin exam. We{" "}
                <strong>highly recommend</strong> finishing them.
                <br />
                <br />
                If you change your mind, you can turn the tutorial back on from the
                support button.
              </DialogDescription>
            </DialogHeader>
            {errorMessage && !isPending && (
              <p role="alert" className="text-destructive text-sm">
                {errorMessage}
              </p>
            )}
            <div className="flex justify-start gap-2">
              <Button
                variant="outline"
                disabled={isPending}
                onClick={() => onOpenChange(false)}
              >
                Keep training
              </Button>
              <Button variant="destructive" disabled={isPending} onClick={onConfirm}>
                {isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    <span role="status" aria-live="polite">
                      Disabling
                    </span>
                  </>
                ) : (
                  "Skip tutorial"
                )}
              </Button>
            </div>
          </div>
          <Image
            src={IMG_URL_ASSISTANT}
            width={256}
            height={384}
            alt=""
            aria-hidden="true"
            className="pointer-events-none h-40 w-auto shrink-0 self-end object-contain drop-shadow-lg select-none max-sm:hidden"
          />
        </div>
      </DialogContent>
    </Dialog>
  );
};

/** The guided quest's objectives, with its reward once every objective is done. */
const PostTutorialQuestObjectives: React.FC<{
  postTutorialQuest: PostTutorialQuest;
  userData: { status: string } | undefined;
  checkRewards: ReturnType<typeof useCheckRewards>["checkRewards"];
}> = ({ postTutorialQuest, userData, checkRewards }) => (
  <>
    <div className="grid grid-cols-2 gap-4">
      <QuestObjectives
        quest={postTutorialQuest.userQuest.quest}
        tracker={postTutorialQuest.tracker}
        checkRewards={() =>
          checkRewards({ questId: postTutorialQuest.userQuest.quest.id })
        }
      />
    </div>
    {isQuestComplete(postTutorialQuest.userQuest.quest, postTutorialQuest.tracker) &&
      !postTutorialQuest.userQuest.completed &&
      userData?.status === "AWAKE" && (
        <Button
          onClick={() => {
            checkRewards({
              questId: postTutorialQuest.userQuest.quest.id,
            });
          }}
          className="w-full"
        >
          <Sparkles className="mr-2 h-5 w-5" />
          Collect Reward
        </Button>
      )}
  </>
);

/**
 * Marks the lesson's own Claim button the way a page highlight marks its target:
 * the page dims behind the Activity dock, and the button gets the amber ring and
 * the hand. For claim steps with nothing to point at on the page, where the
 * lesson's button is the only place to claim.
 */
const ClaimHighlight: React.FC<{ active: boolean; children: React.ReactNode }> = ({
  active,
  children,
}) => {
  if (!active) return children;
  return (
    <div className="relative" data-tutorial-claim-highlight="">
      {createPortal(
        // Below the open lesson's dock (z-[61]); page controls stay reachable.
        <div
          data-battle-focus-layer
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 z-[60] bg-black/55"
        />,
        document.body,
      )}
      <span className="pointer-events-none absolute -inset-1.5 rounded-lg border-[3px] border-amber-400 shadow-[0_0_18px_rgba(245,158,11,0.8)]" />
      {children}
      <Image
        src={IMG_URL_HANDPOINTER}
        alt=""
        aria-hidden="true"
        className="pointer-events-none absolute -top-12 right-6 z-[1] h-12 w-12 rotate-180 animate-bounce drop-shadow-lg motion-reduce:animate-none"
        width={80}
        height={80}
      />
    </div>
  );
};

/**
 * Turns the tutorial off for the player who asked, and keeps the confirmation open with an
 * error when it fails. Answers that arrive after an account or step change are ignored.
 */
const useDisableTutorial = (
  userData: { userId: string; tutorialOn: boolean; tutorialStep: number } | undefined,
  updateUser: ReturnType<typeof useUserDataSelector>["updateUser"],
  tutorialIdentityRef: TutorialIdentityRef,
) => {
  // Mutation to disable tutorial
  const { mutateAsync: disableTutorial } = api.profile.updatePreferences.useMutation();
  const disableTutorialLockRef = React.useRef(false);
  const [isDisablingTutorial, setIsDisablingTutorial] = useState(false);
  const [disableTutorialError, setDisableTutorialError] = useState<string>();
  const [showCancelConfirmDialog, setShowCancelConfirmDialog] = useState(false);

  const handleDisableTutorial = async () => {
    if (disableTutorialLockRef.current) return;
    if (!userData?.userId || userData.tutorialOn !== true) return;

    const request = { userId: userData.userId, tutorialStep: userData.tutorialStep };
    disableTutorialLockRef.current = true;
    setDisableTutorialError(undefined);
    setIsDisablingTutorial(true);

    await disableTutorial({ tutorialOn: false })
      .then(async (result) => {
        const identity = tutorialIdentityRef.current;
        const isCurrentTutorial =
          identity.userId === request.userId &&
          identity.tutorialStep === request.tutorialStep;
        if (!isCurrentTutorial) return;
        if (!result.success) {
          setDisableTutorialError(result.message);
          return;
        }

        await updateUser((current) =>
          current.userId === request.userId ? { tutorialOn: false } : undefined,
        );
        if (tutorialIdentityRef.current.userId !== request.userId) {
          return;
        }
        setShowCancelConfirmDialog(false);
      })
      .catch(() => {
        const identity = tutorialIdentityRef.current;
        if (
          identity.userId === request.userId &&
          identity.tutorialStep === request.tutorialStep
        ) {
          setDisableTutorialError(
            "We couldn't turn off the tutorial. Your progress is unchanged; please try again.",
          );
        }
      })
      .finally(() => {
        disableTutorialLockRef.current = false;
        setIsDisablingTutorial(false);
      });
  };
  return {
    isDisablingTutorial,
    disableTutorialError,
    showCancelConfirmDialog,
    setShowCancelConfirmDialog,
    handleDisableTutorial,
  };
};

/**
 * Measures the current step's highlight and keeps it placed: scrolled into view clear of
 * the lesson, or with the lesson moved aside when scrolling cannot uncover it. The main
 * tutorial and guided lessons share it; `find` locates a step's target on the page.
 */
const useHighlightPlacement = <Step extends { id: string }>({
  step,
  enabled,
  find,
  revealOnly,
  pathname,
}: {
  step: Step | null | undefined;
  /** Off while the lesson is hidden or on another page: the last placement is kept. */
  enabled: boolean;
  find: (step: Step) => HighlightTarget | null;
  /**
   * Scroll a target only as far as needed to uncover it, rather than to the middle of
   * the screen, for scenes (a fight, a card table) that must stay in view around it.
   */
  revealOnly: boolean;
  pathname: string;
}) => {
  const [highlight, setHighlight] = useState<{
    stepId: string;
    isPrimaryElement: boolean;
    top: number;
    left: number;
    width: number;
    height: number;
  } | null>(null);
  // Placement of the current highlight, keyed by step and element. One owner
  // decides where a highlight belongs, so scrolling never fights itself.
  const placementRef = React.useRef<{
    key: string;
    attempts: number;
    settled: boolean;
    /** Page scroll when the placement latched, to tell layout shifts from the player. */
    settledScrollY: number;
  }>({ key: "", attempts: 0, settled: false, settledScrollY: 0 });
  // Set while the panel would otherwise be sitting on top of the highlight, so
  // it can step aside. Latched per target: recomputing it from the moved panel
  // would say "no longer covered" and send it straight back.
  const [panelDodgesHighlight, setPanelDodgesHighlight] = useState(false);

  // Helper function to update the highlight position
  const updateHighlightPosition = (currentStepConfig: Step) => {
    const highlightInfo = find(currentStepConfig);

    if (highlightInfo) {
      // Put the highlight where the player can actually see and press it. Three
      // things can be wrong with where it is: off screen, underneath the fixed
      // assistant panel, or just awkwardly far from where the eye expects it.
      // All three are the same correction, so one pass owns the scrolling.
      //
      // It keeps correcting until the placement is good rather than firing once:
      // a page still fetching its data lays out short, and content landing
      // underneath the target afterwards would otherwise strand it. Once the
      // placement is good it latches, so a player who then scrolls the highlight
      // away is never fought. The attempt cap stops a target that can never be
      // placed well from scrolling on every tick.
      const targetKey = `${currentStepConfig.id}:${highlightInfo.element.id}`;
      if (placementRef.current.key !== targetKey) {
        placementRef.current = {
          key: targetKey,
          attempts: 0,
          settled: false,
          settledScrollY: 0,
        };
        setPanelDodgesHighlight(false);
      }
      const placement = placementRef.current;
      const isCombat = pathname === "/combat";
      // A fight is placed once its field has laid out, since the dock's width and the
      // scroll both follow it.
      const isFieldPending = isCombat && !fitActivityDockBesideField();
      const before = highlightInfo.element.getBoundingClientRect();
      // In a fight the action tiles under the field have to stay in view and clear of
      // the panel together with the target.
      const clear = isCombat ? withCombatActions(before) : before;
      const panel = getAssistantPanelRect();
      // In a fight the AP bar must stay in view with the target.
      const timerTop = isCombat
        ? document
            .getElementById("tutorial-combat-action-timer")
            ?.getBoundingClientRect().top
        : undefined;
      const isTimerAbove = timerTop !== undefined && timerTop < 0;
      // Content that renders after the latch (a fight's jutsu row, say) can push a
      // placed target under the panel, its action tiles below the screen, or the AP bar
      // off the top, without the player scrolling; place it again. A page that shrank
      // below the latched position pulls the scroll up to its new bottom, which is not
      // the player scrolling either.
      const isScrollClamped =
        window.scrollY < placement.settledScrollY &&
        window.scrollY + window.innerHeight >=
          document.documentElement.scrollHeight - 1;
      if (
        placement.settled &&
        (window.scrollY === placement.settledScrollY || isScrollClamped) &&
        ((panel && rectsOverlap(clear, panel)) ||
          isTimerAbove ||
          (isCombat && clear.bottom > window.innerHeight))
      ) {
        placement.settled = false;
      }
      if (
        !placement.settled &&
        placement.attempts < 5 &&
        !isFieldPending &&
        // A fight's offset is capped by its AP bar, so even a field taller than the
        // screen is placed there.
        (isCombat ||
          canPositionTutorialHighlight(before.height, window.innerHeight, panel?.top))
      ) {
        const preferredCentre = getPreferredHighlightCentre(before.height);
        const centre = before.top + before.height / 2;
        const isOffscreen =
          before.bottom < 80 ||
          before.top > window.innerHeight - 80 ||
          before.right < 0 ||
          before.left > window.innerWidth;
        const isCovered = !!panel && rectsOverlap(clear, panel);
        // A scene revealed only (a fight, a card table) must stay in view around the
        // target, so there a visible, uncovered target is left where it is, unless in a
        // fight the action bar runs off the bottom or the AP bar has gone above the screen.
        const isCutOff = isCombat && clear.bottom > window.innerHeight;
        const isMisplaced =
          isOffscreen ||
          isCovered ||
          isCutOff ||
          isTimerAbove ||
          (!revealOnly && Math.abs(centre - preferredCentre) > 100);
        if (!isMisplaced) {
          placement.settled = true;
          placement.settledScrollY = window.scrollY;
        } else {
          placement.attempts += 1;
          const scroller = highlightInfo.element.ownerDocument.scrollingElement;
          // There a target only moves far enough to come into view clear of the
          // panel, so as much of the scene as possible stays visible with it, and in a
          // fight never so far that the AP bar leaves the top of the screen.
          const floor =
            panel && clear.left < panel.right && clear.right > panel.left
              ? Math.min(panel.top, window.innerHeight)
              : window.innerHeight;
          const revealOffset =
            !isOffscreen && !isCovered && !isCutOff
              ? 0
              : clear.bottom + 16 > floor
                ? clear.bottom + 16 - floor
                : clear.top - 80;
          const offset = !revealOnly
            ? centre - preferredCentre
            : Math.min(
                revealOffset,
                timerTop === undefined ? revealOffset : timerTop - 16,
              );
          scroller?.scrollBy({ top: offset, behavior: "auto" });
          // Scrolling cannot always win: on a short page the document may already
          // be as far down as it goes, leaving the target stuck under the panel
          // with nothing left to scroll. Rather than stretch the page to make
          // room, the panel gives way -- a step whose only advance action is
          // pressing the highlight has to be pressable. It only moves when the
          // target is clear of where it lands, or it would cover it from above.
          if (isCovered) {
            const after = highlightInfo.element.getBoundingClientRect();
            const panelAfter = getAssistantPanelRect();
            if (
              panelAfter &&
              rectsOverlap(after, panelAfter) &&
              after.top >
                DODGED_PANEL_TOP_REM *
                  Number.parseFloat(
                    getComputedStyle(document.documentElement).fontSize,
                  ) +
                  panelAfter.height
            ) {
              setPanelDodgesHighlight(true);
            }
          }
        }
      }
      const rect = highlightInfo.element.getBoundingClientRect();
      const next = {
        stepId: currentStepConfig.id,
        isPrimaryElement: highlightInfo.isPrimaryElement,
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      };
      setHighlight((prev) =>
        prev &&
        prev.stepId === next.stepId &&
        prev.isPrimaryElement === next.isPrimaryElement &&
        isSameBox(prev, next)
          ? prev
          : next,
      );
      return highlightInfo.element;
    }
    // Coached turns and rematches point at nothing, yet the dock still keeps beside the field.
    if (pathname === "/combat") fitActivityDockBesideField();
    setHighlight(null);
    setPanelDodgesHighlight(false);
    return null;
  };

  // Update highlight position based on current step and element
  useEffect(() => {
    if (!enabled) return;
    // Guard against undefined step
    if (!step) {
      setHighlight(null);
      return;
    }
    const stopTracking = trackLayout(() => updateHighlightPosition(step));
    return () => {
      stopTracking();
      document.documentElement.style.removeProperty(ACTIVITY_DOCK_WIDTH_PROPERTY);
    };
  }, [step, enabled, pathname, revealOnly]);

  return { highlight, panelDodgesHighlight };
};

/**
 * The active quest to guide once the tutorial is over, by the player's quest type priority.
 * It is shown only while that quest's logbook entry is not already on the page.
 */
const usePostTutorialQuest = (
  userData:
    | Pick<NonNullable<UserWithRelations>, "tutorialOn" | "userQuests" | "questData">
    | undefined,
  stepNumber: number,
  preferredQuestIds: readonly string[] = [],
) => {
  // Post tutorial state - quest data from userData
  const [postTutorialQuest, setPostTutorialQuest] = useState<PostTutorialQuest | null>(
    null,
  );

  // Post tutorial state - whether to show the quest
  const [showPostTutorialQuest, setShowPostTutorialQuest] = useState(false);

  // Quest type priority ordering (persisted in localStorage)
  const [questTypePriority, setQuestTypePriority] = useLocalStorage<QuestType[]>(
    "tutorial-quest-type-priority",
    [...OrderedQuestTypesInTutorial],
  );

  // Post-tutorial quest guidance: Find quest based on priority ordering
  useEffect(() => {
    if (userData?.tutorialOn !== false && stepNumber >= TUTORIAL_STEPS.length) {
      // Find the first quest based on priority ordering
      const activeUserQuests = userData?.userQuests?.filter(
        (uq) => OrderedQuestTypesInTutorial.includes(uq.quest.questType) && !uq.endAt,
      );

      if (activeUserQuests && activeUserQuests.length > 0) {
        // Sort by priority order (lower index = higher priority)
        const sortedQuests = [...activeUserQuests].sort((a, b) => {
          // Story chapters and Leads come first, in story order.
          const aStory = preferredQuestIds.indexOf(a.questId);
          const bStory = preferredQuestIds.indexOf(b.questId);
          if (aStory !== bStory) {
            if (aStory === -1) return 1;
            if (bStory === -1) return -1;
            return aStory - bStory;
          }
          const aPriority = questTypePriority.indexOf(a.quest.questType);
          const bPriority = questTypePriority.indexOf(b.quest.questType);
          // If not found in priority list, put at end
          const aIdx = aPriority === -1 ? questTypePriority.length : aPriority;
          const bIdx = bPriority === -1 ? questTypePriority.length : bPriority;
          return aIdx - bIdx;
        });

        const quest = sortedQuests[0];
        const tracker = quest
          ? userData?.questData?.find((q) => q.id === quest.questId)
          : undefined;
        setPostTutorialQuest(quest && tracker ? { userQuest: quest, tracker } : null);
      } else {
        setPostTutorialQuest(null);
      }
    } else {
      setPostTutorialQuest(null);
    }
  }, [userData, stepNumber, questTypePriority, preferredQuestIds.join(",")]);

  // Check if logbook entry exists on the page to determine whether to show the quest
  useEffect(() => {
    if (!postTutorialQuest) {
      setShowPostTutorialQuest(false);
      return;
    }

    const checkLogbookEntry = () => {
      const logbookEntryExists = document.getElementById(
        `logbook-entry-${postTutorialQuest.userQuest.questId}`,
      );
      setShowPostTutorialQuest(!logbookEntryExists);
    };

    checkLogbookEntry();
    const interval = setInterval(checkLogbookEntry, 1000);
    return () => clearInterval(interval);
  }, [postTutorialQuest]);

  return {
    postTutorialQuest,
    showPostTutorialQuest,
    questTypePriority,
    setQuestTypePriority,
  };
};

/**
 * Navigates now and once more after a delay. A page rewriting its own URL while
 * it mounts (the profile's tab query) can cancel a navigation already under way;
 * the returned cleanup drops the retry once the effect re-runs on the new page.
 */
const navigateWithRetry = (navigate: () => void) => {
  navigate();
  const retry = setTimeout(navigate, REDIRECT_RETRY_MS);
  return () => clearTimeout(retry);
};

/** Include the Activity header when keeping highlighted controls clear of the dock. */
const getAssistantPanelRect = (): DOMRect | null => {
  const panel = document.getElementById(TUTORIAL_ASSISTANT_PANEL_ID);
  return (
    (panel?.closest("[data-activity-dock]") ?? panel)?.getBoundingClientRect() ?? null
  );
};

/**
 * In a fight the dock keeps to the space beside the battlefield, where it covers neither
 * the field nor the action tiles under it. Where that space is too narrow for the dock
 * (phones), it keeps its width and the placement scrolls the controls clear of it instead.
 * Measured from the dock's fixed right edge, so narrowing it never changes the answer.
 * Returns false while the field has not laid out yet.
 */
const fitActivityDockBesideField = () => {
  const field = document
    .getElementById("tutorial-combat-field")
    ?.getBoundingClientRect();
  const dock = document
    .getElementById(TUTORIAL_ASSISTANT_PANEL_ID)
    ?.closest("[data-activity-dock]")
    ?.getBoundingClientRect();
  if (!field || !dock || !isUsableHighlightRect(field)) return false;
  const room = dock.right - field.right - ACTIVITY_DOCK_FIELD_GAP_PX;
  const root = document.documentElement;
  if (room >= ACTIVITY_DOCK_MIN_WIDTH_PX && room < ACTIVITY_DOCK_FULL_WIDTH_PX) {
    root.style.setProperty(ACTIVITY_DOCK_WIDTH_PROPERTY, `${Math.floor(room)}px`);
  } else {
    root.style.removeProperty(ACTIVITY_DOCK_WIDTH_PROPERTY);
  }
  return true;
};

/** The target together with a fight's action tiles, which must stay in view with it. */
const withCombatActions = (target: DOMRect): ScreenEdges =>
  [...document.querySelectorAll('[id^="tutorial-combat-action-"]')]
    .filter((tile) => tile.id !== "tutorial-combat-action-timer")
    .map((tile) => tile.getBoundingClientRect())
    .filter(isUsableHighlightRect)
    .reduce<ScreenEdges>(
      (union, tile) => ({
        top: Math.min(union.top, tile.top),
        left: Math.min(union.left, tile.left),
        right: Math.max(union.right, tile.right),
        bottom: Math.max(union.bottom, tile.bottom),
      }),
      target,
    );

const rectsOverlap = (a: ScreenEdges, b: ScreenEdges) =>
  !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);

/**
 * Where a highlight of this height should end up vertically. The window's own
 * middle is not safe: the assistant panel is fixed over the foot of the screen,
 * so on a short viewport the middle is underneath it.
 */
const getPreferredHighlightCentre = (targetHeight: number) => {
  const safeTop = 80;
  const panel = getAssistantPanelRect();
  const safeBottom =
    panel && panel.top > safeTop + targetHeight ? panel.top : window.innerHeight;
  return (safeTop + safeBottom) / 2;
};

/**
 * The boxes of the elements a guided step refers to (`step.marks`): every visible match
 * outside inert or modal-hidden content except the ringed target, kept placed as the
 * page moves.
 */
const useGuidedMarks = (step: GuidedLessonStep): SpotlightMark[] => {
  const [marks, setMarks] = useState<SpotlightMark[]>([]);
  // Scenes re-register their step on every render; the marks' content keys the tracking.
  const wantedKey = JSON.stringify(step.marks ?? []);
  const { target } = step;
  useEffect(() => {
    const wanted = JSON.parse(wantedKey) as GuidedLessonMark[];
    if (wanted.length === 0) {
      setMarks([]);
      return;
    }
    return trackLayout(() => {
      const ringed = target ? (findGuidedTarget(target)?.element ?? null) : null;
      const next: SpotlightMark[] = [];
      let first: HTMLElement | null = null;
      for (const mark of wanted) {
        for (const element of document.querySelectorAll<HTMLElement>(mark.selector)) {
          // Content a modal dialog hides (aria-hidden) stays unmarked under it.
          if (element === ringed || element.closest('[inert], [aria-hidden="true"]'))
            continue;
          const rect = element.getBoundingClientRect();
          if (!isUsableHighlightRect(rect)) continue;
          if (!first) first = element;
          next.push({
            key: `${mark.selector}#${next.length}`,
            label: mark.label,
            box: {
              top: rect.top,
              left: rect.left,
              width: rect.width,
              height: rect.height,
            },
          });
        }
      }
      setMarks((prev) =>
        prev.length === next.length &&
        prev.every((mark, index) => {
          const other = next[index];
          return other?.key === mark.key && isSameBox(mark.box, other.box);
        })
          ? prev
          : next,
      );
      return first;
    });
  }, [wantedKey, target]);
  return marks;
};

/** A guided step's target: the first visible match outside inert content. */
const findGuidedTarget = (selector: string): HighlightTarget | null => {
  for (const element of document.querySelectorAll<HTMLElement>(selector)) {
    if (element.closest("[inert]")) continue;
    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") continue;
    if (isUsableHighlightRect(element.getBoundingClientRect())) {
      return { element, isPrimaryElement: true };
    }
  }
  return null;
};

/**
 * The element a main-tutorial step highlights, with its box: the first usable of its ids,
 * or a match in the open game menu for a step that needs it. `isPrimaryElement` tells
 * whether it is the step's first id.
 */
const findElementToHighlight = (
  step: TutorialStepConfig,
  rightSideBarRef: React.RefObject<HTMLDivElement | null>,
  rightSideBarOpen: boolean,
) => {
  if (!step?.elementIds || step.elementIds.length === 0) return null;

  let element: HTMLElement | null =
    step.elementIds?.map((id) => getUsableHighlightElement(id)).find(Boolean) || null;
  const primaryElement = getUsableHighlightElement(step.elementIds?.[0]);
  const isPrimaryElement = Boolean(
    element && primaryElement && element === primaryElement,
  );

  // Check within the rightSideBarRef if available and open
  const sidebarElement = rightSideBarRef.current;
  if (
    sidebarElement &&
    rightSideBarOpen &&
    step.requiresGameMenu &&
    Array.isArray(step.elementIds)
  ) {
    // Try exact match first, then partial match if needed
    const foundElement =
      step.elementIds
        ?.map((id) => id && sidebarElement.querySelector<HTMLElement>(`#${id}`))
        .find((el) => el && isUsableHighlightRect(el.getBoundingClientRect())) ||
      Array.from(sidebarElement.querySelectorAll<HTMLElement>("[id]")).find(
        (el) =>
          isUsableHighlightRect(el.getBoundingClientRect()) &&
          step.elementIds?.some(
            (id) => id && el.id?.includes(id.replace("tutorial-", "")),
          ),
      );

    if (foundElement) {
      element = foundElement;
    }
  }

  if (!element) return null;

  const rect = element.getBoundingClientRect();
  if (!isUsableHighlightRect(rect)) {
    return null;
  }

  // Return the element reference along with its dimensions
  return {
    element,
    isPrimaryElement,
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  };
};

/** Subscribe to account identity without observing unrelated profile fields. */
const selectUserId = (user: { userId: string }) => ({ userId: user.userId });

/**
 * Tutorial assistant component props
 * @param rightSideBarOpen - Whether the right side bar is open
 * @param setRightSideBarOpen - Function to set the right side bar open
 * @param rightSideBarRef - Reference to the right side bar
 * @returns
 */
interface TutorialAssistantProps {
  /** Width below which the menu uses a drawer; null keeps it in a drawer at every width. */
  sidebarBreakpoint: number | null;
  rightSideBarOpen: boolean;
  setRightSideBarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  rightSideBarRef: React.RefObject<HTMLDivElement | null>;
}

/** The account and step the assistant is showing, read when a disable request settles. */
type TutorialIdentityRef = React.RefObject<{
  userId: string | undefined;
  tutorialStep: number | undefined;
}>;

/** The element a step points at; a fallback target is not the step's primary one. */
type HighlightTarget = { element: HTMLElement; isPrimaryElement: boolean };

/** A quest the assistant guides after the tutorial, with its live tracker. */
type PostTutorialQuest = { userQuest: UserQuest; tracker: QuestTrackerType };

/** The edges of a box on screen, in viewport pixels. */
type ScreenEdges = Pick<DOMRect, "top" | "left" | "right" | "bottom">;

/** Story cards that take the dock even while a quest is on show there. */
const STORY_CARD_OVERRIDES = [
  "story-level-up",
  "story-assign-xp",
  "story-ready-",
  "story-exam",
  "story-recap",
];

/** Where Express Trials pick the tutorial up: reaching the level the Genin exam asks for. */
const EXPRESS_TRIALS_EXAM_STEP = TUTORIAL_STEPS.findIndex(
  (step) => step.id === "genin-level-up",
);
