/**
 * Copy for the public tower defense page: the guest landing renders it and the route's
 * structured data repeats the FAQ, so search results and the page always agree.
 */

import { TD_DAILY_WAVES } from "@/drizzle/constants";
import {
  TD_BOSS_INTERVAL,
  TD_ERA_INTERVAL,
  TD_SEAL_ARTS,
  TD_SENTRIES,
  TD_STAGES,
  TD_ULTIMATES,
} from "@/libs/towerDefense/content";

export const TD_LANDING_TITLE = "Free Ninja Tower Defense Game";

/** The search snippet: what the game is and that it is free, within about 155 characters. */
export const TD_LANDING_DESCRIPTION =
  "Play a free ninja tower defense game in your browser. Weave hand seals, raise sentries and unleash ultimate jutsu against endless waves. No download.";

/** Questions a new player asks before their first run, answered for the page and search. */
export const TD_LANDING_FAQ = [
  {
    question: "Is Ninja Tower Defense free to play?",
    answer:
      "Yes. It runs in your browser on desktop and mobile, with nothing to download and nothing to buy.",
  },
  {
    question: "Do I need an account to play?",
    answer:
      "No. Press Play and your first run starts at once. A free account keeps your best wave, earns scrolls for permanent Guard Hall upgrades, puts you on the leaderboard and pays a daily reward for defending your village.",
  },
  {
    question: "How long does the game last?",
    answer: `The waves never end. A boss arrives every ${TD_BOSS_INTERVAL} waves, a new era changes the rules every ${TD_ERA_INTERVAL}, and the road runs through ${TD_STAGES.length} stages to wave ${TD_STAGES.at(-1)?.wave} and beyond. Players with an account restart from checkpoints after each boss.`,
  },
  {
    question: "What makes it different from other tower defense games?",
    answer: `You are the tower. Your ninja throws shuriken at the nearest raider while you weave ${TD_SEAL_ARTS.length} hand seal arts, place ${TD_SENTRIES.length} kinds of sentry and unleash ${TD_ULTIMATES.length} ultimate techniques, while new eras keep changing the rules.`,
  },
  {
    question: "What is TheNinja-RPG?",
    answer: `TheNinja-RPG is a free online ninja role-playing game. Tower defense is how its villages hold off raiders: clear ${TD_DAILY_WAVES} waves in a run each day to earn ryo and prestige and send tokens to your village.`,
  },
] as const;
