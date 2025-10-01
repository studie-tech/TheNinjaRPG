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
import { COMBAT_SECONDS } from "@/libs/combat/constants";
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
    description:
      "This is the battlefield, where you can see your character and opponent(s). ",
    elementId: "tutorial-combat-field",
    page: "/combat",
    showNextButton: true,
    proceedOnHighlightClick: true,
  },
  {
    title: "Battle Arena",
    description: `Combat is based on rounds, where during your round you have ${COMBAT_SECONDS} seconds to perform your actions, and then it's your opponent's turn. You can see your action points and the time left for your round here.`,
    elementId: "tutorial-combat-action-timer",
    page: "/combat",
    showNextButton: true,
    proceedOnHighlightClick: true,
  },
  {
    title: "Battle Arena",
    description: `Below the battlefield you see your available actions. The basic attack is the default action you can use to hit your opponent. Don't worry, you'll get powerful weapons and jutsus soon.`,
    elementId: "tutorial-combat-action-basicAttack",
    page: "/combat",
    showNextButton: true,
    proceedOnHighlightClick: true,
  },
  {
    title: "Battle Arena",
    description:
      "Before you can attack, you'll have to move closer to your opponent. Chose the movement action here. ",
    elementId: "tutorial-combat-action-move",
    page: "/combat",
    proceedOnHighlightClick: true,
  },
  {
    title: "Battle Arena",
    description:
      "Move closer to your opponent, and beat it up with your basic attack. ",
    page: "/combat",
    proceedOnHighlightClick: true,
  },
  {
    title: "Training",
    elementId: "tutorial-traininggrounds",
    description:
      "Awesome, that was your first battle. A little boring, maybe, but don't worry, it'll get a lot more interesting as you get advanced jutsus and weapons. In matter of fact, let's go train your character a bit and get a new jutsu.",
    page: "/village",
    proceedOnHighlightClick: true,
  },
  {
    title: "Training",
    elementId: "tutorial-traininggrounds-taijutsuoffence",
    description:
      "Welcome to the training grounds. Here you can either train some of your basic stats, or train a new jutsu to use in battle. Let's start out by doing a bit of offensive taijutsu training, making your attacks more powerful.",
    page: "/traininggrounds",
  },
  {
    title: "Training",
    elementId: "tutorial-traininggrounds-stopTraining",
    description:
      "Training takes a bit of time, but you can stop any time you want. The most efficent way to train is bouts out 15min at a time - if you're squeezed on time, however, there are also options to train your character for 24 hours at a time. End your training when you're ready, then we'll go train a jutsu!",
    page: "/traininggrounds",
  },
  {
    title: "Training",
    elementId: "tutorial-traininggrounds-stopTraining",
    description: "Time to train a jutsu.",
    page: "/traininggrounds",
  },
  {
    title: "That's it for now!",
    description:
      "That's it for the tutorial, you can now start playing the game! You can find further information on how to play the game at this link",
    elementId: "tutorial-logo",
    page: "/academy",
    externalLink: "https://the-ninja-rpg.fandom.com/wiki/Getting_Started",
    showNextButton: true,
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
  const { mutate: updateTutorialStep, isPending } =
    api.profile.updateTutorialStep.useMutation({
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

  useEffect(() => {
    if (userData?.tutorialStep) {
      setCurrentStepNumber(userData.tutorialStep);
    }
  }, [userData?.tutorialStep]);

  // Handle next step
  const handleNextStep = useCallback(
    (forceStep?: number) => {
      setCurrentStepNumber((prevStep) => {
        const nextStep = forceStep ? forceStep : prevStep + 1;

        // Update the user's tutorial step in the database
        if (!isPending && nextStep !== stepNumber) {
          updateTutorialStep({ step: nextStep });
        }

        // If we've reached the end of the tutorial, hide it
        if (nextStep >= TUTORIAL_STEPS.length) {
          setIsAssistantVisible(false);
          return prevStep; // Return current step since we're hiding the tutorial
        }

        return nextStep;
      });
    },
    [updateTutorialStep, setIsAssistantVisible],
  );

  // Return
  return {
    stepNumber,
    currentStep,
    updateTutorialStep,
    handleNextStep,
    currentStepNumber,
    isAssistantVisible,
    setIsAssistantVisible,
  };
};
