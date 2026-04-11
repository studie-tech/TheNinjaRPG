"use client";

import * as Sentry from "@sentry/nextjs";
import { ArrowRight, Settings2, Sparkles, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import React, { useEffect, useState } from "react";
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
  IMG_URL_ASSISTANT,
  IMG_URL_ASSISTANT_2,
  IMG_URL_HANDPOINTER,
  OrderedQuestTypesInTutorial,
  TUTORIAL_STEPS_COUNT,
} from "@/drizzle/constants";
import type { UserQuest } from "@/drizzle/schema";
import { useLocalStorage } from "@/hooks/localstorage";
import type { TutorialStepConfig } from "@/hooks/tutorial";
import {
  TUTORIAL_HOSPITALIZED_STEP,
  TUTORIAL_STEPS,
  useTutorialStep,
} from "@/hooks/tutorial";
import { useAbVariant } from "@/hooks/useAbVariant";
import Image from "@/layout/Image";
import { useCheckRewards } from "@/layout/Logbook";
import { Objective } from "@/layout/Objective";
import {
  getActiveObjective,
  isQuestComplete,
  isQuestObjectiveAvailable,
} from "@/libs/objectives";
import { cn } from "@/libs/shadui";
import { getMobileOperatingSystem } from "@/utils/hardware";
import { parseHtml } from "@/utils/parse";
import { capitalizeFirstLetter } from "@/utils/sanitize";
import { useUserData } from "@/utils/UserContext";
import type { QuestTrackerType } from "@/validators/objectives";

/**
 * Reusable assistant portrait with correct styling
 * @param characterImage - Optional custom character image to display instead of default assistant
 * @returns
 */
const AssistantPortrait: React.FC<{ characterImage?: string }> = ({
  characterImage,
}) => {
  const { variant } = useAbVariant("ab_lemu_replacement_2");
  const defaultImage =
    variant === "treatment" ? IMG_URL_ASSISTANT_2 : IMG_URL_ASSISTANT;
  const className = cn(
    "pointer-events-none absolute right-0 z-0 w-auto select-none object-contain drop-shadow-2xl",
    variant === "treatment"
      ? "-top-[10rem] h-[14rem] scale-x-[-1] md:-top-70 md:h-96"
      : "-top-[9.5rem] h-[9.5rem] md:-top-48 md:h-48",
  );
  return (
    <Image
      src={characterImage || defaultImage}
      width={100}
      height={100}
      alt="Assistant"
      className={className}
    />
  );
};

/**
 * Reusable assistant dialog (uses the latter, correct styling)
 * @param title - The title of the dialog
 * @param children - The content of the dialog
 * @param onOpenDisableModal - Optional callback when close button is clicked
 * @param characterImage - Optional custom character image for the portrait
 * @param onOpenOrderingDialog - Optional callback to open quest type ordering dialog
 * @param showOrderingButton - Whether to show the ordering button
 * @returns
 */
const AssistantDialog: React.FC<{
  title: string;
  children: React.ReactNode;
  onOpenDisableModal?: () => void;
  characterImage?: string;
  onOpenOrderingDialog?: () => void;
  showOrderingButton?: boolean;
}> = ({
  title,
  children,
  onOpenDisableModal,
  characterImage,
  onOpenOrderingDialog,
  showOrderingButton,
}) => (
  <div className="pointer-events-auto fixed right-4 bottom-24 z-[60] md:right-4 md:bottom-4">
    <div className="relative">
      {/* Assistant portrait positioned behind and above the dialog (top-right) */}
      <AssistantPortrait characterImage={characterImage} />
      {/* Foreground content */}
      <div className="relative z-10">
        {/* Nameplate */}
        <div className="absolute -top-6 left-8 rounded-md bg-primary px-4 py-1 text-primary-foreground text-xs uppercase tracking-wider shadow-lg md:text-sm">
          {title}
        </div>
        {/* Speech panel */}
        <div className="w-[80vw] rounded-xl border-2 border-primary bg-card p-4 text-foreground shadow-2xl md:w-[560px] md:p-5">
          {onOpenDisableModal && (
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onOpenDisableModal();
              }}
              className="absolute top-2 right-2 h-6 w-6 p-0 opacity-50 hover:opacity-100"
              title="Disable tutorial"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
          {children}
          {showOrderingButton && onOpenOrderingDialog && (
            <div className="mt-3 flex justify-end">
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onOpenOrderingDialog();
                }}
                className="opacity-50 hover:opacity-100"
                title="Sort quest priorities"
              >
                <Settings2 className="mr-1 h-4 w-4" />
                <span className="text-xs">Priority</span>
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  </div>
);

/**
 * Confirmation dialog for cancelling the tutorial
 * Shows the assistant character and warns the user
 */
const CancelTutorialConfirmDialog: React.FC<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}> = ({ open, onOpenChange, onConfirm }) => {
  const { variant } = useAbVariant("ab_lemu_replacement_2");
  const assistantImage =
    variant === "treatment" ? IMG_URL_ASSISTANT_2 : IMG_URL_ASSISTANT;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="z-[70] overflow-hidden pb-0 sm:max-w-md">
        <div className="flex gap-4">
          <div className="flex-1">
            <DialogHeader>
              <DialogTitle>Skip Tutorial?</DialogTitle>
              <DialogDescription className="pt-2">
                For new players, we <strong>highly recommend</strong> following the
                tutorial to learn how the game works. Are you sure you want to skip it?
                <br />
                <br />
                Remember, if you get stuck, click the support button and then you can
                re-enable the tutorial.
              </DialogDescription>
            </DialogHeader>
            <div className="mt-4 flex justify-start gap-2 pb-4">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Keep Tutorial
              </Button>
              <Button variant="destructive" onClick={onConfirm}>
                Skip Tutorial
              </Button>
            </div>
          </div>
          <div className="flex-shrink-0 self-end">
            <Image
              src={assistantImage}
              width={100}
              height={100}
              alt="Assistant"
              className={cn(
                "object-contain drop-shadow-lg",
                variant === "treatment" && "scale-x-[-1]",
              )}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

/**
 * Tutorial assistant component props
 * @param rightSideBarOpen - Whether the right side bar is open
 * @param setRightSideBarOpen - Function to set the right side bar open
 * @param rightSideBarRef - Reference to the right side bar
 * @returns
 */
interface TutorialAssistantProps {
  rightSideBarOpen: boolean;
  setRightSideBarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  rightSideBarRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * Tutorial assistant component
 * @param rightSideBarOpen - Whether the right side bar is open
 * @param setRightSideBarOpen - Function to set the right side bar open
 * @param rightSideBarRef - Reference to the right side bar
 * @returns
 */
const TutorialAssistant: React.FC<TutorialAssistantProps> = ({
  rightSideBarOpen,
  setRightSideBarOpen,
  rightSideBarRef,
}) => {
  // State
  const { data: userData, userAgent } = useUserData();
  const pathname = usePathname();
  const router = useRouter();
  const utils = api.useUtils();

  // Mutation to disable tutorial
  const { mutate: disableTutorial } = api.profile.updatePreferences.useMutation({
    onSuccess: async () => {
      await utils.profile.getUser.invalidate();
    },
  });

  const handleDisableTutorial = () => {
    disableTutorial({ tutorialOn: false });
  };

  const [highlight, setHighlight] = useState<{
    isPrimaryElement: boolean;
    top: number;
    left: number;
    width: number;
    height: number;
  } | null>(null);
  const [gameMenuHighlight, setGameMenuHighlight] = useState<{
    top: number;
    left: number;
    width: number;
    height: number;
  } | null>(null);
  // Removed missing-element dialog functionality

  // Check if we're on mobile
  const hardwarePlatform = getMobileOperatingSystem(userAgent);
  const [isMobile, setIsMobile] = useState<boolean>(
    typeof window !== "undefined" ? window.innerWidth < 768 : false,
  );

  // Handle window resize to update isMobile state
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // State to track if we should show the special game menu tutorial
  const [showGameMenuTutorial, setShowGameMenuTutorial] = useState<boolean>(false);

  // Track if we've already scrolled for the current step to avoid repeated scrolling
  const hasScrolledForStepRef = React.useRef<number>(-1);

  // Tutorial management hook
  const {
    currentStep,
    updateTutorialStep,
    handleNextStep,
    handleNextStepAsync,
    currentStepNumber,
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
      let tutorialStep = userData.tutorialStep;

      // Set to 0 if undefined (first time user)
      if (tutorialStep === undefined) {
        tutorialStep = 0;
        updateTutorialStep({ step: 0 });
      }

      // Get current step config
      const isHospitalized = userData.status === "HOSPITALIZED";
      const currentStepConfig = isHospitalized
        ? TUTORIAL_HOSPITALIZED_STEP
        : TUTORIAL_STEPS[tutorialStep];
      const inBattle = userData.status === "BATTLE";
      const onBattlePage = pathname === "/combat";
      const toBattlePage = currentStepConfig?.page === "/combat";

      // Check if we need to show the special Game Menu tutorial
      // Show it when on mobile, sidebar is closed, and we're at a step that requires the game menu
      const shouldShowGameMenuTutorial =
        isMobile &&
        !rightSideBarOpen &&
        tutorialStep < TUTORIAL_STEPS.length &&
        currentStepConfig?.requiresGameMenu === true;

      setShowGameMenuTutorial(shouldShowGameMenuTutorial);

      // Scroll to top when requiresGameMenu is true and menu is not open
      if (shouldShowGameMenuTutorial) {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }

      // Handle regular tutorial steps
      if (!shouldShowGameMenuTutorial) {
        // Show tutorial if we have a valid step and we're on the right page
        const onCorrectPage = currentStepConfig?.page?.includes(pathname);
        const hasRequiredGameMenu =
          currentStepConfig?.requiresGameMenu && isMobile ? rightSideBarOpen : true;

        // Only show if on correct page and game menu requirements are met
        const shouldShowRegularTutorial =
          tutorialStep < TUTORIAL_STEPS.length && onCorrectPage && hasRequiredGameMenu;
        setIsAssistantVisible(Boolean(shouldShowRegularTutorial));

        // If we're at a valid step but not on the correct page, redirect
        if (
          tutorialStep < TUTORIAL_STEPS.length &&
          !onCorrectPage &&
          currentStepConfig
        ) {
          if (!currentStepConfig?.requiresGameMenu) {
            setRightSideBarOpen(false);
          }
          const battleCheck =
            (!onBattlePage && !toBattlePage) || // Unrelated to battle
            (inBattle && toBattlePage); // In battle and going to battle page
          if (battleCheck) {
            router.push(currentStepConfig.page);
          }
        }
      } else {
        // If showing game menu tutorial, don't show regular tutorial
        setIsAssistantVisible(false);
      }
    }
  }, [userData, pathname, router, updateTutorialStep, rightSideBarOpen, isMobile]);

  // Start Sentry replay on the first tutorial step
  useEffect(() => {
    // Do not handle replays on done tutorial
    if (currentStepNumber >= TUTORIAL_STEPS.length) return;
    if (!userData) return;
    if (userData.level > 1) return;
    if (userData?.tutorialOn === false) return;
    // Start replay if we're on step 0 (first step)
    const replay = Sentry.getReplay();
    if (replay && currentStepNumber === 0) {
      replay.start();
    }
  }, [currentStepNumber, userData]);

  // No tooltip positioning logic needed anymore

  // Helper function to update the highlight position
  const updateHighlightPosition = (currentStepConfig: TutorialStepConfig) => {
    // Use our helper function to find the element
    const highlightInfo = findElementToHighlight(
      {
        ...currentStepConfig,
        elementIds: currentStepConfig.elementIds,
      },
      rightSideBarRef,
      rightSideBarOpen,
    );

    if (highlightInfo) {
      setHighlight({
        isPrimaryElement: highlightInfo.isPrimaryElement,
        top: highlightInfo.top,
        left: highlightInfo.left,
        width: highlightInfo.width,
        height: highlightInfo.height,
      });
      // no-op
    } else {
      setHighlight(null);
      // no-op
    }
  };

  // Handle certain syncronization situations
  useEffect(() => {
    // Assign stats but no stats available
    if (
      userData &&
      currentStep?.title === "Assigning Stats" &&
      userData?.earnedExperience === 0 &&
      userData?.tutorialOn === true
    ) {
      console.log("Assigning stats but no stats available, proceeding to next step");
      void handleNextStepAsync();
    }
  }, [currentStep, userData]);

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
    if (!step.page?.includes(pathname)) {
      return;
    }

    // Initial position calculation
    updateHighlightPosition(step);

    // Set up a more frequent interval for smoother updates (100ms)
    const intervalId = setInterval(() => {
      updateHighlightPosition(step);
    }, 250);

    // Add scroll event listener to update position when scrolling
    const handleScroll = () => {
      // Need to request animation frame to ensure we get the latest positions after scroll
      requestAnimationFrame(() => {
        updateHighlightPosition(step);
      });
    };

    window.addEventListener("scroll", handleScroll, { passive: true });

    // Add resize event listener to update position when window is resized
    const handleResize = () => {
      // Need to request animation frame to ensure we get the latest positions after resize
      requestAnimationFrame(() => {
        updateHighlightPosition(step);
      });
    };

    window.addEventListener("resize", handleResize, { passive: true });

    // Add a mutation observer to detect DOM changes that might affect positioning
    const observer = new MutationObserver(() => {
      requestAnimationFrame(() => {
        updateHighlightPosition(step);
      });
    });

    // Start observing the document for DOM changes
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: false,
    });

    // Clean up interval and event listeners on unmount or when dependencies change
    return () => {
      clearInterval(intervalId);
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleResize);
      observer.disconnect();
    };
  }, [currentStep, isAssistantVisible, pathname, userData?.status]);

  // Update game menu highlight position when showing game menu tutorial
  useEffect(() => {
    // Early exit if tutorial is disabled
    if (userData?.tutorialOn === false) return;
    if (!showGameMenuTutorial) {
      setGameMenuHighlight(null);
      return;
    }

    const updateGameMenuHighlight = () => {
      const highlightInfo = findElementToHighlight(
        {
          id: "MOrKKgxeHiwZvkA9JYW0i",
          elementIds: ["tutorial-gameBtn"],
          title: "Game Menu",
          description:
            "Click this button to open the game menu and continue the tutorial.",
          page: pathname,
        },
        rightSideBarRef,
        rightSideBarOpen,
      );

      if (highlightInfo) {
        setGameMenuHighlight({
          top: highlightInfo.top,
          left: highlightInfo.left,
          width: highlightInfo.width,
          height: highlightInfo.height,
        });
      } else {
        setGameMenuHighlight(null);
      }
    };

    // Initial position calculation
    updateGameMenuHighlight();

    // Set up interval for smoother updates
    const intervalId = setInterval(() => {
      updateGameMenuHighlight();
    }, 250);

    // Add scroll event listener
    const handleScroll = () => {
      requestAnimationFrame(() => {
        updateGameMenuHighlight();
      });
    };
    window.addEventListener("scroll", handleScroll, { passive: true });

    // Add resize event listener
    const handleResize = () => {
      requestAnimationFrame(() => {
        updateGameMenuHighlight();
      });
    };
    window.addEventListener("resize", handleResize, { passive: true });

    // Add mutation observer
    const observer = new MutationObserver(() => {
      requestAnimationFrame(() => {
        updateGameMenuHighlight();
      });
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: false,
    });

    // Clean up
    return () => {
      clearInterval(intervalId);
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleResize);
      observer.disconnect();
    };
  }, [
    showGameMenuTutorial,
    pathname,
    rightSideBarRef,
    rightSideBarOpen,
    userData?.tutorialOn,
  ]);

  // Auto-center the highlighted element when it becomes available
  useEffect(() => {
    // Early exit if tutorial is disabled
    if (userData?.tutorialOn === false) return;
    if (!highlight || !isAssistantVisible) return;

    // Only scroll once per step
    if (hasScrolledForStepRef.current === currentStepNumber) return;

    const elementCenter = highlight.top + highlight.height / 2;
    const viewportCenter = window.innerHeight / 2;
    const currentScroll = window.scrollY;
    const targetScroll = currentScroll + elementCenter - viewportCenter;

    // Only scroll if the element is not already roughly centered
    const scrollThreshold = 100; // pixels
    if (Math.abs(elementCenter - viewportCenter) > scrollThreshold) {
      window.scrollTo({ top: Math.max(0, targetScroll), behavior: "smooth" });
    }

    // Mark that we've scrolled for this step
    hasScrolledForStepRef.current = currentStepNumber;
  }, [highlight, isAssistantVisible, currentStepNumber, userData?.tutorialOn]);

  // Add keyboard event listener for Enter and ArrowLeft keys to forward tutorial
  useEffect(() => {
    // Early exit if tutorial is disabled
    if (userData?.tutorialOn === false) return;
    // Only add keyboard listener when tutorial is visible (either regular or game menu)
    if (!isAssistantVisible && !showGameMenuTutorial) return;

    const handleKeyPress = (event: KeyboardEvent) => {
      // Check for Enter key or ArrowLeft key
      if (event.key === "Enter" || event.key === "ArrowRight") {
        event.preventDefault();
        event.stopPropagation();

        if (showGameMenuTutorial) {
          // If showing game menu tutorial, open the sidebar
          setRightSideBarOpen(true);
        } else {
          // Otherwise, proceed to next step
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
  ]);

  // Post tutorial state - quest data from userData
  const [postTutorialQuest, setPostTutorialQuest] = useState<{
    userQuest: UserQuest;
    tracker: QuestTrackerType;
  } | null>(null);

  // Post tutorial state - whether to show the quest
  const [showPostTutorialQuest, setShowPostTutorialQuest] = useState(false);

  // Quest type priority ordering (persisted in localStorage)
  const [questTypePriority, setQuestTypePriority] = useLocalStorage<QuestType[]>(
    "tutorial-quest-type-priority",
    [...OrderedQuestTypesInTutorial],
  );

  // Dialog state for quest type ordering
  const [showOrderingDialog, setShowOrderingDialog] = useState(false);

  // Dialog state for confirming tutorial cancellation
  const [showCancelConfirmDialog, setShowCancelConfirmDialog] = useState(false);

  // Post-tutorial quest guidance: Find quest based on priority ordering
  useEffect(() => {
    if (userData?.tutorialOn !== false && currentStepNumber >= TUTORIAL_STEPS.length) {
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
        if (quest) {
          // Get the tracker for this quest
          const tracker = userData?.questData?.find((q) => q.id === quest.questId);

          // Set quest if tracker exists
          if (tracker) {
            setPostTutorialQuest({ userQuest: quest, tracker });
          } else {
            setPostTutorialQuest(null);
          }
        } else {
          setPostTutorialQuest(null);
        }
      } else {
        setPostTutorialQuest(null);
      }
    } else {
      setPostTutorialQuest(null);
    }
  }, [userData, currentStepNumber, questTypePriority]);

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

    // Initial check
    checkLogbookEntry();

    // Set up interval to keep checking
    const interval = setInterval(checkLogbookEntry, 1000);

    return () => clearInterval(interval);
  }, [postTutorialQuest]);

  // Determine which step to show - hospitalized overrides everything
  const isHospitalized = userData?.status === "HOSPITALIZED";

  // Create a dynamic tutorial step for post-tutorial quest guidance
  let dynamicQuestStep: TutorialStepConfig | null = null;
  if (showPostTutorialQuest && postTutorialQuest) {
    const { userQuest, tracker } = postTutorialQuest;
    const quest = userQuest.quest;
    const activeObjective = getActiveObjective(quest, tracker);

    // Determine the text to show
    let description = quest.description;
    if (quest.consecutiveObjectives && activeObjective?.description) {
      description = activeObjective.description;
    }

    dynamicQuestStep = {
      id: `quest-${quest.id}`,
      title: quest.name,
      description: description,
      page: pathname,
      relatedValue: quest.id,
      showNextButton: false,
    };
  }

  const currentTutorialStep =
    dynamicQuestStep || (isHospitalized ? TUTORIAL_HOSPITALIZED_STEP : currentStep);

  // Find dialog options if the current step relates to a quest with a dialog task
  let dialogOptions = null;
  if (
    userData?.tutorialOn !== false &&
    currentTutorialStep?.relatedValue &&
    userData?.userQuests
  ) {
    // Find the matching user quest
    const matchingQuest = userData.userQuests.find(
      (uq) => uq.questId === currentTutorialStep.relatedValue,
    );

    if (matchingQuest) {
      // Get the tracker for this quest
      const tracker = userData.questData?.find((q) => q.id === matchingQuest.questId);

      if (tracker) {
        // Get the active objective
        const activeObjective = getActiveObjective(matchingQuest.quest, tracker);

        // Check if it's a dialog task
        if (activeObjective?.task === "dialog") {
          dialogOptions = {
            questId: matchingQuest.questId,
            options: activeObjective.nextObjectiveId,
          };
        }
      }
    }
  }

  // Get character images for post-tutorial quest (no background)
  // For starter quests, skip fetching scene characters - we'll use the A/B tested assistant image instead
  const postTutorialCharacterIds: string[] = [];
  if (showPostTutorialQuest && postTutorialQuest) {
    const { userQuest, tracker } = postTutorialQuest;
    const quest = userQuest.quest;
    const isStarterQuest = quest.questType === "starter";

    // Skip fetching scene characters for starter quests - AssistantPortrait will use A/B tested default
    if (!isStarterQuest) {
      // If consecutive objectives, use active objective's characters or fall back to quest characters
      if (quest.consecutiveObjectives) {
        const activeObjective = getActiveObjective(quest, tracker);
        if (
          activeObjective?.sceneCharacters &&
          activeObjective.sceneCharacters.length > 0
        ) {
          postTutorialCharacterIds.push(...activeObjective.sceneCharacters);
        } else {
          postTutorialCharacterIds.push(...(quest.content.sceneCharacters || []));
        }
      } else {
        // Not consecutive, use quest's characters
        postTutorialCharacterIds.push(...(quest.content.sceneCharacters || []));
      }
    }
  }

  // Query to fetch character assets for post-tutorial quest
  const { data: postTutorialCharacterAssets } = api.gameAsset.getSceneAssets.useQuery(
    { assetIds: postTutorialCharacterIds },
    { enabled: postTutorialCharacterIds.length > 0 },
  );

  // Render Game Menu tutorial (with bottom-right assistant)
  const renderGameMenuTutorial = () => {
    if (gameMenuHighlight) {
      return (
        <div className="fixed inset-0 z-[60]">
          {/* Dim background */}
          <div className="absolute inset-0 bg-black/30" />

          {/* Hole highlight over the game button */}
          <div
            className="absolute bg-transparent shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]"
            style={{
              top: gameMenuHighlight.top - 10,
              left: gameMenuHighlight.left - 10,
              width: gameMenuHighlight.width + 20,
              height: gameMenuHighlight.height + 20,
            }}
          >
            <div className="absolute inset-0 z-[1] animate-pulse rounded-md border-[3px] border-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.7)]">
              {/* Allow clicking to open the menu */}
              <button
                type="button"
                className="pointer-events-auto absolute inset-0 z-[2] cursor-pointer"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setRightSideBarOpen(true);
                }}
                aria-label="Open game menu"
              />
            </div>
          </div>

          {/* Hand pointer near the highlighted button */}
          <Image
            src={IMG_URL_HANDPOINTER}
            alt="Tap here"
            className="absolute h-[4.5rem] w-[4.5rem] animate-bounce"
            width={80}
            height={80}
            style={{
              top: Math.max(0, gameMenuHighlight.top + gameMenuHighlight.height + 12),
              left: Math.min(
                window.innerWidth - 40,
                gameMenuHighlight.left + gameMenuHighlight.width / 2 - 20,
              ),
            }}
          />

          {/* Assistant panel bottom-right - large, game-like dialog */}
          <AssistantDialog
            title="Game Menu"
            onOpenDisableModal={() => {
              if (currentStepNumber >= TUTORIAL_STEPS_COUNT) {
                handleDisableTutorial();
              } else {
                setShowCancelConfirmDialog(true);
              }
            }}
          >
            <p className="text-sm leading-relaxed md:text-base">
              Click the highlighted button to open the game menu and continue the
              tutorial.
            </p>
            <div className="mt-3 flex justify-end gap-2 md:mt-4">
              <Button size="lg" onClick={() => setRightSideBarOpen(true)}>
                Open Menu <ArrowRight className="ml-2 h-4 w-4 md:h-5 md:w-5" />
              </Button>
            </div>
          </AssistantDialog>
        </div>
      );
    }

    // Fallback dialog if button not found
    return (
      <Dialog open={true}>
        <DialogContent className="z-[60] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Continue the Tutorial</DialogTitle>
            <DialogDescription>
              Please click on the circular button in the top right corner to open the
              game menu and continue the tutorial.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 flex justify-between">
            <Button onClick={() => setRightSideBarOpen(true)}>Open Menu</Button>
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
    currentTutorialStep?.proceedOnHighlightClick && highlight?.isPrimaryElement
      ? "pointer-events-auto"
      : "pointer-events-none";

  // If showing the special Game Menu tutorial
  if (showGameMenuTutorial) {
    return renderGameMenuTutorial();
  }

  // If the regular tutorial is not visible and there's no post-tutorial quest to show, don't render anything
  if (!isAssistantVisible && !showPostTutorialQuest) return null;

  // Guard against undefined currentTutorialStep
  if (!currentTutorialStep) return null;

  // Render the tutorial overlay with highlight and assistant panel
  return (
    <>
      {highlight && !showCancelConfirmDialog && (
        <div className={cn("fixed inset-0 z-[60]", pointerEvents)}>
          <div className="absolute inset-0 min-h-[2000px] bg-black/30" />

          <div
            className={cn(
              "absolute bg-transparent shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]",
              pointerEvents,
            )}
            style={{
              top: highlight.top - 10,
              left: highlight.left - 10,
              width: highlight.width + 20,
              height: highlight.height + 20,
            }}
          >
            <div className="absolute inset-0 z-[1] animate-pulse rounded-md border-[3px] border-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.7)]">
              <button
                type="button"
                className={cn("absolute inset-0 z-[2] cursor-pointer", pointerEvents)}
                aria-label="Continue tutorial"
                onPointerDown={(e) => {
                  if (currentTutorialStep.proceedOnHighlightClick) {
                    e.preventDefault();
                    e.stopPropagation();
                    handleNextStep();
                  }
                }}
                onClick={(e) => {
                  if (currentTutorialStep.proceedOnHighlightClick) {
                    e.preventDefault();
                    e.stopPropagation();
                  }
                }}
                onTouchStart={(e) => {
                  if (currentTutorialStep.proceedOnHighlightClick) {
                    e.preventDefault();
                    e.stopPropagation();
                    handleNextStep();
                  }
                }}
                onTouchEnd={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
              />
            </div>
          </div>

          {/* Hand pointer if this step highlights a clickable element */}
          <Image
            src={IMG_URL_HANDPOINTER}
            alt="Tap here"
            className="absolute h-18 w-18 animate-bounce"
            width={80}
            height={80}
            style={{
              top: Math.max(0, highlight.top + highlight.height + 12),
              left: Math.min(
                window.innerWidth - 40,
                highlight.left + highlight.width / 2 - 20,
              ),
            }}
          />
        </div>
      )}

      {/* Assistant panel bottom-right - large, game-like dialog */}
      {!currentTutorialStep.hideDialog &&
        !showOrderingDialog &&
        !showCancelConfirmDialog && (
          <AssistantDialog
            title={currentTutorialStep.title}
            onOpenDisableModal={() => {
              if (currentStepNumber >= TUTORIAL_STEPS_COUNT) {
                handleDisableTutorial();
              } else {
                setShowCancelConfirmDialog(true);
              }
            }}
            characterImage={characterImage}
            onOpenOrderingDialog={() => setShowOrderingDialog(true)}
            showOrderingButton={showPostTutorialQuest}
          >
            {typeof currentTutorialStep.description === "string" ? (
              <p className="text-sm leading-relaxed md:text-base">
                {parseHtml(currentTutorialStep.description)}
              </p>
            ) : (
              <div className="text-sm leading-relaxed md:text-base">
                {currentTutorialStep.description}
              </div>
            )}
            {currentTutorialStep.externalLink && (
              <div className="mt-3">
                <Button
                  className="w-full"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    window.open(currentTutorialStep.externalLink, "_blank")
                  }
                >
                  Read Getting Started Guide
                </Button>
              </div>
            )}
            {dialogOptions && !isCheckingRewards && (
              <div className="mt-3 md:mt-4">
                <h3 className="mb-2 font-semibold text-sm">Dialog Options</h3>
                <div className="flex flex-wrap gap-2">
                  {dialogOptions.options.map((entry) => (
                    <Button
                      key={entry.nextObjectiveId}
                      variant="outline"
                      size="sm"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        checkRewards({
                          questId: dialogOptions.questId,
                          nextObjectiveId: entry.nextObjectiveId,
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
            {postTutorialQuest?.userQuest.quest.content.objectives &&
              postTutorialQuest && (
                <>
                  <div
                    className={cn("mt-3 grid grid-cols-1 grid-cols-2 gap-4 md:mt-4")}
                  >
                    {postTutorialQuest.userQuest.quest.content.objectives.map(
                      (objective, objectiveIndex) => {
                        if (!postTutorialQuest) return null;
                        const quest = postTutorialQuest.userQuest.quest;
                        const tracker = postTutorialQuest.tracker;
                        const allDone = isQuestComplete(quest, tracker);
                        const activeObjective = getActiveObjective(quest, tracker);
                        const status = tracker.goals.find((g) => g.id === objective.id);
                        const hideIfNoRewards =
                          objective.task === "dialog" ||
                          (activeObjective && objective.id !== activeObjective?.id) ||
                          (allDone && !status?.done);
                        return (
                          <Objective
                            objective={objective}
                            tracker={tracker}
                            checkRewards={() => checkRewards({ questId: quest.id })}
                            key={objective.id}
                            titlePrefix={
                              quest.consecutiveObjectives
                                ? "Objective: "
                                : `${objectiveIndex + 1}. `
                            }
                            grayedOut={
                              !isQuestObjectiveAvailable(quest, tracker, objectiveIndex)
                            }
                            hideIfNoRewards={hideIfNoRewards}
                          />
                        );
                      },
                    )}
                  </div>
                  {isQuestComplete(
                    postTutorialQuest.userQuest.quest,
                    postTutorialQuest.tracker,
                  ) &&
                    userData?.status === "AWAKE" && (
                      <div className="mt-3 md:mt-4">
                        <Button
                          onClick={() => {
                            if (!postTutorialQuest) return;
                            checkRewards({
                              questId: postTutorialQuest.userQuest.quest.id,
                            });
                          }}
                          className="w-full"
                        >
                          <Sparkles className="mr-2 h-5 w-5" />
                          Collect Reward
                        </Button>
                      </div>
                    )}
                </>
              )}
            {currentTutorialStep?.showNextButton && (
              <div className="mt-3 flex justify-end gap-2 md:mt-4">
                <Button
                  size="lg"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (hardwarePlatform !== "mobile") {
                      handleNextStep();
                    }
                  }}
                  onTouchStart={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (hardwarePlatform === "mobile") {
                      handleNextStep();
                    }
                  }}
                  onTouchEnd={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                >
                  {currentStepNumber === TUTORIAL_STEPS.length - 1 ? "Finish" : "Next"}
                  <ArrowRight className="ml-2 h-4 w-4 md:h-5 md:w-5" />
                </Button>
              </div>
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
        onConfirm={() => {
          setShowCancelConfirmDialog(false);
          handleDisableTutorial();
        }}
      />
    </>
  );
};

export default TutorialAssistant;

// Helper function to find element to highlight based on current tutorial step
const findElementToHighlight = (
  step: TutorialStepConfig,
  rightSideBarRef: React.RefObject<HTMLDivElement | null>,
  rightSideBarOpen: boolean,
) => {
  if (!step?.elementIds || step.elementIds.length === 0) return null;

  // Find the first non-null element in elementIds
  let element: HTMLElement | null =
    step.elementIds?.map((id) => id && document.getElementById(id)).find(Boolean) ||
    null;
  const primaryElement =
    step.elementIds?.[0] && document.getElementById(step.elementIds[0]);
  const isPrimaryElement = element === primaryElement;

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
        .find(Boolean) ||
      Array.from(sidebarElement.querySelectorAll<HTMLElement>("[id]")).find((el) =>
        step.elementIds?.some(
          (id) => id && el.id?.includes(id.replace("tutorial-", "")),
        ),
      );

    if (foundElement) {
      element = foundElement;
    }
  }

  if (!element) return null;

  // Get element position - getBoundingClientRect() gives viewport coordinates
  const rect = element.getBoundingClientRect();

  // Validate that the element has been laid out and has dimensions
  // getBoundingClientRect returns all zeros if element exists but hasn't been rendered yet
  // This commonly happens with accordion children that are being expanded
  if (rect.width === 0 || rect.height === 0) {
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
