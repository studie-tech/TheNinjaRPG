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

export interface TutorialStepConfig {
  title: string;
  description: string;
  elementId?: string;
  page: string;
  showNextButton?: boolean;
  proceedOnHighlightClick?: boolean;
  requiresGameMenu?: boolean;
  externalLink?: string;
}

export const TUTORIAL_STEPS: TutorialStepConfig[] = [
  // Profile page steps - main menu buttons

  {
    title: "Welcome to the game",
    description:
      "Welcome to The Ninja-Rpg! I'm Lemu and I'll be guiding you through the early stages of your development here at the academy. Before starting we will quickly go through basic controls and features. This is your main profile where all your overall progress can be viewed.",
    elementId: "tutorial-profile",
    page: "/profile",
    requiresGameMenu: false,
    showNextButton: true,
  },
  {
    title: "Strengths & Weaknesses",
    description:
      "In this section of the profile you can view the specifics of your character, your stats, strengths and weaknesses. Kinda weak right now, but we'll get you stronger. Let's go the the battle arena to train a bit. ",
    elementId: "tutorial-strength-weaknesses",
    page: "/profile",
    requiresGameMenu: false,
    showNextButton: true,
  },
  {
    title: "Village",
    description:
      "The location Menu is the heart of your village, this is where you can access all your village has to offer from Trainings to the black-market, to taking Missions to buying Ramen. You can also view your village Notice board here as well. Let's click it to go to the battle arena.",
    elementId: "tutorial-village",
    page: "/profile",
    proceedOnHighlightClick: true,
    requiresGameMenu: true,
  },

  {
    title: "Battle Arena",
    description:
      "We're going to the battle arena, where you can test your skills against NPCs. Let's go there now.",
    elementId: "tutorial-battlearena",
    page: "/village",
    proceedOnHighlightClick: true,
  },
  {
    title: "Start Arena Match",
    description:
      "Here we are! In the top right corner, you can chose from various arena options, e.g. sparring, ranked PvP, Battle pyramid, etc. Right now, we're simply going to challenge the training dummy in the arena to see how strong you are.",
    elementId: "tutorial-battlearena-challenge-ai-enter",
    page: "/battlearena",
  },
  {
    title: "Battle Arena",
    description: "Time to battle",
    elementId: "tutorial-battlearena-challenge-ai-enter",
    page: "/combat",
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

/**
 * Hook to get the current tutorial step
 * @returns
 */
export const useTutorialStep = () => {
  // State
  const { data: userData, updateUser } = useUserData();
  const pathname = usePathname();
  const router = useRouter();
  const [currentStepNumber, setCurrentStepNumber] = useState<number>(0);
  const [isAssistantVisible, setIsAssistantVisible] = useState<boolean>(false);

  // Derived
  const stepNumber = userData?.tutorialStep || 0;
  const currentStep = TUTORIAL_STEPS?.[stepNumber];

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

  // Handle next step
  const handleNextStep = useCallback(() => {
    setCurrentStepNumber((prevStep) => {
      const nextStep = prevStep + 1;

      // Update the user's tutorial step in the database
      updateTutorialStep.mutate({ step: nextStep });

      // If we've reached the end of the tutorial, hide it
      if (nextStep >= TUTORIAL_STEPS.length) {
        setIsAssistantVisible(false);
        return prevStep; // Return current step since we're hiding the tutorial
      }

      return nextStep;
    });
  }, [updateTutorialStep, setIsAssistantVisible]);

  // Return
  return {
    currentStep,
    updateTutorialStep,
    handleNextStep,
    currentStepNumber,
    setCurrentStepNumber,
    isAssistantVisible,
    setIsAssistantVisible,
  };
};
