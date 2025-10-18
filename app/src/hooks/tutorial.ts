"use client";

import { useState, useEffect, useCallback } from "react";
import { useUserData } from "@/utils/UserContext";
import { usePathname, useRouter } from "next/navigation";
import { COMBAT_SECONDS } from "@/libs/combat/constants";
import { api } from "@/app/_trpc/client";
import {
  TUTORIAL_JUTSU_ID,
  TUTORIAL_ITEM_ID,
  TUTORIAL_STARTER_QUEST_ID,
} from "@/drizzle/constants";

export interface TutorialStepConfig {
  id: string;
  title: string;
  description: string;
  elementIds?: string[];
  page: string;
  hideDialog?: boolean;
  showNextButton?: boolean;
  proceedOnHighlightClick?: boolean;
  requiresGameMenu?: boolean;
  externalLink?: string;
  onCombatWin?: string;
  onCombatLoss?: string;
}

export const TUTORIAL_HOSPITALIZED_STEP: TutorialStepConfig = {
  id: "5uhDcTB1sMeGO_",
  title: "You are Hospitalized!",
  description:
    "You have been injured in battle and are currently hospitalized. I have re-directed you to the hospital. Please get yourself sorted out and then we'll get back to it",
  page: "/hospital",
  elementIds: ["tutorial-hospital-buttons"],
  showNextButton: false,
};

export const TUTORIAL_STEPS: TutorialStepConfig[] = [
  // Profile page steps - main menu buttons

  {
    id: "2XpCaDhi3elhVNLGssEjZ",
    title: "Welcome to the game",
    description:
      "Welcome to The Ninja-Rpg! I'm Lemu and I'll be guiding you through the early stages of your development here at the academy. Before starting we will quickly go through basic controls and features. This is your main profile where all your overall progress can be viewed.",
    elementIds: ["tutorial-profile"],
    page: "/profile",
    requiresGameMenu: false,
    showNextButton: true,
    proceedOnHighlightClick: true,
  },
  {
    id: "RiYke5IPcx6cN6ao1QA23",
    title: "Strengths & Weaknesses",
    description:
      "In this section of the profile you can view the specifics of your character, your stats, strengths and weaknesses. Kinda weak right now, but we'll get you stronger. Let's go the the battle arena to train a bit. ",
    elementIds: ["tutorial-strength-weaknesses"],
    page: "/profile",
    requiresGameMenu: false,
    showNextButton: true,
    proceedOnHighlightClick: true,
  },
  {
    id: "YP5PEaCvfhJfdsl37V",
    title: "Assigning Stats",
    description:
      "Naturally, having grown up in the ninja world, you already have some skills and abilities. Let's go assign some points to your stats.",
    elementIds: ["tutorial-unassigned-stats"],
    page: "/profile",
    proceedOnHighlightClick: true,
    requiresGameMenu: true,
  },
  {
    id: "YPfhJfdsl37V",
    title: "Assigning Stats",
    description:
      "You have 1000 points to assign freely to your stats. Feel free to assign to any stat of your liking - if in doubt, I'd recommend putting it all into strength. Sometimes completing missions or quests will give you experience points, which you can freely assign on this page.",
    elementIds: ["tutorial-unassigned-stats-contentbox"],
    page: "/profile/experience",
  },
  {
    id: "f34p798tfn0327",
    title: "Level Up!",
    description:
      "I knew it, you're far from our ordinary graduate. You're ready to level up! Let's do it.",
    elementIds: ["tutorial-level-up-modal-content", "tutorial-level-up-btn"],
    page: "/profile",
  },
  {
    id: "f34p798tfn0327",
    title: "Level Up!",
    description:
      "Hmm, I sense amazing power within you, I think you're already ready for another level up!",
    elementIds: ["tutorial-level-up-modal-content", "tutorial-level-up-btn"],
    page: "/profile",
  },
  {
    id: "YP5PEaCvfhJl37V",
    title: "Village",
    description:
      "The location Menu is the heart of your village, this is where you can access all your village has to offer from Trainings to the black-market, to taking Missions to buying Ramen. You can also view your village Notice board here as well. Let's click it to go to the battle arena.",
    elementIds: ["tutorial-village"],
    page: "/profile",
    proceedOnHighlightClick: true,
    requiresGameMenu: true,
  },

  {
    id: "1JShRbZwTTRQr",
    title: "Battle Arena",
    description:
      "We're going to the battle arena, where you can test your skills against NPCs. Let's go there now.",
    elementIds: ["tutorial-battlearena"],
    page: "/village",
    proceedOnHighlightClick: true,
  },
  {
    id: "w3eWC11tISZc0CUZ2tvYN",
    title: "Start Arena Match",
    description:
      "Here we are! In the top right corner, you can chose from various arena options, e.g. sparring, ranked PvP, Battle pyramid, etc. Right now, we're simply going to challenge the training dummy in the arena to see how strong you are.",
    elementIds: ["tutorial-battlearena-challenge-ai-enter"],
    page: "/battlearena",
  },
  {
    id: "NASO2bE1zEQcc",
    title: "Battle Arena",
    description:
      "This is the battlefield, where you can see your character and opponent(s). ",
    elementIds: ["tutorial-combat-field"],
    page: "/combat",
    onCombatLoss: "w3eWC11tISZc0CUZ2tvYN",
    onCombatWin: "PCaQdWoDFuR0VGUq5c_ab",
    showNextButton: true,
    proceedOnHighlightClick: true,
  },
  {
    id: "Qz0sQcQLjTdlv",
    title: "Battle Arena",
    description: `Combat is based on rounds, where during your round you have ${COMBAT_SECONDS} seconds to perform your actions, and then it's your opponent's turn. You can see your action points and the time left for your round here.`,
    elementIds: ["tutorial-combat-action-timer"],
    page: "/combat",
    onCombatLoss: "w3eWC11tISZc0CUZ2tvYN",
    onCombatWin: "PCaQdWoDFuR0VGUq5c_ab",
    showNextButton: true,
    proceedOnHighlightClick: true,
  },
  {
    id: "RzahgsmGgfoNbLEcnQJsD",
    title: "Battle Arena",
    description: `Below the battlefield you see your available actions. The basic attack is the default action you can use to hit your opponent. Don't worry, you'll get powerful weapons and jutsus soon.`,
    elementIds: ["tutorial-combat-action-basicAttack"],
    page: "/combat",
    onCombatLoss: "w3eWC11tISZc0CUZ2tvYN",
    onCombatWin: "PCaQdWoDFuR0VGUq5c_ab",
    showNextButton: true,
    proceedOnHighlightClick: true,
  },
  {
    id: "xPnHsTPYULb",
    title: "Battle Arena",
    description:
      "Before you can attack, you'll have to move closer to your opponent. Chose the movement action here. ",
    elementIds: ["tutorial-combat-action-move"],
    page: "/combat",
    onCombatLoss: "w3eWC11tISZc0CUZ2tvYN",
    onCombatWin: "PCaQdWoDFuR0VGUq5c_ab",
    proceedOnHighlightClick: true,
  },
  {
    id: "bRelJfsU9wuHNmhUSg0db",
    title: "Battle Arena",
    description:
      "Move closer to your opponent, and beat it up with your basic attack. ",
    page: "/combat",
    onCombatLoss: "w3eWC11tISZc0CUZ2tvYN",
    onCombatWin: "PCaQdWoDFuR0VGUq5c_ab",
  },
  {
    id: "PCaQdWoDFuR0VGUq5c_ab",
    title: "Training",
    elementIds: ["tutorial-traininggrounds"],
    description:
      "Awesome, that was your first battle. A little boring, maybe, but don't worry, it'll get a lot more interesting as you get advanced jutsus and weapons. In matter of fact, let's go train your character a bit and get a new jutsu.",
    page: "/village",
    proceedOnHighlightClick: true,
  },
  {
    id: "OGLXpIqVbb0hPWtJ00LzT",
    title: "Training",
    elementIds: ["tutorial-traininggrounds-taijutsuoffence"],
    description:
      "Welcome to the training grounds. Here you can either train some of your basic stats, or train a new jutsu to use in battle. Let's start out by doing a bit of offensive taijutsu training, making your attacks more powerful.",
    page: "/traininggrounds",
  },
  {
    id: "09RZadarkULsnPkbQUfzA",
    title: "Training",
    elementIds: ["tutorial-traininggrounds-stopTraining"],
    description:
      "Training takes a bit of time, but you can stop any time you want. The most efficent way to train is bouts out 15min at a time - if you're squeezed on time, however, there are also options to train your character for 24 hours at a time. End your training when you're ready, then we'll go train a jutsu!",
    page: "/traininggrounds",
  },
  {
    id: "eSBZJXRN_MCSYM90z3d5f",
    title: "Jutsu Training",
    elementIds: [
      "tutorial-traininggrounds-trainJutsu-proceed",
      `tutorial-combat-action-${TUTORIAL_JUTSU_ID}`,
    ],
    description:
      "Now that your character is a bit stronger, pick a jutsu from the list to train. The more you train and progress the more powerful jutsu will be available for you to train.",
    page: "/traininggrounds",
  },
  {
    id: "r2azv66f1YNtFW2gbldOd",
    title: "Jutsu Training",
    elementIds: ["tutorial-village"],
    description:
      "Training your character and acquiring new and more powerful jutsus is one way to be better prepared for battle. Training your jutsu will take a while, but let's not stay to wait. Let's go get you some better gear.",
    page: "/traininggrounds",
    requiresGameMenu: true,
    proceedOnHighlightClick: true,
  },
  {
    id: "lTgXEoGkIWxFh",
    title: "Item shop",
    elementIds: ["tutorial-itemshop"],
    description: "To purchase new items, you need to go to the itemshop.",
    page: "/village",
    proceedOnHighlightClick: true,
  },
  {
    id: "KvGkDox06od5iiFaGAzkM",
    title: "Item shop",
    elementIds: [
      "tutorial-itemshop-confirmPurchase-proceed",
      `tutorial-combat-action-${TUTORIAL_ITEM_ID}`,
    ],
    description: "Let's buy some shurikens, a good weapon to start with.",
    page: "/itemshop",
  },
  {
    id: "JeoGW2HFUESQdw2PlSRIg",
    title: "Mission Hall",
    elementIds: ["tutorial-missionhall"],
    description:
      "You are a lot stronger now, but there's still room for you to grow. A fundamental part of being a ninja is undertaking missions for your village. This is something you can do here at the mission hall.",
    page: "/village",
    proceedOnHighlightClick: true,
    showNextButton: true,
  },
  {
    id: "U04RvrqvvYaOcenOGKMDw",
    title: "Academy",
    elementIds: ["tutorial-academy"],
    description:
      "Wait, before we go to the mission hall, we should head to the academy. This is where I normally work as an instructor, and where we will guide you on your way to the next ninja rank of Genin. As a Genin, you will have access to more jutsus, more difficult missions, and much more. Let's go. ",
    page: "/village",
    proceedOnHighlightClick: true,
  },
  {
    id: "gaqwwlQAjB0b11DLsXMNE",
    title: "Academy Dialog Option",
    elementIds: [`logbook-entry-${TUTORIAL_STARTER_QUEST_ID}`, "tutorial-take-quest"],
    description: "",
    page: "/academy",
    hideDialog: true,
  },
  {
    id: "YP5PEaCvfhJfdsl37V",
    title: "Assigning Stats",
    description:
      "Wow, you're picking up things fast. You already acquired a substantial amount of additional XP. Let's go assign it.",
    elementIds: ["tutorial-unassigned-stats"],
    page: "/academy",
    proceedOnHighlightClick: true,
    requiresGameMenu: true,
  },
  {
    id: "YPfhJfdsl37V",
    title: "Assigning Stats",
    description:
      "Assign the obtained experience to the stat of your liking. A good ninja is well-rounded, so don't stress too much about which stat you assign it to yet.",
    elementIds: ["tutorial-unassigned-stats-contentbox"],
    page: "/profile/experience",
  },
  {
    id: "f34p798tfn0327",
    title: "Level Up!",
    description:
      "Another level up! Perfect, this will make our practise mission easier. Get your level, and then we head out of the village.",
    elementIds: ["tutorial-level-up-modal-content", "tutorial-level-up-btn"],
    page: "/profile",
  },

  {
    id: "f34p798tfn0327",
    title: "Level Up!",
    description:
      "Another level up! Perfect, this will make our practise mission easier. Get your level, and then we head out of the village.",
    elementIds: ["tutorial-level-up-modal-content", "tutorial-level-up-btn"],
    page: "/profile",
  },
  {
    id: "t1GFAMQyZuxQ7FyUX4",
    title: "Travel",
    description:
      "Your target for our first practise mission will be to go eliminate a target in a different sector, thereby moving outside the borders of the village. Let's go. Don't worry, for this first mission I will accompany you.",
    elementIds: ["tutorial-travel"],
    page: "/profile",
    proceedOnHighlightClick: true,
    requiresGameMenu: true,
  },
  {
    id: "hQCIFuJKJ",
    title: "Travel",
    elementIds: ["tutorial-travel-sector"],
    description:
      "This is our humble village, where you can travel and see other players live. ",
    page: "/travel",
    showNextButton: true,
    proceedOnHighlightClick: true,
  },
  {
    id: "qPx_xVsMAZY0t05thYgZj",
    title: "Travel",
    elementIds: [
      "tutorial-global-travel-proceed",
      "tutorial-global-map",
      "tutorial-Global",
    ],
    description:
      "For our mission, we need to travel to another sector, so let's go to the global map. Here you can see the entire world of Seichi. We are currently in the starting village of Horizon. To proceed, double tap on sector marked by the quest marker 📜 on the global map.",
    page: "/travel",
  },
  {
    id: "eRw6ObsRONhzY7AUMO3vm",
    title: "Capture Target",
    elementIds: ["tutorial-travel-sector"],
    description:
      "Time to track down our target - you need to track down a sad puppy which has gone missing. Careful, it may be aggressive, so we may have to fight it before we can bring it back to the village. Move in the sector to approach the target, and overpower it.",
    page: "/travel",
    onCombatLoss: "qPx_xVsMAZY0t05thYgZj",
    onCombatWin: "UD2jVibug6Y0yKLYGzA_N",
  },
  {
    id: "UD2jVibug6Y0yKLYGzA_N",
    title: "Travel",
    elementIds: [
      "tutorial-global-travel-proceed",
      "tutorial-global-map",
      "tutorial-Global",
    ],
    description:
      "Good job on capturing the puppy. Let's go back to the Horizon village and the academy. With what I've seen, I think you'll become a great ninja, and you're ready to try for the Genin rank!",
    page: "/travel",
  },
  {
    id: "blL789mkRIKtjsWk",
    title: "Academy Dialog Option",
    elementIds: ["logbook-entry-eYDVpL63vPhK3lywMexdv"],
    description: "",
    page: "/academy",
    hideDialog: true,
  },
  {
    id: "YP5PEaCvfhJfdsl37V",
    title: "Assigning Stats",
    description:
      "Great job on getting the hang of things. Let's assign all your experience points one more",
    elementIds: ["tutorial-unassigned-stats"],
    page: "/academy",
    proceedOnHighlightClick: true,
    requiresGameMenu: true,
  },
  {
    id: "YPfhJfdsl37V",
    title: "Assigning Stats",
    description:
      "Assign the obtained experience to the stat of your liking. A good ninja is well-rounded, so don't stress too much about which stat you assign it to yet.",
    elementIds: ["tutorial-unassigned-stats-contentbox"],
    page: "/profile/experience",
  },
  {
    id: "f34p798tfn0327",
    title: "Level Up!",
    description: "And then let's claim your next level.",
    elementIds: ["tutorial-level-up-modal-content", "tutorial-level-up-btn"],
    page: "/profile",
  },
  {
    id: "f34p798tfn0327",
    title: "Academy",
    description:
      "I'll let you off the hook soon, and then you can roam the village on your own a bit. Before that, let's go to the academy for the last time.",
    elementIds: ["tutorial-village"],
    proceedOnHighlightClick: true,
    requiresGameMenu: true,
    page: "/profile",
  },

  {
    id: "f34p798tfn0327",
    title: "Academy",
    description:
      "I'll let you off the hook soon, and then you can roam the village on your own a bit. Before that, let's go to the academy for the last time.",
    elementIds: ["tutorial-academy"],
    proceedOnHighlightClick: true,
    requiresGameMenu: true,
    page: "/village",
  },
  {
    id: "qgfxpmmQ2mYayeN2iMuX6",
    title: "Genin Exam",
    elementIds: ["tutorial-take-quest"],
    description:
      "Once you're ready, you can start the Genin exam here. Passing this exam will award you the rank of Genin, which will unlock more difficult missions and jutsus, as well as pick pick one of the major ninja villages to join. Feel free to explore a bit, if you want, and otherwise come back here once you're ready for the exam. ",
    page: "/academy",
    showNextButton: true,
  },
  // {
  //   title: "That's it for now!",
  //   description:
  //     "That's it for the tutorial, you can now start playing the game! You can find further information on how to play the game at this link",
  //   elementIds: ["tutorial-logo"],
  //   page: "/academy",
  //   externalLink: "https://the-ninja-rpg.fandom.com/wiki/Getting_Started",
  //   showNextButton: true,
  // },
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
          const onBattlePage = pathname === "/combat";
          if (nextStepPage && pathname !== nextStepPage && !onBattlePage) {
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
    (forceStep?: string) => {
      setCurrentStepNumber((prevStep) => {
        // Force step if provided
        const setStep = TUTORIAL_STEPS.findIndex((step) => step.id === forceStep);
        const nextStep = forceStep && setStep > -1 ? setStep : prevStep + 1;

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

  /**
   * Async version of handleNextStep, returns a promise that resolves when the step is updated.
   * @param info Optional info object with forceStep and skipOptimisticUpdate.
   */
  const handleNextStepAsync = useCallback(
    async (forceStep?: string) => {
      // Force step if provided
      const setStep = TUTORIAL_STEPS.findIndex((step) => step.id === forceStep);
      const nextStep = forceStep && setStep > -1 ? setStep : stepNumber + 1;

      // If we've reached the end of the tutorial, hide it and resolve
      if (nextStep >= TUTORIAL_STEPS.length) {
        setIsAssistantVisible(false);
      }

      // Only update if not already at this step
      if (!isPending && nextStep !== stepNumber) {
        return new Promise<void>((resolve) => {
          updateTutorialStep(
            { step: nextStep },
            {
              onSuccess: () => {
                setCurrentStepNumber(nextStep);
                resolve();
              },
              onError: () => {
                resolve();
              },
            },
          );
        });
      } else {
        setCurrentStepNumber(nextStep);
        return Promise.resolve();
      }
    },
    [updateTutorialStep, setIsAssistantVisible, stepNumber, isPending],
  );

  // Return
  return {
    stepNumber,
    currentStep,
    updateTutorialStep,
    handleNextStep,
    handleNextStepAsync,
    currentStepNumber,
    isAssistantVisible,
    setIsAssistantVisible,
  };
};
