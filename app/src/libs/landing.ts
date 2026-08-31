import { absoluteUrl, SITE_NAME, SITE_URL } from "@/libs/seo";

/**
 * Content for the non-brand landing pages.
 *
 * Search Console showed the homepage ranking simultaneously for "ninja game" (57,639
 * impressions a year at position 7.6), "browser rpg" and "anime ninja online", so no
 * single page was written for any of them and all three converted around 1%. Each entry
 * below owns one query cluster, and each links onward to the manual hubs that were
 * sitting in "Discovered - currently not indexed" for want of an internal path.
 *
 * Figures quoted in the copy are taken from the live content tables; keep them in step
 * with the game rather than rounding them up.
 */

export interface LandingSection {
  heading: string;
  body: string[];
}

export interface LandingFaq {
  question: string;
  answer: string;
}

export interface LandingLink {
  href: string;
  label: string;
  description: string;
}

export interface LandingContent {
  path: string;
  /** Page title, without the site-name suffix. */
  title: string;
  description: string;
  eyebrow: string;
  h1: string;
  intro: string;
  sections: LandingSection[];
  links: LandingLink[];
  faqs: LandingFaq[];
}

const VILLAGES =
  "Akasumi, Akikaze, Horizon, Hyorin, Shirohana and Tsukimori, plus the outlaw-held Freedom State";

export const LANDING_PAGES = {
  "ninja-game": {
    path: "/ninja-game",
    title: "Ninja Game",
    description:
      "A free ninja game you play in the browser. Train your stats, learn from 1,050 jutsu, join one of seven villages and fight other players in the world of Seichi.",
    eyebrow: "Free to play",
    h1: "A ninja game that runs in your browser",
    intro:
      "TheNinja-RPG is a free multiplayer ninja game set in Seichi, a persistent world shared by more than 40,000 registered players. There is nothing to download and nothing to install: you make a character, pick a village, and start training in the same tab.",
    sections: [
      {
        heading: "Start as an academy student, not a finished ninja",
        body: [
          "Every character begins with weak stats and a handful of basic techniques. Strength, intelligence, willpower and speed all rise separately depending on what you actually train, and the offensive and defensive sides of ninjutsu, genjutsu, taijutsu and bukijutsu are tracked as eight distinct values.",
          "That means two level-50 characters can be built completely differently. A bukijutsu specialist who trained speed plays nothing like a genjutsu user who invested in intelligence, and the difference shows the moment they meet in combat.",
        ],
      },
      {
        heading: "1,050 jutsu, 51 bloodlines and 541 items",
        body: [
          "Jutsu are learned, ranked up through use, and slotted into a loadout you take into battle. They cover direct damage, healing, buffs, debuffs, summons, terrain effects and status conditions, and the ones worth carrying change as you climb the ranks.",
          "Bloodlines are inherited traits that sit on top of your build and alter how your techniques behave. They are drawn randomly and can be rerolled, so the bloodline you end up with shapes the character you choose to become rather than the other way round.",
        ],
      },
      {
        heading: "Seven villages, and the option to leave them all",
        body: [
          `The world is divided between ${VILLAGES}. Your village decides who you can train with, which missions you are given, whose war you fight and which parts of the map are safe to walk through.`,
          "You can also abandon that structure entirely and play as an outlaw, trading the protection of a village for freedom of movement and a different set of ways to make money.",
        ],
      },
      {
        heading: "Turn-based combat on a real grid",
        body: [
          "Fights play out on a hex grid where position matters. Range, line of sight, area effects and the order you act in all decide the outcome, and a well-built character can still lose to someone who reads the board better.",
          "Battles happen against other players, against the AI, in the arena, in ranked ladders and in village wars. Everything you win or lose is persistent, so a fight is never free.",
        ],
      },
    ],
    links: [
      {
        href: "/manual/combat",
        label: "How combat works",
        description: "Turn order, the hex grid, damage calculation and status effects.",
      },
      {
        href: "/manual/jutsu",
        label: "The jutsu library",
        description: "Every technique in the game, with its costs, ranges and effects.",
      },
      {
        href: "/manual/bloodline",
        label: "Bloodlines",
        description: "The 51 inherited traits, their ranks and what each one changes.",
      },
      {
        href: "/manual/world",
        label: "The world of Seichi",
        description: "Villages, sectors, travel and the map you move through.",
      },
    ],
    faqs: [
      {
        question: "Is TheNinja-RPG free to play?",
        answer:
          "Yes. The game is free, runs in any modern browser and needs no download. Optional paid perks exist, but nothing in the progression is locked behind them.",
      },
      {
        question: "Do I need to install anything to play this ninja game?",
        answer:
          "No. It runs in the browser on desktop and mobile. You create an account, make a character and play in the same tab.",
      },
      {
        question: "How long does it take to get strong?",
        answer:
          "Training is continuous and runs while you are away, so progress does not require sitting at the screen. Reaching the higher ranks takes months of play, which is what keeps the veteran population meaningful.",
      },
      {
        question: "Can I play with other people?",
        answer:
          "Yes. It is a multiplayer game throughout: villages, clans, ANBU squads, wars, tournaments, a shared economy, an auction house and player-versus-player combat.",
      },
    ],
  },
  "browser-rpg": {
    path: "/browser-rpg",
    title: "Browser RPG",
    description:
      "A persistent browser RPG with no download: 1,050 techniques, deep stat building, player-driven economy and turn-based PvP. Free to play in any modern browser.",
    eyebrow: "No download",
    h1: "A browser RPG built for the long game",
    intro:
      "TheNinja-RPG has been running since 2005. It is a browser RPG in the older sense of the phrase: a persistent world you return to over months, where your character keeps training while the tab is closed and the economy is driven by the people playing it.",
    sections: [
      {
        heading: "Progress that does not stop when you close the tab",
        body: [
          "Training runs on a timer rather than a grind loop. You set what your character works on, close the browser and come back to the result. That makes the game playable in short sessions without falling behind people who play all day.",
          "Because progress is continuous, the character you build over a year is genuinely yours. There is no seasonal reset that wipes the work.",
        ],
      },
      {
        heading: "A stat system with actual trade-offs",
        body: [
          "Four general stats and eight combat statistics rise independently, and every point comes from doing the thing it improves. Specialising makes you formidable in a narrow way; spreading out makes you flexible and beats nobody decisively.",
          "Bloodlines, equipment drawn from 541 items, a skill tree and jutsu loadouts sit on top of that, so builds diverge sharply well before the level cap.",
        ],
      },
      {
        heading: "An economy other players actually move",
        body: [
          "Money comes from missions, crimes, hunting, crafting, farming and combat, and it leaves through equipment, training, consumables and repairs. Prices at the auction house are set by players rather than by a vendor table.",
          "Clans and villages hold their own funds and prestige, so the economy operates at group level as well as individual level.",
        ],
      },
      {
        heading: "Runs on whatever you already have",
        body: [
          "There is no client, no launcher and no store page. A modern browser on a laptop or a phone is the entire requirement, which is why the game plays as well on a mid-range Android device as on a desktop.",
        ],
      },
    ],
    links: [
      {
        href: "/manual",
        label: "The game manual",
        description: "Every system documented in one place.",
      },
      {
        href: "/manual/item",
        label: "Items and equipment",
        description: "Weapons, armour, consumables and what each slot does.",
      },
      {
        href: "/manual/quest",
        label: "Quests and missions",
        description: "Missions, errands, crimes and the ranks that gate them.",
      },
      {
        href: "/manual/skillTree",
        label: "The skill tree",
        description: "Where skill points go and what they unlock.",
      },
    ],
    faqs: [
      {
        question: "What is a browser RPG?",
        answer:
          "A role-playing game that runs entirely in a web browser with no client to install. TheNinja-RPG is a persistent multiplayer example: the world keeps running whether or not you are logged in.",
      },
      {
        question: "Does it work on mobile?",
        answer:
          "Yes. The interface is built mobile-first and the game is playable on a phone browser without a separate app.",
      },
      {
        question: "Is there a pay-to-win problem?",
        answer:
          "Paid perks exist and are mostly convenience and cosmetic. Stats, jutsu and rank come from playing, and the ranked ladders are built around that.",
      },
      {
        question: "How old is the game?",
        answer:
          "TheNinja-RPG has been online since 2005 and is still actively developed, which is unusual for the genre and part of why the world has as much depth as it does.",
      },
    ],
  },
  "anime-ninja-online": {
    path: "/anime-ninja-online",
    title: "Anime Ninja Online",
    description:
      "An anime-styled ninja MMORPG you play online in the browser. Seven villages, 51 bloodlines, 1,050 jutsu and a hand-drawn world. Free, no download.",
    eyebrow: "Original world",
    h1: "An anime-styled ninja world you play online",
    intro:
      "If you came looking for an anime ninja game online, this is an original one. Seichi is its own setting with its own villages, clans and bloodline lore, drawn in an anime style and written to stand on its own rather than retell someone else's story.",
    sections: [
      {
        heading: "An original setting, not a licensed one",
        body: [
          "TheNinja-RPG is not affiliated with any anime or manga franchise. The genre furniture will be familiar — hidden villages, chakra, ranked ninja, inherited techniques — but the world, the characters and the history are the game's own, built over twenty years by its own community.",
          `Seichi is held by ${VILLAGES}, each with its own leadership, elders, territory and grudges.`,
        ],
      },
      {
        heading: "Art the community keeps adding to",
        body: [
          "Villages, bloodlines, jutsu, items and characters all carry their own artwork, and the concept-art gallery collects the pieces the world has been built from. It is a large part of why the setting reads as a place rather than a stat sheet.",
        ],
      },
      {
        heading: "Bloodlines are the closest thing to an anime power system",
        body: [
          "51 bloodlines run from common traits to extremely rare ones, each altering how your techniques resolve rather than simply adding numbers. They are drawn rather than chosen, which makes a strong roll something people genuinely trade and build around.",
          "Sage mode, elemental affinities and clan techniques layer further on top, so a late-game character has a recognisable identity rather than an optimal loadout everyone shares.",
        ],
      },
      {
        heading: "Play it with other people, in real conflicts",
        body: [
          "Villages go to war, clans compete for standing, ANBU squads run their own operations and the Kage seat changes hands. Tournaments and ranked ladders run alongside all of it.",
          "The result is an online ninja game where the story is generated by the population rather than delivered in cutscenes.",
        ],
      },
    ],
    links: [
      {
        href: "/manual/bloodline",
        label: "Bloodlines",
        description: "All 51 inherited traits, their rarity and their effects.",
      },
      {
        href: "/manual/world",
        label: "Villages and the map",
        description: "The seven villages, their territory and how travel works.",
      },
      {
        href: "/conceptart",
        label: "Concept art",
        description: "Artwork the world of Seichi has been built from.",
      },
      {
        href: "/manual/ai",
        label: "Characters and AI",
        description: "The non-player characters that populate the world.",
      },
    ],
    faqs: [
      {
        question: "Is this an official anime game?",
        answer:
          "No. TheNinja-RPG is an independent game with an original setting and is not affiliated with or endorsed by any anime or manga rights holder.",
      },
      {
        question: "What can I do in the game?",
        answer:
          "Train stats, learn and rank up jutsu, take missions, join a village and a clan, fight other players, run businesses and farms, craft, and take part in wars and tournaments.",
      },
      {
        question: "Is it free?",
        answer:
          "Yes, and it needs no download. Optional paid perks exist but progression is earned by playing.",
      },
      {
        question: "Can I play in a browser on my phone?",
        answer:
          "Yes. The game runs in a mobile browser as well as on desktop, with no separate app required.",
      },
    ],
  },
} as const satisfies Record<string, LandingContent>;

export type LandingSlug = keyof typeof LANDING_PAGES;

export const LANDING_ROUTES = Object.values(LANDING_PAGES).map((page) => page.path);

/**
 * FAQPage plus WebPage structured data for a landing page. The FAQ entries answer the
 * informational queries the site already receives impressions for, such as "where to
 * find flame village bloodlines", which drew 1,424 impressions and no clicks.
 */
export const landingStructuredData = (content: LandingContent) => ({
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebPage",
      "@id": `${absoluteUrl(content.path)}#webpage`,
      url: absoluteUrl(content.path),
      name: `${content.title} | ${SITE_NAME}`,
      description: content.description,
      inLanguage: "en",
      isPartOf: { "@id": `${SITE_URL}/#website` },
      about: { "@id": `${SITE_URL}/#game` },
      breadcrumb: { "@id": `${absoluteUrl(content.path)}#breadcrumb` },
    },
    {
      "@type": "BreadcrumbList",
      "@id": `${absoluteUrl(content.path)}#breadcrumb`,
      itemListElement: [
        { "@type": "ListItem", position: 1, name: SITE_NAME, item: SITE_URL },
        {
          "@type": "ListItem",
          position: 2,
          name: content.title,
          item: absoluteUrl(content.path),
        },
      ],
    },
    {
      "@type": "FAQPage",
      "@id": `${absoluteUrl(content.path)}#faq`,
      mainEntity: content.faqs.map((faq) => ({
        "@type": "Question",
        name: faq.question,
        acceptedAnswer: { "@type": "Answer", text: faq.answer },
      })),
    },
  ],
});
