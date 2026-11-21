/**
 * Copy for the public Chakra Storm page: the lobby renders it and the route's structured
 * data repeats the FAQ, so search results and the page always agree.
 */
import {
  CS_BOSS_MINUTES,
  CS_JUTSU,
  CS_PASSIVES,
  CS_RUN_SECONDS,
  CS_STAGE_INFO,
  CS_STAGES,
} from "@/libs/chakraStorm/content";

export const CS_LANDING_TITLE = "Chakra Storm: Free Ninja Survival Game";

/** The search snippet: what the game is and that it is free, within about 155 characters. */
export const CS_LANDING_DESCRIPTION =
  "Play a free ninja survival game in your browser. Scout Seichi for your village while hostiles swarm from every side and your jutsu cast themselves.";

const MINUTES = CS_RUN_SECONDS / 60;

/** Questions a new player asks before their first run, answered for the page and search. */
export const CS_LANDING_FAQ = [
  {
    question: "Is Chakra Storm free to play?",
    answer:
      "Yes. It runs in your browser on desktop and mobile, with nothing to download and nothing to buy.",
  },
  {
    question: "How do I play?",
    answer: `Walk with WASD, the arrow keys or by dragging anywhere on the field. Your jutsu cast themselves at the hostiles closing in. Fallen raiders drop chakra orbs, and every level lets you choose one of three jutsu or passive arts. Hold out for ${MINUTES} minutes until your village's reinforcements arrive, and they bring your scouting report home.`,
  },
  {
    question: "What are awakenings?",
    answer: `Each of the ${CS_JUTSU.length} jutsu has an awakened form. Master a jutsu, learn its partner art, then open a scroll from an elite or a hunter, and it awakens into something far stronger, such as Sunfall Comet or the Akikaze Tempest.`,
  },
  {
    question: "How many stages are there?",
    answer: `${CS_STAGES.length}, across the land of Seichi: ${CS_STAGES.map((stage) => CS_STAGE_INFO[stage].name).join(", ")}. Scout one for ten minutes to open the next. Hunters arrive at minutes ${CS_BOSS_MINUTES.join(", ")}.`,
  },
  {
    question: "Is there a leaderboard?",
    answer:
      "Yes. Undercover, open to every scout from the start, is an endless region with no reinforcements: it starts gently, then hardens for as long as your cover holds. Signed-in players' verified Undercover runs rank by how long they lasted, and the leaderboard starts afresh every month.",
  },
  {
    question: "Do I need an account?",
    answer:
      "No. Press Play and your first scouting run starts at once. Your intel, Training Hall upgrades and best runs are kept on your device.",
  },
  {
    question: "What is TheNinja-RPG?",
    answer:
      "TheNinja-RPG is a free online ninja role-playing game set in the land of Seichi, with villages, bloodlines, missions and battles against other players. Chakra Storm is one of its minigames.",
  },
] as const;

/** Numbers the landing quotes. */
export const CS_LANDING_STATS = {
  jutsu: CS_JUTSU.length,
  passives: CS_PASSIVES.length,
  stages: CS_STAGES.length,
  minutes: MINUTES,
} as const;
