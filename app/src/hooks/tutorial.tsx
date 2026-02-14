"use client";

import { useAtomValue } from "jotai";
import { MapPin } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/app/_trpc/client";
import {
  TUTORIAL_GENIN_EXAM_QUEST_ID,
  TUTORIAL_ITEM_ID,
  TUTORIAL_JUTSU_ID,
  TUTORIAL_STARTER_QUEST_ID,
  TUTORIAL_STEPS_COUNT,
} from "@/drizzle/constants";
import { availableUserActions } from "@/libs/combat/actions";
import { COMBAT_SECONDS } from "@/libs/combat/constants";
import { getDistanceToClosestEnemy } from "@/libs/combat/util";
import { combatActionIdAtom, userBattleAtom, useUserData } from "@/utils/UserContext";

export interface TutorialStepConfig {
  id: string;
  title: string;
  description: string | React.ReactNode;
  elementIds?: string[];
  page: string;
  hideDialog?: boolean;
  relatedValue?: number | string;
  showNextButton?: boolean;
  proceedOnHighlightClick?: boolean;
  requiresGameMenu?: boolean;
  externalLink?: string;
  onCombatWin?: string;
  onCombatLoss?: string;
}

// Dynamic combat tutorial step IDs that should show contextual guidance
const DYNAMIC_COMBAT_STEP_ID = "bRelJfsU9wuHNmhUSg0db";

// Hospitalized tutorial step
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
      "You have 2000 points to assign freely to your stats. Assign to any stat of your liking - if in doubt, I'd recommend putting it all into strength, which will generally be useful.",
    elementIds: [
      "tutorial-specialization-confirm-content",
      "tutorial-unassigned-stats-contentbox",
    ],
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
    id: "f34p798tfn0fds327",
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
    id: "U04RvrqvvYaOcenOGKMDw",
    title: "Academy",
    elementIds: ["tutorial-academy"],
    description:
      "You are a lot stronger now, but there's still room for you to grow. We should head to the academy. This is where I normally work as an instructor, and where we will guide you on your way to the next ninja rank of Genin. As a Genin, you will have access to more jutsus, more difficult missions, and much more. Let's go. ",
    page: "/village",
    proceedOnHighlightClick: true,
  },
  {
    id: "gaqwwlQAjB0b11DLsXMNE",
    title: "Academy Dialog Option",
    elementIds: [
      `logbook-entry-${TUTORIAL_STARTER_QUEST_ID}`,
      `tutorial-take-quest-${TUTORIAL_STARTER_QUEST_ID}`,
    ],
    relatedValue: TUTORIAL_STARTER_QUEST_ID,
    description: "",
    page: "/academy",
    hideDialog: true,
  },
  {
    id: "YP5PEaCvfhJfdsl37V",
    title: "Assigning Stats",
    description:
      "Wow, you're picking up things fast. You already acquired a substantial amount of additional XP. Let's go assign it before we proceed on the mission.",
    elementIds: ["tutorial-unassigned-stats"],
    page: "/academy",
    proceedOnHighlightClick: true,
    requiresGameMenu: true,
  },
  {
    id: "YPfhJfdsl37dsaV",
    title: "Assigning Stats",
    description:
      "Assign the obtained experience to the stat of your liking. A good ninja is well-rounded, so don't stress too much about which stat you assign it to yet.",
    elementIds: [
      "tutorial-specialization-confirm-content",
      "tutorial-unassigned-stats-contentbox",
    ],
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
      "Okay, you're now stronger, let's get back to our mission. Your target for our first practise mission will be to go eliminate a target in a different sector. So we'll have to move outside the borders of the village. Let's go. Don't worry, for this first mission I will accompany you.",
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
    relatedValue: 293,
  },
  {
    id: "eRw6ObsRONhzY7AUMO3vm",
    title: "Capture Target",
    elementIds: ["tutorial-travel-sector"],
    description: (
      <div>
        You need to track down a sad puppy which has gone missing. Careful, it may be
        aggressive, so we may have to fight it before we can bring it back to the
        village. Approach the target which is marked with a{" "}
        <MapPin className="inline-block h-5 w-5 text-red-500" /> in the sector, and
        overpower it.
      </div>
    ),
    page: "/travel",
    relatedValue: TUTORIAL_STARTER_QUEST_ID,
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
    description: (
      <div>
        Good job on capturing the puppy. Let&apos;s go back to the{" "}
        <span className="rounded-md bg-[#81007f] p-1 font-bold text-white shadow-sm">
          Horizon
        </span>{" "}
        village and the academy. With what I&apos;ve seen, I think you&apos;ll become a
        great ninja, and you&apos;re ready to try for the Genin rank!
      </div>
    ),
    page: "/travel",
    relatedValue: 296,
  },
  {
    id: "blL789mkRIKtjsWk",
    title: "Academy Dialog Option",
    elementIds: [`logbook-entry-${TUTORIAL_STARTER_QUEST_ID}`],
    description: "",
    page: "/academy",
    relatedValue: TUTORIAL_STARTER_QUEST_ID,
    hideDialog: true,
  },
  {
    id: "fdalgdwlcigydvs",
    title: "Village",
    description:
      "Great job on getting the hang of things. Before I let you off the hook, let's review what is available in the village.",
    elementIds: ["tutorial-village"],
    page: "/academy",
    proceedOnHighlightClick: true,
    requiresGameMenu: true,
  },
  {
    id: "32f4tesregsdaxsd3n8f7t",
    title: "Ramen Shop",
    description:
      "In the ramen shop you can purchase ramen to regain your health, stamina and chakra.",
    elementIds: ["tutorial-ramenshop"],
    page: "/village",
    proceedOnHighlightClick: true,
  },
  {
    id: "32f4tedfhgdfh3n8f7t",
    title: "Mission Hall",
    description:
      "In the mission hall you can take missions to gain experience and ryo.",
    elementIds: ["tutorial-missionhall"],
    page: "/village",
    proceedOnHighlightClick: true,
  },
  {
    id: "32f4tebsgfdg3n8f7t",
    title: "Home",
    description:
      "At your home you can sleep to regain your health, stamina and chakra. Note that when you are in your home you are safe from being attacked by other players.",
    elementIds: ["tutorial-home"],
    page: "/village",
    proceedOnHighlightClick: true,
  },
  {
    id: "gdffgdafgaerh",
    title: "Clan Hall",
    description:
      "When you reach Chunin rank you can join a clan to fight together with other clans and get various benefits",
    elementIds: ["tutorial-clanhall"],
    page: "/village",
    proceedOnHighlightClick: true,
  },
  {
    id: "32f4te3n8f7t",
    title: "Town Hall",
    description:
      "Perhaps one of the most important buildings is the Town Hall. Let's go there to see what we can learn about the current village status.",
    elementIds: ["tutorial-townhall"],
    page: "/village",
    proceedOnHighlightClick: true,
  },
  {
    id: "gsfgsdfg",
    title: "Town Hall",
    description:
      "On the first tab you'll see the current alliance status between all the major villages in Seichi.",
    elementIds: ["tutorial-townhall-alliance"],
    page: "/townhall#Alliance",
    proceedOnHighlightClick: true,
  },
  {
    id: "gsfgsdfg",
    title: "Town Hall",
    description: "Let's check on the kage of our village.",
    elementIds: ["tutorial-Kage"],
    page: "/townhall",
    proceedOnHighlightClick: true,
  },
  {
    id: "gsfgsdfg",
    title: "Town Hall",
    description:
      "This is the current kage of our village. The kage is the most powerful ninja, and gets to make decisions on behalf of the entire village together with the village elders.",
    page: "/townhall#Kage",
    showNextButton: true,
    proceedOnHighlightClick: true,
  },
  {
    id: "fadsbsdf",
    title: "Village",
    description:
      "Allright, let's go back to the village. The last thing I want to show you is the black market.",
    elementIds: ["tutorial-village"],
    page: "/townhall",
    proceedOnHighlightClick: true,
    requiresGameMenu: true,
  },
  {
    id: "fasdgshsrvre",
    title: "Black Market",
    description:
      'The black market is a place where you can purchase and sell more "untraditional"items',
    elementIds: ["tutorial-blackmarket"],
    page: "/village",
    proceedOnHighlightClick: true,
  },
  {
    id: "bfsvsfgerhtr",
    title: "Black Market",
    description:
      'Here you can purchase and genetically modify your character with a different bloodline. To do so costs "reputation points", which can be acquired e.g. through special events. ',
    elementIds: ["tutorial-bloodline-purchase"],
    page: "/blackmarket#Bloodline",
    proceedOnHighlightClick: true,
  },
  {
    id: "vsdffdsiugvd",
    title: "Black Market",
    description:
      "One way to obtain reputation points is to exchange ryo for them. This is done in the ryo shop. ",
    elementIds: ["tutorial-Ryo"],
    page: "/blackmarket",
    proceedOnHighlightClick: true,
  },
  {
    id: "vsdgfdgfdsiugvd",
    title: "Black Market",
    description:
      "Here players are selling reputation points, which you can buy for ryo. Ryo is acquired by killing enemies, completing missions, etc.",
    elementIds: ["tutorial-ryo-shop"],
    page: "/blackmarket#Ryo",
    proceedOnHighlightClick: true,
  },
  {
    id: "YP5PEaCvfhJfdsl37V",
    title: "Assigning Stats",
    description:
      "Okay, enough sightseeing. Great job on getting the hang of things. Let's assign all your experience points one more",
    elementIds: ["tutorial-unassigned-stats"],
    page: "/academy",
    proceedOnHighlightClick: true,
    requiresGameMenu: true,
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
    elementIds: [
      "tutorial-specialization-confirm-content",
      "tutorial-unassigned-stats-contentbox",
    ],
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
      "I'll let you off the hook now, and then you can roam the village on your own a bit. Before that, please follow me to the academy first.",
    elementIds: ["tutorial-village"],
    proceedOnHighlightClick: true,
    requiresGameMenu: true,
    page: "/profile",
  },

  {
    id: "f34p798tfn0327",
    title: "Academy",
    description:
      "I'll let you off the hook now, and then you can roam the village on your own a bit. Before that, please follow me to the academy first.",
    elementIds: ["tutorial-academy"],
    proceedOnHighlightClick: true,
    page: "/village",
  },
  {
    id: "qgfxpmmQ2mYayeN2iMuX6",
    title: "Genin Exam",
    elementIds: [`tutorial-take-quest-${TUTORIAL_GENIN_EXAM_QUEST_ID}`],
    description:
      "You're ready to start the Genin exam. Passing this exam will award you the rank of Genin, which will unlock more difficult missions and jutsus, as well as pick pick one of the major ninja villages to join. Feel free to explore a bit, if you want, and otherwise come back here once you're ready for the exam. ",
    page: "/academy",
    relatedValue: TUTORIAL_GENIN_EXAM_QUEST_ID,
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

// Warn if TUTORIAL_STEPS_COUNT in constants.ts is out of sync
if (TUTORIAL_STEPS.length !== TUTORIAL_STEPS_COUNT) {
  console.warn(
    `⚠️ TUTORIAL_STEPS_COUNT mismatch! constants.ts has ${TUTORIAL_STEPS_COUNT}, but TUTORIAL_STEPS has ${TUTORIAL_STEPS.length} steps. Please update TUTORIAL_STEPS_COUNT in @/drizzle/constants.ts to ${TUTORIAL_STEPS.length}.`,
  );
}

/**
 * Get dynamic combat tutorial step based on distance to enemy and selected action
 * @param distanceToEnemy - Distance to the closest enemy
 * @param selectedActionId - Currently selected action ID
 * @param canAffordAttack - Whether the user has enough action points to afford an attack
 */
const getDynamicCombatStep = (
  distanceToEnemy: number | null,
  selectedActionId: string | undefined,
  canAffordAttack: boolean,
): TutorialStepConfig | null => {
  // If we can't determine distance, return null (use default step)
  if (distanceToEnemy === null) return null;

  const baseStep = TUTORIAL_STEPS.find((step) => step.id === DYNAMIC_COMBAT_STEP_ID);
  if (!baseStep) return null;

  // User is more than 1 square away from enemy
  if (distanceToEnemy > 1) {
    if (selectedActionId !== "move") {
      // Highlight move action
      return {
        ...baseStep,
        description:
          "You need to get closer to your opponent! Select the movement action to move across the battlefield.",
        elementIds: ["tutorial-combat-action-move"],
        proceedOnHighlightClick: false,
      };
    } else {
      // Move is selected, highlight battlefield
      return {
        ...baseStep,
        description:
          "Great! Now click on a hex tile on the battlefield to move closer to your opponent.",
        elementIds: ["tutorial-combat-field"],
        showNextButton: false,
      };
    }
  }

  // User is 1 square away (adjacent to enemy)
  if (distanceToEnemy === 1) {
    // Check if user can't afford attack - they need to use wait to end their turn
    if (!canAffordAttack) {
      if (selectedActionId !== "wait") {
        // Highlight wait action
        return {
          ...baseStep,
          description:
            "You don't have enough action points to attack right now. Select the 'End Turn' action to pass your turn.",
          elementIds: ["tutorial-combat-action-wait"],
          proceedOnHighlightClick: false,
        };
      } else {
        // Wait is selected, highlight user's character on battlefield
        return {
          ...baseStep,
          description:
            "Now click on your own character on the battlefield to end your turn.",
          elementIds: ["tutorial-combat-field"],
          showNextButton: false,
        };
      }
    }

    // User can afford attack
    if (selectedActionId !== "basicAttack") {
      // Highlight basic attack
      return {
        ...baseStep,
        description:
          "You're close enough to attack! Select the basic attack action to hit your opponent.",
        elementIds: ["tutorial-combat-action-basicAttack"],
        proceedOnHighlightClick: false,
      };
    } else {
      // Basic attack is selected, highlight battlefield
      return {
        ...baseStep,
        description:
          "Excellent! Now click on your opponent on the battlefield to attack them!",
        elementIds: ["tutorial-combat-field"],
        showNextButton: false,
      };
    }
  }

  // User is on same tile as enemy (distance 0) - just attack
  if (!canAffordAttack) {
    if (selectedActionId !== "wait") {
      return {
        ...baseStep,
        description:
          "You don't have enough action points to attack. Select 'End Turn' to pass your turn.",
        elementIds: ["tutorial-combat-action-wait"],
        proceedOnHighlightClick: false,
      };
    } else {
      return {
        ...baseStep,
        description:
          "Now click on your own character on the battlefield to end your turn.",
        elementIds: ["tutorial-combat-field"],
        showNextButton: false,
      };
    }
  }

  if (selectedActionId !== "basicAttack") {
    return {
      ...baseStep,
      description:
        "You're right next to your opponent! Select the basic attack to finish them off!",
      elementIds: ["tutorial-combat-action-basicAttack"],
      proceedOnHighlightClick: false,
    };
  } else {
    return {
      ...baseStep,
      description: "Now click on your opponent to attack!",
      elementIds: ["tutorial-combat-field"],
      showNextButton: false,
    };
  }
};

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

  // Jotai atoms for combat state
  const battle = useAtomValue(userBattleAtom);
  const selectedActionId = useAtomValue(combatActionIdAtom);

  // Derived
  const stepNumber = userData?.tutorialStep || 0;
  const staticStep = TUTORIAL_STEPS?.[stepNumber];

  // Calculate distance to closest enemy for dynamic combat steps
  const distanceToEnemy = useMemo(() => {
    if (!battle || !userData?.userId) return null;
    return getDistanceToClosestEnemy(battle, userData.userId);
  }, [battle, userData?.userId]);

  // Calculate if user can afford the basic attack action
  const canAffordAttack = useMemo(() => {
    if (!battle || !userData?.userId) return true; // Default to true if we can't determine

    // Get the user's current action points
    const user = battle.usersState.find((u) => u.userId === userData.userId);
    if (!user) return true;

    // Get available actions and check if basic attack is affordable
    const actions = availableUserActions(battle, userData.userId);
    const basicAttack = actions.find((a) => a.id === "basicAttack");

    // If no basic attack action or no action cost defined, assume affordable
    if (!basicAttack || basicAttack.actionCostPerc === undefined) return true;

    // Check if user has enough action points for the basic attack
    return user.actionPoints >= basicAttack.actionCostPerc;
  }, [battle, userData?.userId]);

  // Compute dynamic combat step if applicable
  const currentStep = useMemo(() => {
    // Check if we're on the dynamic combat step
    if (staticStep?.id === DYNAMIC_COMBAT_STEP_ID && pathname === "/combat") {
      const dynamicStep = getDynamicCombatStep(
        distanceToEnemy,
        selectedActionId,
        canAffordAttack,
      );
      if (dynamicStep) return dynamicStep;
    }
    return staticStep;
  }, [staticStep, pathname, distanceToEnemy, selectedActionId, canAffordAttack]);

  // Update user's tutorial step
  const { mutate: updateTutorialStep, isPending } =
    api.profile.updateTutorialStep.useMutation({
      onSuccess: async (data) => {
        if (data.success && data.data) {
          await updateUser({ tutorialStep: data.data.tutorialStep });
          const nextStepPage = TUTORIAL_STEPS[data.data.tutorialStep]?.page;
          const onBattlePage = pathname === "/combat";
          if (nextStepPage && pathname !== nextStepPage && !onBattlePage) {
            if (nextStepPage.includes("#")) {
              window.location.href = nextStepPage; // Force reload to update anchor section
            } else {
              router.push(nextStepPage);
            }
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
  const handleNextStep = (forceStep?: string) => {
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
  };

  /**
   * Async version of handleNextStep, returns a promise that resolves when the step is updated.
   * @param info Optional info object with forceStep and skipOptimisticUpdate.
   */
  const handleNextStepAsync = async (forceStep?: string) => {
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
  };

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
