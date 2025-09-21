"use client";

import React, { useState, useEffect, useCallback } from "react";
import Image from "next/image";
import { ArrowRight } from "lucide-react";
import { useUserData } from "@/utils/UserContext";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getMobileOperatingSystem } from "@/utils/hardware";
import { api } from "@/app/_trpc/client";
import { IMG_URL_ASSISTANT, IMG_URL_HANDPOINTER } from "@/drizzle/constants";

interface TutorialStepConfig {
  title: string;
  description: string;
  elementId?: string;
  page: string;
  requiresGameMenu?: boolean;
  externalLink?: string;
}

// Define the type for our tutorial step as used in the helper function
type TutorialStep = TutorialStepConfig;

// Define all tutorial steps
const TUTORIAL_STEPS: TutorialStepConfig[] = [
  // Profile page steps - main menu buttons

  {
    title: "Welcome to the game",
    description:
      "Welcome to The Ninja-Rpg! I'm Lemu and I'll be guiding you through the early stages of your development here at the academy. Before starting we will quickly go through basic controls and features. This is your main profile where all your overall progress can be viewed.",
    elementId: "tutorial-profile",
    page: "/profile",
    requiresGameMenu: false,
  },
  {
    title: "Strengths & Weaknesses",
    description:
      "In this section of the profile you can view the specifics of your character, your stats, strengths and weaknesses. Kinda weak right now, but we'll get you stronger. Let's go the the battle arena to train a bit. ",
    elementId: "tutorial-strength-weaknesses",
    page: "/profile",
    requiresGameMenu: false,
  },
  {
    title: "Logbook",
    description:
      "The Logbook shows your current events, missions, quests and rank up exams that is currently in progress. It is alwso here you can see previous completed activities, battles and achievements.",
    elementId: "tutorial-logbook",
    page: "/profile",
    requiresGameMenu: false,
  },
  {
    title: "Tavern",
    description:
      "Talk with your fellow Shinobi in your own village or use the global chat",
    elementId: "tutorial-tavern",
    page: "/profile",
    requiresGameMenu: true,
  },
  {
    title: "Users",
    description:
      "Search for users, view the strongest players or view the current staff and reach out to them.",
    elementId: "tutorial-users",
    page: "/profile",
    requiresGameMenu: true,
  },
  {
    title: "Inbox",
    description: "Check your messages from other players and system notifications.",
    elementId: "tutorial-inbox",
    page: "/profile",
    requiresGameMenu: true,
  },
  {
    title: "Jutsus",
    description:
      "View all the jutsu that you have trained and equip them to use in battle.",
    elementId: "tutorial-jutsus",
    page: "/profile",
    requiresGameMenu: true,
  },
  {
    title: "Reports",
    description:
      "View your report history this is where bans, warnings and silences are.",
    elementId: "tutorial-reports",
    page: "/profile",
    requiresGameMenu: true,
  },
  {
    title: "Travel",
    description:
      "Access the TNR Globe here, you can travel to Wake Island and go to the science building to check if you have a Bloodline.",
    elementId: "tutorial-travel",
    page: "/profile",
    requiresGameMenu: true,
  },
  {
    title: "Points",
    description:
      "You can support the game by purchasing reputation points or buying federal support here.",
    elementId: "tutorial-points",
    page: "/profile",
    requiresGameMenu: true,
  },
  {
    title: "Items",
    description: "View all the items that you have purchased here",
    elementId: "tutorial-items",
    page: "/profile",
    requiresGameMenu: true,
  },
  {
    title: "Jobs",
    description: "Gather and hunt for materials, or craft items here",
    elementId: "tutorial-jobs",
    page: "/profile",
    requiresGameMenu: true,
  },
  {
    title: "Help",
    description: "Support system where you can report bugs, request features and more",
    elementId: "tutorial-support",
    page: "/profile",
    requiresGameMenu: true,
  },
  {
    title: "Rules",
    description: "View all the rules of the game here",
    elementId: "tutorial-rules",
    page: "/profile",
    requiresGameMenu: true,
  },
  {
    title: "Village",
    description:
      "The location Menu is the heart of your village, this is where you can access all your village has to offer from Trainings to the black-market, to taking Missions to buying Ramen. You can also view your village Notice board here as well.",
    elementId: "tutorial-village",
    page: "/profile",
    requiresGameMenu: true,
  },

  // Village page steps
  {
    title: "Training",
    description:
      "Come here to begin training each of your offense that was covered under Strength and Weakness along with Training your jutsu. Use the filters to locate what you are looking for. Jutsu's are locked behind rank and elements. If you want a comprehensive guide of what Jutsu's are in the game please select Info and use the jutsu page there.",
    elementId: "tutorial-traininggrounds",
    page: "/village",
  },
  {
    title: "Town Hall",
    description:
      "This is where you go to see the current Kages, their leaders, your alliances with other villages and your village elders.",
    elementId: "tutorial-townhall",
    page: "/village",
  },
  {
    title: "Ramen Shop",
    description:
      "You can purchase Ramen to heal you or you can wait on a medical ninja todo so.",
    elementId: "tutorial-ramenshop",
    page: "/village",
  },
  {
    title: "Mission Hall",
    description:
      "Here you can take missions, Missions grant you Ryo and other Stats that can be used.",
    elementId: "tutorial-missionhall",
    page: "/village",
  },
  {
    title: "Item Shop",
    description: "Purchase items, weapons armor and consumables here.",
    elementId: "tutorial-itemshop",
    page: "/village",
  },
  {
    title: "Hospital",
    description:
      "This is where those who are in need of healing shows up or if you have died in combat you will be in the hospital. If you're a medical ninja you can go to the hospital to heal your fellow villagers.",
    elementId: "tutorial-hospital",
    page: "/village",
  },
  {
    title: "Home",
    description:
      "TNR is a PVP game, your home allows you to sleep to avoid being in fights and to increase your Regen along with storing items.",
    elementId: "tutorial-home",
    page: "/village",
  },
  {
    title: "Clan Hall",
    description:
      "Clans are created by players they act as guilds where you can gain training boost, participate in clan battles and clan tournaments. You can also create a clan but that comes at a cost.",
    elementId: "tutorial-clanhall",
    page: "/village",
  },
  {
    title: "Black Market",
    description:
      "Come here to purchase Crafted Goods, Reputation points from other players and other Items with reputation points or Ryo.",
    elementId: "tutorial-blackmarket",
    page: "/village",
  },
  {
    title: "Battle Arena",
    description:
      "Put your skills to the test by fighting NPCs in the Arena, the Battle Pyramids. You can also train yourselves with the testing dummy to maximize damage rotations.",
    elementId: "tutorial-battlearena",
    page: "/village",
  },
  {
    title: "Bank",
    description:
      "Withdraw, Bank or send ryo to other players. You also gain a daily interest rate on what you bank.",
    elementId: "tutorial-bank",
    page: "/village",
  },
  {
    title: "Academy",
    description:
      "Learn the basics of the game here, this will be your starting point for how to play the game. Let's go there now.",
    elementId: "tutorial-academy",
    page: "/village",
  },
  {
    title: "Academy",
    description:
      "Welcome to the academy. Once we're done with this tutorial, press here to start your first lesson to get more familiar with the game. Good luck!",
    elementId: "tutorial-take-quest",
    page: "/academy",
  },
  {
    title: "That's it for now!",
    description:
      "That's it for the tutorial, you can now start playing the game! You can find further information on how to play the game at this link",
    elementId: "tutorial-logo",
    page: "/academy",
    externalLink: "https://the-ninja-rpg.fandom.com/wiki/Getting_Started",
  },
];

interface TutorialAssistantProps {
  rightSideBarOpen: boolean;
  setRightSideBarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  rightSideBarRef: React.RefObject<HTMLDivElement | null>;
}

const TutorialAssistant: React.FC<TutorialAssistantProps> = ({
  rightSideBarOpen,
  setRightSideBarOpen,
  rightSideBarRef,
}) => {
  // State
  const { data: userData, userAgent, updateUser } = useUserData();
  const pathname = usePathname();
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState<number>(0);
  const [isVisible, setIsVisible] = useState<boolean>(false);
  const [highlight, setHighlight] = useState<{
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

  // Update user's tutorial step
  const updateTutorialStep = api.profile.updateTutorialStep.useMutation({
    onSuccess: async (data) => {
      if (data.success && data.data) {
        await updateUser({ tutorialStep: data.data.tutorialStep });
        const nextStepPage = TUTORIAL_STEPS[data.data.tutorialStep]?.page;
        if (nextStepPage && pathname !== nextStepPage) {
          router.push(nextStepPage);
        }
      }
    },
  });

  // Initialize tutorial visibility
  useEffect(() => {
    if (userData) {
      // Handle the tutorial step
      let tutorialStep = userData.tutorialStep;

      // Set to 0 if undefined (first time user)
      if (tutorialStep === undefined) {
        tutorialStep = 0;
        updateTutorialStep.mutate({ step: 0 });
      }

      setCurrentStep(tutorialStep);

      // Get current step config
      const currentStepConfig = TUTORIAL_STEPS[tutorialStep];

      // Check if we need to show the special Game Menu tutorial
      // Show it when on mobile, sidebar is closed, and we're at a step that requires the game menu
      const shouldShowGameMenuTutorial =
        isMobile &&
        !rightSideBarOpen &&
        tutorialStep < TUTORIAL_STEPS.length &&
        currentStepConfig?.requiresGameMenu === true;

      setShowGameMenuTutorial(shouldShowGameMenuTutorial);

      // Handle regular tutorial steps
      if (!shouldShowGameMenuTutorial) {
        // Show tutorial if we have a valid step and we're on the right page
        const onCorrectPage = currentStepConfig && pathname === currentStepConfig.page;
        const hasRequiredGameMenu =
          currentStepConfig?.requiresGameMenu && isMobile ? rightSideBarOpen : true;

        // Only show if on correct page and game menu requirements are met
        const shouldShowRegularTutorial =
          tutorialStep < TUTORIAL_STEPS.length && onCorrectPage && hasRequiredGameMenu;
        setIsVisible(Boolean(shouldShowRegularTutorial));

        // If we're at a valid step but not on the correct page, redirect
        if (
          tutorialStep < TUTORIAL_STEPS.length &&
          !onCorrectPage &&
          currentStepConfig
        ) {
          if (!currentStepConfig?.requiresGameMenu) {
            setRightSideBarOpen(false);
          }
          router.push(currentStepConfig.page);
        }
      } else {
        // If showing game menu tutorial, don't show regular tutorial
        setIsVisible(false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userData, pathname, router, updateTutorialStep, rightSideBarOpen, isMobile]);

  // No tooltip positioning logic needed anymore

  // Helper function to update the highlight position
  const updateHighlightPosition = (currentStepConfig: TutorialStepConfig) => {
    // Use our helper function to find the element
    const highlightInfo = findElementToHighlight(
      {
        ...currentStepConfig,
        elementId: currentStepConfig.elementId,
      },
      rightSideBarRef,
      rightSideBarOpen,
    );

    if (highlightInfo) {
      setHighlight({
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

  // Update highlight position based on current step and element
  useEffect(() => {
    if (!isVisible) return;

    const step = TUTORIAL_STEPS[currentStep];

    // Guard against undefined step
    if (!step) {
      setHighlight(null);
      return;
    }

    // If we're not on the correct page for this step, don't try to highlight
    if (pathname !== step.page) {
      return;
    }

    // Initial position calculation
    updateHighlightPosition(step);

    // Set up a more frequent interval for smoother updates (100ms)
    const intervalId = setInterval(() => {
      updateHighlightPosition(step);
    }, 100);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep, isVisible, pathname]);

  // Handle next step
  const handleNextStep = useCallback(() => {
    setCurrentStep((prevStep) => {
      const nextStep = prevStep + 1;

      // Update the user's tutorial step in the database
      updateTutorialStep.mutate({ step: nextStep });

      // If we've reached the end of the tutorial, hide it
      if (nextStep >= TUTORIAL_STEPS.length) {
        setIsVisible(false);
        return prevStep; // Return current step since we're hiding the tutorial
      }

      return nextStep;
    });
  }, [updateTutorialStep, setIsVisible]);

  // Add keyboard event listener for Enter and ArrowLeft keys to forward tutorial
  useEffect(() => {
    // Only add keyboard listener when tutorial is visible (either regular or game menu)
    if (!isVisible && !showGameMenuTutorial) return;

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
  }, [isVisible, showGameMenuTutorial, handleNextStep, setRightSideBarOpen]);

  // Removed skip tutorial handler as part of simplifying flow

  // Render Game Menu tutorial (with bottom-right assistant)
  const renderGameMenuTutorial = () => {
    const gameBtnHighlight = findElementToHighlight(
      {
        elementId: "tutorial-gameBtn",
        title: "Game Menu",
        description:
          "Click this button to open the game menu and continue the tutorial.",
        page: pathname,
      },
      rightSideBarRef,
      rightSideBarOpen,
    );

    if (gameBtnHighlight) {
      return (
        <div className="fixed inset-0 z-60">
          {/* Dim background */}
          <div className="absolute inset-0 bg-black/30" />

          {/* Hole highlight over the game button */}
          <div
            className="absolute bg-transparent shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]"
            style={{
              top: gameBtnHighlight.top - 10,
              left: gameBtnHighlight.left - 10,
              width: gameBtnHighlight.width + 20,
              height: gameBtnHighlight.height + 20,
            }}
          >
            <div className="absolute inset-0 border-3 border-amber-400 rounded-md animate-pulse shadow-[0_0_15px_rgba(245,158,11,0.7)] z-[1]">
              {/* Allow clicking to open the menu */}
              <div
                className="absolute inset-0 cursor-pointer z-[2] pointer-events-auto"
                onClick={() => setRightSideBarOpen(true)}
              />
            </div>
          </div>

          {/* Hand pointer near the highlighted button */}
          <img
            src={IMG_URL_HANDPOINTER}
            alt="Tap here"
            className="absolute w-10 h-10 animate-bounce"
            style={{
              top: Math.max(0, gameBtnHighlight.top + gameBtnHighlight.height + 12),
              left: Math.min(
                window.innerWidth - 40,
                gameBtnHighlight.left + gameBtnHighlight.width / 2 - 20,
              ),
            }}
          />

          {/* Assistant panel bottom-right - large, game-like dialog */}
          <div className="fixed bottom-4 right-4 md:bottom-6 md:right-6 z-60 pointer-events-auto">
            <div className="relative">
              {/* Assistant portrait positioned behind and above the dialog (top-right) */}
              <img
                src={IMG_URL_ASSISTANT}
                alt="Assistant"
                className="absolute -top-14 -right-4 md:-top-20 md:-right-6 h-28 md:h-48 w-auto object-contain drop-shadow-2xl select-none pointer-events-none z-0"
              />
              {/* Foreground content */}
              <div className="relative z-10">
                {/* Nameplate */}
                <div className="absolute -top-6 left-8 px-4 py-1 rounded-md bg-amber-700 text-amber-50 shadow-lg uppercase tracking-wider text-sm">
                  Game Menu
                </div>
                {/* Speech panel */}
                <div className="bg-[rgba(255,252,235,0.95)] text-foreground rounded-xl border-2 border-amber-700 shadow-2xl w-[90vw] md:w-[560px] p-4 md:p-5">
                  <p className="text-sm md:text-base leading-relaxed">
                    Click the highlighted button to open the game menu and continue the
                    tutorial.
                  </p>
                  <div className="mt-3 md:mt-4 flex justify-end gap-2">
                    <Button size="lg" onClick={() => setRightSideBarOpen(true)}>
                      Open Menu <ArrowRight className="ml-2 h-4 md:h-5 w-4 md:w-5" />
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      );
    }

    // Fallback dialog if button not found
    return (
      <Dialog open={true}>
        <DialogContent className="sm:max-w-md z-60">
          <DialogHeader>
            <DialogTitle>Continue the Tutorial</DialogTitle>
            <DialogDescription>
              Please click on the circular button in the top right corner to open the
              game menu and continue the tutorial.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-between mt-4">
            <Button onClick={() => setRightSideBarOpen(true)}>Open Menu</Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  };

  // If showing the special Game Menu tutorial
  if (showGameMenuTutorial) {
    return renderGameMenuTutorial();
  }

  // If the regular tutorial is not visible, don't render anything
  if (!isVisible) return null;

  const currentTutorialStep = TUTORIAL_STEPS[currentStep];

  // Guard against undefined currentTutorialStep
  if (!currentTutorialStep) return null;

  const isOnCorrectPage = pathname === currentTutorialStep.page;

  // If we're not on the correct page, show a dialog to navigate there
  if (!isOnCorrectPage) {
    return (
      <Dialog open={true} onOpenChange={() => setIsVisible(true)}>
        <DialogContent className="sm:max-w-md z-60">
          <DialogHeader>
            <DialogTitle>Continue the Tutorial</DialogTitle>
            <DialogDescription>
              You need to navigate to the {currentTutorialStep.page} page to continue
              the tutorial.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-between mt-4">
            <Button onClick={() => router.push(currentTutorialStep.page)}>
              Go to {currentTutorialStep.page}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // Missing-element dialog removed

  // Render the tutorial overlay with highlight and assistant panel
  return (
    <>
      {highlight && (
        <div className="fixed inset-0 z-60 pointer-events-none">
          <div className="absolute inset-0 bg-black/30 min-h-[2000px]" />

          <div
            className="absolute bg-transparent shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]"
            style={{
              top: highlight.top - 10,
              left: highlight.left - 10,
              width: highlight.width + 20,
              height: highlight.height + 20,
            }}
          >
            <div className="absolute inset-0 border-3 border-amber-400 rounded-md animate-pulse shadow-[0_0_15px_rgba(245,158,11,0.7)] z-[1]">
              <div className="absolute inset-0 cursor-pointer z-[2]" />
            </div>
          </div>

          {/* Hand pointer if this step highlights a clickable element */}
          {currentTutorialStep.elementId && (
            <img
              src={IMG_URL_HANDPOINTER}
              alt="Tap here"
              className="absolute w-10 h-10 animate-bounce"
              style={{
                top: Math.max(0, highlight.top + highlight.height + 12),
                left: Math.min(
                  window.innerWidth - 40,
                  highlight.left + highlight.width / 2 - 20,
                ),
              }}
            />
          )}
        </div>
      )}

      {/* Assistant panel bottom-right - large, game-like dialog */}
      <div className="fixed bottom-4 right-4 md:bottom-6 md:right-6 z-60 pointer-events-auto">
        <div className="relative">
          {/* Assistant portrait positioned behind and above the dialog (top-right) */}
          <Image
            src={IMG_URL_ASSISTANT}
            width={100}
            height={100}
            alt="Assistant"
            className="absolute -top-38 -right-4 md:-top-48 md:-right-12 h-38 md:h-48 w-auto object-contain drop-shadow-2xl select-none pointer-events-none z-0"
          />
          {/* Foreground content */}
          <div className="relative z-10">
            {/* Nameplate */}
            <div className="absolute -top-6 left-8 px-4 py-1 rounded-md bg-amber-700 text-amber-50 shadow-lg uppercase tracking-wider text-xs md:text-sm">
              {currentTutorialStep.title}
            </div>
            {/* Speech panel */}
            <div className="bg-[rgba(255,252,235,0.95)] text-foreground rounded-xl border-2 border-amber-700 shadow-2xl w-[90vw] md:w-[560px] p-4 md:p-5">
              <p className="text-sm md:text-base leading-relaxed">
                {currentTutorialStep.description}
              </p>
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
              <div className="mt-3 md:mt-4 flex justify-end gap-2">
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
                  {currentStep === TUTORIAL_STEPS.length - 1 ? "Finish" : "Next"}
                  <ArrowRight className="ml-2 h-4 md:h-5 w-4 md:w-5" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default TutorialAssistant;

// Helper function to find element to highlight based on current tutorial step
const findElementToHighlight = (
  step: TutorialStep,
  rightSideBarRef: React.RefObject<HTMLDivElement | null>,
  rightSideBarOpen: boolean,
) => {
  if (!step?.elementId) return null;

  // Try to find by ID first - most reliable
  let element: HTMLElement | null = document.getElementById(step.elementId);

  // Check within the rightSideBarRef if available and open
  const sidebarElement = rightSideBarRef.current;
  if (sidebarElement && rightSideBarOpen && step.requiresGameMenu) {
    // Try exact match first
    const exactMatch = sidebarElement.querySelector<HTMLElement>(`#${step.elementId}`);
    if (exactMatch) {
      element = exactMatch;
    } else if (step.elementId) {
      // If no exact match, try partial match
      const allElements = Array.from(
        sidebarElement.querySelectorAll<HTMLElement>("[id]"),
      );
      const partialMatch = allElements.find((el) => {
        const id = el.id;
        return id
          ? id.includes(step?.elementId?.replace("tutorial-", "") || "")
          : false;
      });
      if (partialMatch) {
        element = partialMatch;
      }
    }
  }

  if (!element) return null;

  // Get element position - getBoundingClientRect() gives viewport coordinates
  const rect = element.getBoundingClientRect();

  // Return the element reference along with its dimensions
  return {
    element,
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  };
};
