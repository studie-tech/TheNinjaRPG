"use client";

import { ArrowRight, Info } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/libs/shadui";
import { getMobileOperatingSystem } from "@/utils/hardware";
import { useUserData } from "@/utils/UserContext";

interface TutorialStepConfig {
  title: string;
  description: string | React.ReactNode;
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
      "Before starting we will quickly go through basic controls and features. This is your main profile where all your overall progress can be viewed.",
    elementId: "tutorial-profile",
    page: "/profile",
    requiresGameMenu: false,
  },
  {
    title: "Strengths & Weaknesses",
    description:
      "In this next section of the profile you can view the specifics of your character, your stats, strengths and weaknesses.",
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

interface TutorialProps {
  rightSideBarOpen: boolean;
  setRightSideBarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  rightSideBarRef: React.RefObject<HTMLDivElement | null>;
}

const Tutorial: React.FC<TutorialProps> = ({
  rightSideBarOpen,
  setRightSideBarOpen,
  rightSideBarRef,
}) => {
  // State
  const { data: userData, userAgent, updateUser } = useUserData();
  const pathname = usePathname();
  const router = useRouter();
  const tutorialRef = useRef<HTMLDivElement>(null);
  const [currentStep, setCurrentStep] = useState<number>(0);
  const [isVisible, setIsVisible] = useState<boolean>(false);
  const [tooltipPosition, setTooltipPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const [highlight, setHighlight] = useState<{
    top: number;
    left: number;
    width: number;
    height: number;
  } | null>(null);
  const [showMissingElementDialog, setShowMissingElementDialog] =
    useState<boolean>(false);

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
  }, [userData, pathname, router, updateTutorialStep, rightSideBarOpen, isMobile]);

  // Effect to calculate tooltip position after it's rendered and we know its height
  useEffect(() => {
    if (highlight && tutorialRef.current) {
      const tooltipHeight = tutorialRef.current.offsetHeight;

      const left =
        highlight.left < 128
          ? highlight.left
          : highlight.left + highlight.width > window.innerWidth
            ? highlight.left - highlight.width
            : highlight.left + highlight.width / 2 - 128;

      let top =
        highlight.top < tooltipHeight
          ? highlight.top + highlight.height + 15
          : highlight.top - tooltipHeight - 15;

      top =
        top > window.innerHeight - tooltipHeight
          ? window.innerHeight - tooltipHeight
          : top;

      // console.log("top", top, windowHeight);

      setTooltipPosition({ top, left });
    }
  }, [highlight]);

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
      setShowMissingElementDialog(false);
    } else {
      setHighlight(null);
      // Only show the dialog if we're looking for a specific element
      if (currentStepConfig.elementId) {
        setShowMissingElementDialog(true);
      }
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

  // Handle skipping tutorial
  const handleSkipTutorial = () => {
    updateTutorialStep.mutate({ step: TUTORIAL_STEPS.length });
    setIsVisible(false);
    setShowGameMenuTutorial(false);
  };

  // Render Game Menu tutorial
  const renderGameMenuTutorial = () => {
    // Find the game button to highlight
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

    // If we found the game button, show a tooltip-style highlight
    if (gameBtnHighlight) {
      return (
        <div className="fixed inset-0 z-60">
          {/* Semi-transparent overlay with a hole for the game button */}
          <div className="absolute inset-0 bg-black/30" />

          {/* Create a "hole" in the overlay for the game button */}
          <div
            className="absolute bg-transparent shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]"
            style={{
              top: gameBtnHighlight.top - 10,
              left: gameBtnHighlight.left - 10,
              width: gameBtnHighlight.width + 20,
              height: gameBtnHighlight.height + 20,
            }}
          >
            {/* Pulsing border effect */}
            <div className="absolute inset-0 z-[1] animate-pulse rounded-md border-3 border-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.7)]">
              {/* Make the game button clickable through the overlay */}
              <button
                type="button"
                className="absolute inset-0 z-[2] cursor-pointer"
                onClick={() => setRightSideBarOpen(true)}
                aria-label="Open game menu"
              />
            </div>
          </div>

          {/* Tutorial tooltip below the game button */}
          <div
            className="absolute w-64 rounded-lg bg-card p-4 shadow-lg"
            style={{
              top: gameBtnHighlight.top + gameBtnHighlight.height + 15,
              left: isMobile
                ? gameBtnHighlight.left + gameBtnHighlight.width / 2 - 128 - 30 // Move 30px left on mobile
                : gameBtnHighlight.left + gameBtnHighlight.width / 2 - 128, // Regular positioning on desktop
            }}
          >
            {/* Arrow pointing up to the game button */}
            <div
              className="absolute h-5 w-5 rotate-45 transform border-2 border-amber-400 border-t-0 border-l-0 bg-card"
              style={{
                top: "-8px",
                left: isMobile
                  ? "calc(50% - 5px + 30px)" // Adjust arrow position on mobile to account for the 30px shift
                  : "calc(50% - 5px)", // Regular positioning on desktop
                boxShadow: "0 0 5px rgba(0,0,0,0.2)",
                zIndex: 10,
              }}
            ></div>
            <div className="mb-2 flex items-center gap-2">
              <Info className="h-5 w-5 text-primary" />
              <h3 className="font-bold text-lg">Game Menu</h3>
            </div>
            <p className="mb-4 text-sm">
              Click this button to open the game menu and continue the tutorial.
            </p>
            <div className="flex justify-between">
              <Button variant="outline" size="sm" onClick={handleSkipTutorial}>
                Skip Tutorial
              </Button>
              <Button size="sm" onClick={() => setRightSideBarOpen(true)}>
                Open Menu <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      );
    }

    // Fallback to dialog if we couldn't find the game button
    return (
      <Dialog open={true}>
        <DialogContent className="z-60 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Continue the Tutorial</DialogTitle>
            <DialogDescription>
              Please click on the circular button in the top right corner to open the
              game menu and continue the tutorial.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 flex justify-between">
            <Button variant="outline" onClick={handleSkipTutorial}>
              Skip Tutorial
            </Button>
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
        <DialogContent className="z-60 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Continue the Tutorial</DialogTitle>
            <DialogDescription>
              You need to navigate to the {currentTutorialStep.page} page to continue
              the tutorial.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 flex justify-between">
            <Button variant="outline" onClick={handleSkipTutorial}>
              Skip Tutorial
            </Button>
            <Button onClick={() => router.push(currentTutorialStep.page)}>
              Go to {currentTutorialStep.page}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // Show dialog when element is not found
  if (showMissingElementDialog) {
    return (
      <Dialog open={true} onOpenChange={() => setShowMissingElementDialog(false)}>
        <DialogContent className="z-60 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Element Not Found</DialogTitle>
            <DialogDescription>
              The tutorial element &quot;{currentTutorialStep.title}&quot; could not be
              found on the page. This might be due to a loading delay or the element may
              have been moved.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 flex justify-between">
            <Button variant="outline" onClick={handleSkipTutorial}>
              End Tutorial
            </Button>
            <Button onClick={handleNextStep}>Skip to Next Step</Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // Render the tutorial overlay with highlight
  return (
    <>
      {/* Fixed position container to hold all tutorial UI elements */}
      {highlight && (
        <div className="pointer-events-none fixed inset-0 z-60">
          {/* Semi-transparent overlay with a hole for the highlighted element */}
          <div className="absolute inset-0 min-h-[2000px] bg-black/30" />

          {/* Create a "hole" in the overlay by masking the area where the element is */}
          <div
            className="absolute bg-transparent shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]"
            style={{
              top: highlight.top - 10,
              left: highlight.left - 10,
              width: highlight.width + 20,
              height: highlight.height + 20,
            }}
          >
            {/* This div creates the pulsing border effect */}
            <div className="absolute inset-0 z-[1] animate-pulse rounded-md border-3 border-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.7)]">
              {/* This empty div ensures the highlighted element can be clicked */}
              <div className="absolute inset-0 z-[2] cursor-pointer" />
            </div>
          </div>

          {/* Tutorial tooltip positioned relative to the highlighted element */}
          <div
            ref={tutorialRef}
            className="absolute w-64 rounded-lg bg-card p-4 shadow-lg"
            style={{
              visibility: tooltipPosition ? "visible" : "hidden",
              ...(tooltipPosition && {
                top: tooltipPosition.top,
                left: tooltipPosition.left,
              }),
            }}
          >
            {/* Add connecting arrow based on position */}
            {tooltipPosition && (
              <div
                className={cn(
                  "absolute h-5 w-5 rotate-45 transform border-2 border-amber-400 bg-card",
                  {
                    "border-t-0 border-l-0": tooltipPosition.top > highlight.top, // For below, show top-left corner (arrow points up)
                    "border-r-0 border-b-0": tooltipPosition.top < highlight.top, // For above, show bottom-right corner (arrow points down)
                  },
                )}
                style={{
                  top:
                    tooltipPosition.top > highlight.top ? "-8px" : "calc(100% - 8px)",
                  left: "calc(50%)",
                  boxShadow: "0 0 5px rgba(0,0,0,0.2)",
                  zIndex: 10,
                }}
              />
            )}
            <div className="mb-2 flex items-center gap-2">
              <Info className="h-5 w-5 text-primary" />
              <h3 className="font-bold text-lg">{currentTutorialStep.title}</h3>
            </div>
            {typeof currentTutorialStep.description === "string" ? (
              <p className="mb-4 text-sm">{currentTutorialStep.description}</p>
            ) : (
              <div className="mb-4 text-sm">{currentTutorialStep.description}</div>
            )}
            {currentTutorialStep.externalLink && (
              <Button
                className="pointer-events-auto mb-2 w-full"
                variant="outline"
                size="sm"
                onClick={() => window.open(currentTutorialStep.externalLink, "_blank")}
              >
                Read Getting Started Guide
              </Button>
            )}
            <div className="flex justify-between">
              <Button
                className="pointer-events-auto"
                variant="outline"
                size="sm"
                onClick={handleSkipTutorial}
              >
                Skip Tutorial
              </Button>
              <Button
                className="pointer-events-auto"
                size="sm"
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
                {currentStep === TUTORIAL_STEPS.length - 1 ? "Finish" : "Next"}{" "}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default Tutorial;

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
