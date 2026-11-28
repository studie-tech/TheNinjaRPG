"use client";

import { Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  SENSEI_GENIN_TRAIN_EXP_BOOST_PERC,
  SENSEI_JUTSU_TRAINING_BOOST_PERC,
} from "@/drizzle/constants";
import { useMarkIntroSeen, useSystemIntro } from "@/hooks/useStoryGuidance";
import { CS_DAILY_SECONDS } from "@/libs/chakraStorm/content";
import { cn } from "@/libs/shadui";
import type { StorySystemId } from "@/libs/storyGuidance";

/**
 * One-time introduction at the top of a system's page, shown the first time a player
 * who has it unlocked opens the page. Opening the page counts as seeing it (the "New"
 * badge clears), while the banner itself stays until dismissed or the player leaves.
 */
export const SystemIntroBanner: React.FC<{
  system: StorySystemId;
  className?: string;
}> = ({ system, className }) => {
  const { isLoaded, isUnlocked, isUnseen } = useSystemIntro(system);
  const markSeen = useMarkIntroSeen();
  // Latched on the first loaded render, so recording the intro doesn't hide it at once.
  const [isShown, setIsShown] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    if (!isLoaded || isShown !== undefined) return;
    const show = isUnlocked && isUnseen;
    setIsShown(show);
    if (show) markSeen(system);
  }, [isLoaded, isUnlocked, isUnseen, isShown, markSeen, system]);
  const intro = SYSTEM_INTROS[system];
  if (!isShown) return null;
  return (
    <Alert
      role="status"
      className={cn(
        "relative mb-3 border-amber-500/60 bg-amber-500/10 pr-12",
        className,
      )}
    >
      <Sparkles aria-hidden="true" className="text-amber-500" />
      <AlertTitle>{intro.title}</AlertTitle>
      <AlertDescription>
        <p>{intro.body}</p>
      </AlertDescription>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Dismiss introduction"
        className="absolute top-1.5 right-1.5 h-9 w-9"
        onClick={() => setIsShown(false)}
      >
        <X className="h-5 w-5" />
      </Button>
    </Alert>
  );
};

/** What each system is for, in one or two plain sentences. */
const SYSTEM_INTROS: Record<StorySystemId, { title: string; body: string }> = {
  missionhall: {
    title: "The Mission Hall",
    body: "Errands are quick jobs around the village; missions send you out for ryo and experience. Each card shows its reward before you accept, and you can take one at a time.",
  },
  bank: {
    title: "Your bank account",
    body: "Ryo you carry can be stolen when you are defeated. Deposit it here to keep it safe; the bank also pays a little interest every day.",
  },
  towerDefense: {
    title: "Guard Hall duty",
    body: "Defend the village walls in Shuriken Siege. Once a day your first defense pays a duty reward, and every wave you hold earns Guard Hall points.",
  },
  sensei: {
    title: "Find a sensei",
    body: `A Jonin sensei gives you ${SENSEI_GENIN_TRAIN_EXP_BOOST_PERC}% more experience from stat training and ${SENSEI_JUTSU_TRAINING_BOOST_PERC}% faster jutsu training. Send a request from the training grounds.`,
  },
  blackmarket: {
    title: "Elements at the Black Market",
    body: "Genin can roll a primary element here. It decides which elemental jutsu you can learn and which you resist.",
  },
  clan: {
    title: "Clans",
    body: "A clan shares a hall, battles and bonuses. Send a request to join one, or found your own later when you can afford it.",
  },
  occupation: {
    title: "Jobs",
    body: "Pick a job: gathering, hunting or crafting. Each sends you on contracts that pay in materials and job experience. Changing jobs has a cooldown, so choose the one you enjoy.",
  },
  auction: {
    title: "The Auction House",
    body: "Players buy and sell items here. Bid on what you need, or list items you no longer use.",
  },
  chakraStorm: {
    title: "The Scout Post",
    body: `Scout the wilds in Chakra Storm and survive the storm as long as you can. Your first scout of ${CS_DAILY_SECONDS / 60} minutes or more each day pays the daily scouting report.`,
  },
  kitchen: {
    title: "Your kitchen",
    body: "Cook meals at home from ingredients you gather or buy. Meals restore you and feed your companion, which helps it grow.",
  },
  pets: {
    title: "Caring for your companion",
    body: "Feed your companion a meal to keep it happy and growing. A fed companion fights better at your side.",
  },
  battlepyramid: {
    title: "Battle Pyramids",
    body: "A pyramid is a climb of floors with a boss at the top. A loss sends you to the hospital, but your progress per floor is kept. Bring a quest team to make it easier.",
  },
};
