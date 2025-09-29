"use client";

import React, { useState, useEffect } from "react";
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
import { IMG_URL_ASSISTANT, IMG_URL_HANDPOINTER } from "@/drizzle/constants";
import { TUTORIAL_STEPS, useTutorialStep } from "@/hooks/tutorial";
import { cn } from "src/libs/shadui";
import type { TutorialStepConfig } from "@/hooks/tutorial";

/**
 * Reusable assistant portrait with correct styling
 * @returns
 */
const AssistantPortrait: React.FC = () => (
  <Image
    src={IMG_URL_ASSISTANT}
    width={100}
    height={100}
    alt="Assistant"
    className="absolute -top-38 right-0 md:-top-48 h-38 md:h-48 w-auto object-contain drop-shadow-2xl select-none pointer-events-none z-0"
  />
);

/**
 * Reusable assistant dialog (uses the latter, correct styling)
 * @param title - The title of the dialog
 * @param children - The content of the dialog
 * @returns
 */
const AssistantDialog: React.FC<{
  title: string;
  children: React.ReactNode;
}> = ({ title, children }) => (
  <div className="fixed bottom-4 right-4 md:bottom-6 md:right-6 z-60 pointer-events-auto">
    <div className="relative">
      {/* Assistant portrait positioned behind and above the dialog (top-right) */}
      <AssistantPortrait />
      {/* Foreground content */}
      <div className="relative z-10">
        {/* Nameplate */}
        <div className="absolute -top-6 left-8 px-4 py-1 rounded-md bg-primary text-primary-foreground shadow-lg uppercase tracking-wider text-xs md:text-sm">
          {title}
        </div>
        {/* Speech panel */}
        <div className="bg-card text-foreground rounded-xl border-2 border-primary shadow-2xl w-[80vw] md:w-[560px] p-4 md:p-5">
          {children}
        </div>
      </div>
    </div>
  </div>
);

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

  // Tutorial management hook
  const {
    updateTutorialStep,
    handleNextStep,
    currentStepNumber,
    setCurrentStepNumber,
    isAssistantVisible,
    setIsAssistantVisible,
  } = useTutorialStep();

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

      setCurrentStepNumber(tutorialStep);

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
          router.push(currentStepConfig.page);
        }
      } else {
        // If showing game menu tutorial, don't show regular tutorial
        setIsAssistantVisible(false);
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
    if (!isAssistantVisible) return;

    const step = TUTORIAL_STEPS[currentStepNumber];

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
  }, [currentStepNumber, isAssistantVisible, pathname]);

  // Add keyboard event listener for Enter and ArrowLeft keys to forward tutorial
  useEffect(() => {
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
  }, [isAssistantVisible, showGameMenuTutorial, handleNextStep, setRightSideBarOpen]);

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
          <Image
            src={IMG_URL_HANDPOINTER}
            alt="Tap here"
            className="absolute w-18 h-18 animate-bounce"
            width={80}
            height={80}
            style={{
              top: Math.max(0, gameBtnHighlight.top + gameBtnHighlight.height + 12),
              left: Math.min(
                window.innerWidth - 40,
                gameBtnHighlight.left + gameBtnHighlight.width / 2 - 20,
              ),
            }}
          />

          {/* Assistant panel bottom-right - large, game-like dialog */}
          <AssistantDialog title="Game Menu">
            <p className="text-sm md:text-base leading-relaxed">
              Click the highlighted button to open the game menu and continue the
              tutorial.
            </p>
            <div className="mt-3 md:mt-4 flex justify-end gap-2">
              <Button size="lg" onClick={() => setRightSideBarOpen(true)}>
                Open Menu <ArrowRight className="ml-2 h-4 md:h-5 w-4 md:w-5" />
              </Button>
            </div>
          </AssistantDialog>
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
  if (!isAssistantVisible) return null;

  const currentTutorialStep = TUTORIAL_STEPS[currentStepNumber];

  // Guard against undefined currentTutorialStep
  if (!currentTutorialStep) return null;

  const isOnCorrectPage = pathname === currentTutorialStep.page;

  // If we're not on the correct page, show a dialog to navigate there
  if (!isOnCorrectPage) {
    return (
      <Dialog open={true} onOpenChange={() => setIsAssistantVisible(true)}>
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

  // Derived
  const pointerEvents = currentTutorialStep.proceedOnHighlightClick
    ? "pointer-events-none"
    : "pointer-events-auto";

  // Render the tutorial overlay with highlight and assistant panel
  return (
    <>
      {highlight && (
        <div className={cn("fixed inset-0 z-60", pointerEvents)}>
          <div className="absolute inset-0 bg-black/30 min-h-[2000px]" />

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
            <div className="absolute inset-0 border-3 border-amber-400 rounded-md animate-pulse shadow-[0_0_15px_rgba(245,158,11,0.7)] z-[1]">
              <div
                className={cn("absolute inset-0 cursor-pointer z-[2]", pointerEvents)}
                role="button"
                aria-label="Continue tutorial"
                onClick={() => {
                  if (currentTutorialStep.proceedOnHighlightClick) {
                    handleNextStep();
                  }
                }}
                onTouchStart={(e) => {
                  if (currentTutorialStep.proceedOnHighlightClick) {
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
          {currentTutorialStep.elementId && (
            <Image
              src={IMG_URL_HANDPOINTER}
              alt="Tap here"
              className="absolute w-18 h-18 animate-bounce"
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
          )}
        </div>
      )}

      {/* Assistant panel bottom-right - large, game-like dialog */}
      <AssistantDialog title={currentTutorialStep.title}>
        <p className="text-sm md:text-base leading-relaxed">
          {currentTutorialStep.description}
        </p>
        {currentTutorialStep.externalLink && (
          <div className="mt-3">
            <Button
              className="w-full"
              variant="outline"
              size="sm"
              onClick={() => window.open(currentTutorialStep.externalLink, "_blank")}
            >
              Read Getting Started Guide
            </Button>
          </div>
        )}
        {currentTutorialStep?.showNextButton && (
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
              {currentStepNumber === TUTORIAL_STEPS.length - 1 ? "Finish" : "Next"}
              <ArrowRight className="ml-2 h-4 md:h-5 w-4 md:w-5" />
            </Button>
          </div>
        )}
      </AssistantDialog>
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
