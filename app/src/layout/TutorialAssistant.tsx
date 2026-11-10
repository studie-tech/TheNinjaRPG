"use client";

import {
  ArrowRight,
  Gift,
  Loader2,
  MapPin,
  MousePointerClick,
  Settings2,
  Sparkles,
  X,
} from "lucide-react";
import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "@/app/_trpc/client";
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
  IMG_URL_HANDPOINTER,
  OrderedQuestTypesInTutorial,
  TUTORIAL_STEPS_COUNT,
} from "@/drizzle/constants";
import type { UserQuest } from "@/drizzle/schema";
import { useLocalStorage } from "@/hooks/localstorage";
import { useNavigationRouter as useRouter } from "@/hooks/navigation";
import { useTutorialStep } from "@/hooks/tutorial";
import { useAbVariant } from "@/hooks/useAbVariant";
import { useActivityDock } from "@/hooks/useActivityDock";
import { ActivityDock } from "@/layout/ActivityDock";
import { SETTINGS_HREF } from "@/layout/GameSettings";
import Image from "@/layout/Image";
import Link from "@/layout/Link";
import { QuestObjectives, useCheckRewards } from "@/layout/Logbook";
import {
  getLemuImage,
  LEMU_EXPERIMENT,
  LEMU_PORTRAIT_WAIST,
} from "@/libs/lemuExperiment";
import { isBrowserAuthPath } from "@/libs/native/deepLink";
import {
  dialogChoiceContentId,
  getActiveObjective,
  isQuestComplete,
} from "@/libs/objectives";
import { cn } from "@/libs/shadui";
import {
  canPositionTutorialHighlight,
  getTutorialCatchUpStepIndex,
  getTutorialChapterProgress,
  getTutorialPortraitSide,
  getTutorialRewindStepIndex,
  getTutorialStrandedBattleStepId,
  hasOutgrownTutorial,
  isTutorialActive,
  isTutorialJutsuPickStep,
  isTutorialPageMatch,
  isUsableHighlightRect,
  type TutorialPortraitSide,
  type TutorialScreenBox,
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

/** Seconds a step without a Next button stays up before a "skip" escape appears. */
const STUCK_STEP_SECONDS = 60;

/**
 * Grace before a combat lesson without a running fight is moved on, so the
 * navigation to a battle that just started can land on /combat first.
 */
const STRANDED_BATTLE_STEP_MS = 1500;

/** Gap between Lemu and the end of the dock she stands at. */
const PORTRAIT_INSET_PX = 16;

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
  // Account-scoped presentation resets when the player changes; progress stays in the profile.
  if (!userData || isBrowserAuthPath(pathname)) return null;
  return (
    <ActivityDock key={userData.userId} hiddenLesson={<TutorialCompletionSync />}>
      <PlayerTutorialAssistant {...props} tutorialIdentityRef={tutorialIdentityRef} />
    </ActivityDock>
  );
};

export default TutorialAssistant;

/**
 * Finishes the tutorial of a player who graduated with the lesson collapsed, on
 * the Quests tab or behind chat. The assistant only runs while the lesson is on
 * screen, so without this they stay in the tutorial's restricted interface.
 */
const TutorialCompletionSync: React.FC = () => {
  const { data: userData, updateUser } = useUserDataSelector((user) => ({
    tutorialOn: user.tutorialOn,
    tutorialStep: user.tutorialStep,
    rank: user.rank,
    userQuests: user.userQuests,
  }));
  const { mutate: finishTutorial } = api.profile.updateTutorialStep.useMutation({
    onSuccess: async (data) => {
      if (data.success && data.userPatch?.tutorialStep !== undefined) {
        await updateUser({ tutorialStep: data.userPatch.tutorialStep });
      }
    },
  });
  const isOutgrown = hasOutgrownTutorial(userData);
  const requestedRef = React.useRef(false);
  useEffect(() => {
    if (!isOutgrown || requestedRef.current) return;
    requestedRef.current = true;
    finishTutorial({ step: TUTORIAL_STEPS_COUNT });
  }, [isOutgrown, finishTutorial]);
  return null;
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
    sector: user.sector,
    earnedExperience: user.earnedExperience,
    curStamina: user.curStamina,
    maxStamina: user.maxStamina,
    curChakra: user.curChakra,
    maxChakra: user.maxChakra,
    petAcquisitions: user.petAcquisitions,
    userQuests: user.userQuests,
    questData: user.questData,
  }));
  const pathname = usePublicPathname();
  const router = useRouter();

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
  const [isMobile, setIsMobile] = useState<boolean>(
    typeof window !== "undefined" ? window.innerWidth < sidebarBreakpoint : false,
  );

  // Handle window resize to update isMobile state
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < sidebarBreakpoint);
    };

    window.addEventListener("resize", handleResize);
    handleResize();
    return () => window.removeEventListener("resize", handleResize);
  }, [sidebarBreakpoint]);

  // State to track if we should show the special game menu tutorial
  const [showGameMenuTutorial, setShowGameMenuTutorial] = useState<boolean>(false);

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

  // Rewards check hook for dialog options
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

      // Show the menu prompt when on mobile, the drawer is closed, and the step
      // points at something inside the game menu
      const shouldShowGameMenuTutorial =
        isMobile &&
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
        currentStepConfig?.requiresGameMenu && isMobile ? rightSideBarOpen : true;
      setIsAssistantVisible(isActiveStep && onCorrectPage && hasRequiredGameMenu);

      // If we're at a valid step but not on the correct page, redirect
      if (isActiveStep && !onCorrectPage && currentStepConfig) {
        if (!currentStepConfig?.requiresGameMenu) {
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
  }, [userData, currentStep, pathname, router, rightSideBarOpen, isMobile]);

  // Skip steps that have nothing to do: spending experience the player does
  // not have, adopting a companion when they already formed a bond, or
  // travelling somewhere the player already is.
  useEffect(() => {
    if (userData?.tutorialOn !== true || !currentStep) return;
    const nothingToAssign =
      currentStep.needsUnassignedExperience && userData.earnedExperience === 0;
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
    if (nothingToAssign || alreadyBonded || alreadyThere) void handleNextStepAsync();
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

  const { highlight, panelDodgesHighlight } = useHighlightPlacement({
    currentStep,
    isAssistantVisible,
    pathname,
    userData,
    rightSideBarRef,
    rightSideBarOpen,
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
      const rect =
        getUsableHighlightElement("tutorial-gameBtn")?.getBoundingClientRect();
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

  // Dialog state for quest type ordering
  const [showOrderingDialog, setShowOrderingDialog] = useState(false);

  const {
    postTutorialQuest,
    showPostTutorialQuest,
    questTypePriority,
    setQuestTypePriority,
  } = usePostTutorialQuest(userData, stepNumber);

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
              "The Bondkeepers bless your new bond. Your companion's portrait takes a few minutes to paint, so let's look at how to care for it while it finishes.",
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
  // Placement-bound choices belong to the NPC's dialog on the map.
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
    if (
      !currentTutorialStep?.autoTravelLabel ||
      !activeRelatedObjective ||
      !relatedQuest
    )
      return;
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

  const openDisableModal = () => {
    if (stepNumber >= TUTORIAL_STEPS_COUNT) {
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
          {createPortal(
            <div
              data-battle-focus-layer
              className="pointer-events-none fixed inset-0 z-[60]"
            >
              <HighlightDim box={gameMenuHighlight} />
              <div
                className="absolute rounded-lg"
                style={highlightHoleStyle(gameMenuHighlight)}
              >
                <span className="absolute inset-0 animate-ping rounded-lg border-2 border-amber-300/70 motion-reduce:animate-none" />
                <div className="absolute inset-0 z-[1] rounded-lg border-[3px] border-amber-400 shadow-[0_0_18px_rgba(245,158,11,0.8)]">
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
                </div>
              </div>
              <HandPointer box={gameMenuHighlight} />
            </div>,
            document.body,
          )}
          <AssistantDialog
            title={currentStep?.title ?? "Game menu"}
            eyebrow={chapterEyebrow}
            progress={chapterProgress}
            stepId={`menu-${currentStep?.id}`}
            action="Tap the highlighted menu button."
            avoidBox={gameMenuHighlight}
            isBusy={isDisablingTutorial}
            errorMessage={disableTutorialError}
            onOpenDisableModal={openDisableModal}
            lead={
              <p className="text-base leading-relaxed">
                On phones, the location and main menus live in the game menu.
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

  if ((!isAssistantVisible && !showPostTutorialQuest) || !currentTutorialStep) {
    return (
      <div className="space-y-2 p-4 text-sm text-muted-foreground">
        <p>
          {isTutorialActive(userData)
            ? "There is no tutorial guidance on this page."
            : "Tutorial complete. Quest guidance will appear here when available."}
        </p>
        <Link
          className="text-primary underline"
          href={`${SETTINGS_HREF}&settings=help&setting=tutorial`}
        >
          Open tutorial settings
        </Link>
      </div>
    );
  }

  const isQuestOverlay = !!dynamicQuestStep;
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

  // Render the tutorial overlay with highlight and assistant panel
  return (
    <>
      {highlight &&
        highlight.stepId === currentTutorialStep.id &&
        !showCancelConfirmDialog &&
        createPortal(
          // Only the highlighted control captures clicks; game controls stay reachable.
          <div
            data-battle-focus-layer
            className="pointer-events-none fixed inset-0 z-[60]"
          >
            <HighlightDim box={highlight} />
            <div
              className={cn("absolute rounded-lg bg-transparent", pointerEvents)}
              style={highlightHoleStyle(highlight)}
            >
              {showPointer && (
                <span className="pointer-events-none absolute inset-0 animate-ping rounded-lg border-2 border-amber-300/70 motion-reduce:animate-none" />
              )}
              <div className="absolute inset-0 z-[1] rounded-lg border-[3px] border-amber-400 shadow-[0_0_18px_rgba(245,158,11,0.8)]">
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
              </div>
            </div>
            {showPointer && <HandPointer box={highlight} />}
          </div>,
          document.body,
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
          characterImage={characterImage}
          dodgeHighlight={panelDodgesHighlight}
          avoidBox={highlight?.stepId === currentTutorialStep.id ? highlight : null}
          onOpenOrderingDialog={() => setShowOrderingDialog(true)}
          showOrderingButton={showPostTutorialQuest}
          footer={
            <>
              {autoTravelHref && currentTutorialStep.autoTravelLabel && (
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
              )}
              {dialogOptions && (
                <div>
                  <h3 className="mb-2 flex items-center font-semibold text-base">
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
              {claimable && (
                <div className="rounded-lg border bg-muted/40 p-3">
                  {claimable.isReady ? (
                    <Button
                      size="lg"
                      decoration="gold"
                      // Without a logbook entry on the page, this is the only place to claim.
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
                  ) : (
                    <p className="text-base text-muted-foreground">
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
              <p className="text-base leading-relaxed">
                {parseHtml(currentTutorialStep.description)}
              </p>
            ) : (
              <div className="text-base leading-relaxed">
                {currentTutorialStep.description}
              </div>
            )
          }
        >
          {currentTutorialStep.quoteObjective &&
            activeRelatedObjective?.description && (
              <blockquote className="border-primary border-l-4 bg-muted/40 py-2 pr-3 pl-3 text-base italic leading-relaxed">
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
 * Lemu standing on the dock's top edge, cropped at the waist independently of
 * lesson height. She is decorative and lets clicks through, but moves to the
 * other end of the dock, or leaves, rather than stand over the highlight.
 */
const AssistantPortrait: React.FC<{
  characterImage?: string;
  avoidBox: TutorialScreenBox | null;
  dodgeHighlight?: boolean;
}> = ({ characterImage, avoidBox, dodgeHighlight }) => {
  const { variant } = useAbVariant(LEMU_EXPERIMENT);
  const { swapSides } = useActivityDock();
  const image = characterImage || getLemuImage(variant);
  const waist = LEMU_PORTRAIT_WAIST[image] ?? 0.5;
  const stripRef = React.useRef<HTMLDivElement>(null);
  const [side, setSide] = useState<TutorialPortraitSide | null>("right");
  // Measured after layout so she never paints where she is about to leave. The
  // dock moves when it dodges to the top or swaps sides, which the effect re-runs for.
  React.useLayoutEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const place = () => {
      setSide(
        getTutorialPortraitSide({
          frame: strip.getBoundingClientRect(),
          portraitWidth: strip.querySelector("img")?.getBoundingClientRect().width ?? 0,
          inset: PORTRAIT_INSET_PX,
          avoid: avoidBox,
        }),
      );
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(strip);
    window.addEventListener("resize", place);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [avoidBox, dodgeHighlight, swapSides]);
  // A dodging dock sits just below the top bar, with no room above it for her.
  if (dodgeHighlight) return null;
  return (
    <div
      ref={stripRef}
      className="pointer-events-none absolute inset-x-0 bottom-full overflow-hidden"
      style={{ height: `calc(var(--assistant-portrait-height) * ${waist})` }}
    >
      <Image
        src={image}
        width={512}
        height={768}
        alt=""
        aria-hidden="true"
        className={cn(
          "h-[var(--assistant-portrait-height)] w-auto max-w-[60%] select-none object-contain drop-shadow-2xl",
          // She faces the middle of the dock from whichever end she stands at.
          side === "left" ? "mr-auto ml-4" : "mr-4 ml-auto scale-x-[-1]",
          !side && "invisible",
        )}
      />
    </div>
  );
};

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
  characterImage?: string;
  onOpenOrderingDialog?: () => void;
  showOrderingButton?: boolean;
  /** Anchor to the top instead, to uncover a highlight it would otherwise sit on. */
  dodgeHighlight?: boolean;
  /** The highlighted element, which Lemu's portrait must not stand over. */
  avoidBox?: TutorialScreenBox | null;
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
  characterImage,
  onOpenOrderingDialog,
  showOrderingButton,
  dodgeHighlight,
  avoidBox = null,
  isBusy = false,
  errorMessage,
}) => {
  const sectionRef = React.useRef<HTMLElement>(null);
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
      <AssistantPortrait
        characterImage={characterImage}
        avoidBox={avoidBox}
        dodgeHighlight={dodgeHighlight}
      />
      <div className="relative z-10 rounded-b-xl bg-card" aria-busy={isBusy}>
        <header className="flex items-start gap-2 px-4 pt-3 md:px-5">
          <div className="min-w-0 flex-1">
            {eyebrow && (
              <p className="truncate font-semibold text-muted-foreground text-xs uppercase tracking-wider">
                {eyebrow}
              </p>
            )}
            <h2 className="font-bold text-lg text-primary leading-tight">{title}</h2>
          </div>
          {onOpenDisableModal && (
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onOpenDisableModal();
              }}
              disabled={isBusy}
              className="-mr-2 h-8 w-8 shrink-0 opacity-60 hover:opacity-100"
              title={isBusy ? "Disabling" : "Skip tutorial"}
              aria-label={isBusy ? "Disabling" : "Skip tutorial"}
            >
              {isBusy ? (
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
              ) : (
                <X className="h-5 w-5" aria-hidden="true" />
              )}
            </Button>
          )}
        </header>
        {progress && (
          <div
            className="flex gap-1 px-4 pt-2 md:px-5"
            role="progressbar"
            aria-label="Chapter progress"
            aria-valuemin={1}
            aria-valuemax={progress.total}
            aria-valuenow={progress.position}
          >
            {Array.from({ length: progress.total }, (_, i) => (
              <span
                key={i}
                className={cn(
                  "h-1.5 flex-1 rounded-full",
                  i < progress.position ? "bg-primary" : "bg-primary/20",
                )}
              />
            ))}
          </div>
        )}
        <div className="max-h-[min(40dvh,420px,calc(100dvh-var(--assistant-portrait-height)-22rem))] space-y-3 overflow-y-auto overscroll-contain px-4 py-3 md:px-5">
          {isBusy && (
            <div
              role="status"
              aria-live="polite"
              className="flex items-center gap-2 font-medium text-base text-muted-foreground"
            >
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Disabling
            </div>
          )}
          {errorMessage && !isBusy && (
            <p role="alert" className="text-base text-destructive">
              {errorMessage}
            </p>
          )}
          <fieldset disabled={isBusy} className="contents">
            {lead}
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
          </fieldset>
        </div>
        {(action || footer) && (
          <fieldset
            disabled={isBusy}
            className="space-y-3 rounded-b-xl border-border border-t bg-card px-4 py-3 md:px-5"
          >
            {action && (
              <p className="flex items-start gap-2 rounded-lg border border-amber-500/70 bg-amber-500/15 px-3 py-2 font-semibold text-base">
                <MousePointerClick
                  className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400"
                  aria-hidden="true"
                />
                <span>{action}</span>
              </p>
            )}
            {footer}
          </fieldset>
        )}
      </div>
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
  const { variant } = useAbVariant(LEMU_EXPERIMENT);
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
            src={getLemuImage(variant)}
            width={256}
            height={384}
            alt=""
            aria-hidden="true"
            className="pointer-events-none h-40 w-auto shrink-0 select-none self-end object-contain drop-shadow-lg max-sm:hidden"
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
 * Dims the page around a highlight. A mask cut-out rather than a huge
 * box-shadow spread: Chrome stops painting shadows that large on a
 * transformed layer, which left the page undimmed.
 */
const HighlightDim: React.FC<{
  box: { top: number; left: number; width: number; height: number };
}> = ({ box }) => {
  const maskId = React.useId();
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      aria-hidden="true"
    >
      <defs>
        <mask id={maskId}>
          <rect width="100%" height="100%" fill="white" />
          <rect
            x={box.left - 8}
            y={box.top - 8}
            width={box.width + 16}
            height={box.height + 16}
            rx={8}
            fill="black"
          />
        </mask>
      </defs>
      <rect
        width="100%"
        height="100%"
        fill="black"
        fillOpacity={0.55}
        mask={`url(#${maskId})`}
      />
    </svg>
  );
};

/** Bouncing hand under a highlight, kept inside the viewport. */
const HandPointer: React.FC<{
  box: { top: number; left: number; width: number; height: number };
}> = ({ box }) => {
  const below = box.top + box.height + 64 < window.innerHeight;
  return (
    <Image
      src={IMG_URL_HANDPOINTER}
      alt=""
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute h-14 w-14 animate-bounce drop-shadow-lg motion-reduce:animate-none",
        !below && "rotate-180",
      )}
      width={80}
      height={80}
      style={{
        top: below ? box.top + box.height + 8 : Math.max(0, box.top - 64),
        left: Math.max(
          4,
          Math.min(window.innerWidth - 60, box.left + box.width / 2 - 20),
        ),
      }}
    />
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
 * the lesson, or with the lesson moved aside when scrolling cannot uncover it.
 */
const useHighlightPlacement = ({
  currentStep,
  isAssistantVisible,
  pathname,
  userData,
  rightSideBarRef,
  rightSideBarOpen,
}: {
  currentStep: TutorialStepConfig | undefined;
  isAssistantVisible: boolean;
  pathname: string;
  userData: { tutorialOn: boolean; status: string } | undefined;
  rightSideBarRef: React.RefObject<HTMLDivElement | null>;
  rightSideBarOpen: boolean;
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
  const updateHighlightPosition = (currentStepConfig: TutorialStepConfig) => {
    const highlightInfo = findElementToHighlight(
      currentStepConfig,
      rightSideBarRef,
      rightSideBarOpen,
    );

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
      const before = highlightInfo.element.getBoundingClientRect();
      const panel = getAssistantPanelRect();
      // Content that renders after the latch (a fight's jutsu row, say) can push a
      // placed target under the panel without the player scrolling; place it again.
      if (
        placement.settled &&
        window.scrollY === placement.settledScrollY &&
        panel &&
        rectsOverlap(before, panel)
      ) {
        placement.settled = false;
      }
      if (
        !placement.settled &&
        placement.attempts < 5 &&
        canPositionTutorialHighlight(before.height, window.innerHeight, panel?.top)
      ) {
        const preferredCentre = getPreferredHighlightCentre(before.height);
        const centre = before.top + before.height / 2;
        const isOffscreen =
          before.bottom < 80 ||
          before.top > window.innerHeight - 80 ||
          before.right < 0 ||
          before.left > window.innerWidth;
        const isCovered = !!panel && rectsOverlap(before, panel);
        // In a fight the field and the action bar must stay in view together,
        // so there a visible, uncovered target is left where it is.
        const isMisplaced =
          isOffscreen ||
          isCovered ||
          (pathname !== "/combat" && Math.abs(centre - preferredCentre) > 100);
        if (!isMisplaced) {
          placement.settled = true;
          placement.settledScrollY = window.scrollY;
        } else {
          placement.attempts += 1;
          const scroller = highlightInfo.element.ownerDocument.scrollingElement;
          // In a fight a target only moves far enough to come into view clear of
          // the panel, so as much of the field as possible stays visible with it.
          const floor =
            panel && before.left < panel.right && before.right > panel.left
              ? Math.min(panel.top, window.innerHeight)
              : window.innerHeight;
          const offset =
            pathname !== "/combat"
              ? centre - preferredCentre
              : before.top < 80
                ? before.top - 80
                : before.bottom + 16 - floor;
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
    } else {
      setHighlight(null);
      setPanelDodgesHighlight(false);
    }
  };

  // Update highlight position based on current step and element
  useEffect(() => {
    // Early exit if tutorial is disabled
    if (userData && userData?.tutorialOn === false) return;
    if (!isAssistantVisible) return;

    // Determine which step to use - hospitalized overrides everything
    const isHospitalized = userData?.status === "HOSPITALIZED";
    const step = isHospitalized ? TUTORIAL_HOSPITALIZED_STEP : currentStep;

    // Guard against undefined step
    if (!step) {
      setHighlight(null);
      return;
    }

    // If we're not on the correct page for this step, don't try to highlight
    if (!isTutorialPageMatch(step.page, pathname)) {
      return;
    }

    return trackLayout(() => updateHighlightPosition(step));
  }, [currentStep, isAssistantVisible, pathname, userData?.status]);

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
  }, [userData, stepNumber, questTypePriority]);

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

const rectsOverlap = (a: DOMRect, b: DOMRect) =>
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
 * The highlight is re-measured four times a second so it follows an element that moves. Almost
 * none of those measurements differ, and storing an equal box would re-render the whole assistant
 * overlay for nothing, so the position setters keep the previous object when it has not moved.
 */
const isSameBox = (
  a: { top: number; left: number; width: number; height: number },
  b: { top: number; left: number; width: number; height: number },
) =>
  a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;

/**
 * Style for the hole cut around a highlighted element, padded by 8px. The hole follows its
 * element as the page scrolls; placed with top/left, every step of that is a layout shift of
 * a viewport-sized box, while a transform moves it without one.
 */
const highlightHoleStyle = (box: {
  top: number;
  left: number;
  width: number;
  height: number;
}): React.CSSProperties => ({
  top: 0,
  left: 0,
  width: box.width + 16,
  height: box.height + 16,
  transform: `translate(${box.left - 8}px, ${box.top - 8}px)`,
});

/**
 * Run `update` now and whenever layout may have moved, returning the cleanup. The poll covers
 * content that shifts without a DOM mutation, such as images and canvases.
 */
const trackLayout = (update: () => void) => {
  update();
  const intervalId = setInterval(update, 250);
  const updateNextFrame = () => requestAnimationFrame(update);
  window.addEventListener("scroll", updateNextFrame, { passive: true });
  window.addEventListener("resize", updateNextFrame, { passive: true });
  const observer = new MutationObserver(updateNextFrame);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    characterData: false,
  });
  return () => {
    clearInterval(intervalId);
    window.removeEventListener("scroll", updateNextFrame);
    window.removeEventListener("resize", updateNextFrame);
    observer.disconnect();
  };
};

// Helper function to find element to highlight based on current tutorial step
const getUsableHighlightElement = (id: string | undefined) => {
  if (!id) return null;
  const nodes = document.querySelectorAll<HTMLElement>(`[id="${CSS.escape(id)}"]`);
  for (const element of Array.from(nodes)) {
    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") continue;
    const rect = element.getBoundingClientRect();
    if (!isUsableHighlightRect(rect)) continue;
    return element;
  }
  return null;
};

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

/**
 * Tutorial assistant component props
 * @param rightSideBarOpen - Whether the right side bar is open
 * @param setRightSideBarOpen - Function to set the right side bar open
 * @param rightSideBarRef - Reference to the right side bar
 * @returns
 */
interface TutorialAssistantProps {
  /** Viewport width below which the shell moves its game menu into a drawer. */
  sidebarBreakpoint: number;
  rightSideBarOpen: boolean;
  setRightSideBarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  rightSideBarRef: React.RefObject<HTMLDivElement | null>;
}

/** The account and step the assistant is showing, read when a disable request settles. */
type TutorialIdentityRef = React.RefObject<{
  userId: string | undefined;
  tutorialStep: number | undefined;
}>;

/** A quest the assistant guides after the tutorial, with its live tracker. */
type PostTutorialQuest = { userQuest: UserQuest; tracker: QuestTrackerType };
