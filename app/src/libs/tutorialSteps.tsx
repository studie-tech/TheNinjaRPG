import { MapPin } from "lucide-react";
import {
  TUTORIAL_GENIN_EXAM_QUEST_ID,
  TUTORIAL_ITEM_ID,
  TUTORIAL_JUTSU_ID,
  TUTORIAL_STARTER_QUEST_ID,
} from "@/drizzle/constants";
import {
  GENIN_QUEST_OBJECTIVES,
  STARTER_QUEST_OBJECTIVES,
  TUTORIAL_ANY_PAGE,
  TUTORIAL_CAPTURE_SECTOR,
  TUTORIAL_JUTSU_PICK_STEP_ID,
  TUTORIAL_WAKE_SECTOR,
  type TutorialObjectiveRef,
  type TutorialTrigger,
} from "@/libs/tutorial";

export const TUTORIAL_CHAPTERS = [
  { id: "student", title: "A New Student" },
  { id: "combat", title: "Trial by Combat" },
  { id: "tools", title: "Tools of the Trade" },
  { id: "mission", title: "The Missing Pup" },
  { id: "bond", title: "Bondkeepers" },
  { id: "genin", title: "Graduation" },
  { id: "exam", title: "The Genin Exam" },
] as const;
export type TutorialChapterId = (typeof TUTORIAL_CHAPTERS)[number]["id"];

export interface TutorialStepConfig {
  id: string;
  chapter: TutorialChapterId;
  title: string;
  /** What Lemu says: the story beat and why this step matters. */
  description: string | React.ReactNode;
  /** The one thing to do now, shown as the step's call to action. */
  action?: string;
  /** Elements to highlight, most specific first; the first one on screen wins. */
  elementIds?: string[];
  page: string;
  /** Quest whose dialog or reward the step shows, or the sector a travel step targets. */
  relatedValue?: number | string;
  /** Quest objective this step works towards (or a group, any one of which counts); once it is behind the player the step is skipped. */
  objectiveId?: TutorialObjectiveRef;
  /** Step that earns the objective; a player here without it is sent back to that step. */
  objectiveStepId?: string;
  /** Shows the related quest's current objective text, for steps whose words come from the quest. */
  quoteObjective?: boolean;
  /**
   * Label of a button that travels and walks to the related quest's current objective,
   * or, on a travel step, travels to the step's sector.
   */
  autoTravelLabel?: string;
  /**
   * The step teaches the game's own control on the page (the globe, the map, the quest
   * log's answers or reward). The lesson's own trip, answer or claim button stays
   * hidden until the player has been stuck on the step for a while.
   */
  teachOnPage?: boolean;
  /**
   * What to do on the Activity dock's Quests tab, for a step whose answer or reward is
   * given there. The lesson marks that tab and its own buttons wait as with `teachOnPage`.
   */
  questsTabPrompt?: string;
  /** Game action that completes the step. */
  advanceOn?: TutorialTrigger;
  /** Skipped while the player has no unassigned experience to spend. */
  needsUnassignedExperience?: boolean;
  showNextButton?: boolean;
  nextLabel?: string;
  proceedOnHighlightClick?: boolean;
  requiresGameMenu?: boolean;
  onCombatWin?: string;
  onCombatLoss?: string;
  /** A full-screen moment shown in place of the dock, with one Continue button. */
  screen?: TutorialScreenKind;
}

/** Full-screen moments of the Academy Trials: the promotion and the evening's close. */
export type TutorialScreenKind = "rankUp" | "tomorrow";

/** Shown in place of any step while the player is in the hospital. */
export const TUTORIAL_HOSPITALIZED_STEP: TutorialStepConfig = {
  id: "hospitalized",
  chapter: "combat",
  title: "Patched up",
  description:
    "Every shinobi loses a fight now and then. You'll be discharged for free when the timer runs out, or you can pay a little ryo to heal right away.",
  action: "Heal or wait, then we'll try again.",
  page: "/hospital",
  elementIds: ["tutorial-hospital-buttons"],
};

const starterLogbookEntry = `logbook-entry-${TUTORIAL_STARTER_QUEST_ID}`;
// The trip's confirmation and arrival timer, ahead of the controls that lead to them.
const globalTravelElements = [
  "tutorial-auto-travel-proceed",
  "tutorial-global-travel-proceed",
  "tutorial-travel-arrival",
];
const assignElements = [
  "tutorial-specialization-confirm-content",
  "tutorial-unassigned-stats-contentbox",
];
const levelUpElements = [
  "tutorial-level-up-modal-content",
  "tutorial-level-up-experience",
];

export const TUTORIAL_STEPS: TutorialStepConfig[] = [
  // Chapter 1: A New Student
  {
    id: "student-welcome",
    chapter: "student",
    title: "Welcome to Horizon",
    description:
      "Welcome to Horizon, the academy town where every shinobi begins. I'm <b>Lemu</b>, your instructor. This is the village: every building offers something different, and the <b>location menu</b> always shows what the place you stand in has to offer. Before you earn your Genin headband you must pass the <b>Academy Trials</b>, and they begin at the academy.",
    action: "Tap Academy.",
    elementIds: ["tutorial-academy"],
    page: "/village",
    proceedOnHighlightClick: true,
  },
  {
    id: "academy-accept-trials",
    chapter: "student",
    title: "Your quest log",
    description:
      "Quests are how you progress. Each is a chain of objectives with rewards along the way, and your active quests always live in this log. Your first one is the Academy Trials.",
    action: "Answer me in the quest log to accept the trials.",
    elementIds: ["tutorial-dialog-options", starterLogbookEntry],
    teachOnPage: true,
    page: "/academy",
    relatedValue: TUTORIAL_STARTER_QUEST_ID,
    objectiveId: STARTER_QUEST_OBJECTIVES.accept,
    advanceOn: "questDialog",
  },
  // Chapter 2: Trial by Combat
  {
    id: "combat-arena-building",
    chapter: "combat",
    title: "The Battle Arena",
    description:
      "Your first trial is a fight. The arena is where you test yourself against training opponents.",
    action: "Tap Battle Arena.",
    elementIds: ["tutorial-battlearena"],
    page: "/village",
    proceedOnHighlightClick: true,
  },
  {
    id: "combat-enter-arena",
    chapter: "combat",
    title: "Your first fight",
    description:
      "I've picked the <b>Academy Dummy</b> for you. Auto combat stays off while you train with me: today you fight with your own hands.",
    action: "Tap the Fight button.",
    elementIds: ["tutorial-battlearena-challenge-ai-enter"],
    page: "/battlearena",
    advanceOn: "arenaStart",
  },
  {
    id: "combat-battlefield",
    chapter: "combat",
    title: "The battlefield",
    description:
      "Fights play out on a grid of hexagonal tiles. The dummy stands just two tiles away. You act by choosing an action below the field and then tapping a tile on it.",
    elementIds: ["tutorial-combat-field"],
    page: "/combat",
    showNextButton: true,
    onCombatWin: "combat-claim-reward",
    onCombatLoss: "combat-enter-arena",
  },
  {
    id: "combat-turns",
    chapter: "combat",
    title: "Turns and Action Points",
    description:
      "Each turn you get <b>100 Action Points (AP)</b>, shown on this bar: moving costs 10 AP and a basic attack 20. While you train with me there is no time limit, and I'll guide your first turn.",
    elementIds: ["tutorial-combat-action-timer"],
    page: "/combat",
    showNextButton: true,
    onCombatWin: "combat-claim-reward",
    onCombatLoss: "combat-enter-arena",
  },
  {
    id: "combat-fight",
    chapter: "combat",
    title: "Fight!",
    description: "Defeat the Academy Dummy.",
    elementIds: ["tutorial-combat-field"],
    page: "/combat",
    onCombatWin: "combat-claim-reward",
    onCombatLoss: "combat-enter-arena",
  },
  {
    id: "combat-claim-reward",
    chapter: "combat",
    title: "Victory!",
    description:
      "Well fought! Winning completed your first objective. Objective rewards wait in your quest log until you claim them.",
    action: "Tap the gift in your quest log to collect your reward.",
    elementIds: ["tutorial-objective-claim"],
    teachOnPage: true,
    page: "/profile",
    relatedValue: TUTORIAL_STARTER_QUEST_ID,
    objectiveId: STARTER_QUEST_OBJECTIVES.arena,
    advanceOn: "questReward",
  },
  {
    id: "combat-assign-notice",
    chapter: "combat",
    title: "Unassigned experience",
    description:
      "Experience from quests goes into the stats you choose. New experience always shows up here.",
    action: "Tap Assign XP.",
    elementIds: ["tutorial-unassigned-stats"],
    page: "/profile",
    proceedOnHighlightClick: true,
    requiresGameMenu: true,
    needsUnassignedExperience: true,
  },
  {
    id: "combat-assign-form",
    chapter: "combat",
    title: "Choose your strengths",
    description:
      "Every style raises <b>Offence</b> (harder hits) and <b>Defence</b> (softer blows), plus two of the stats your techniques draw on. Pick the one that fits how you want to fight; <b>Advanced</b> lets you place each point yourself later.",
    action: "Tap a style, then confirm.",
    elementIds: assignElements,
    page: "/profile/experience",
    advanceOn: "assignStats",
    needsUnassignedExperience: true,
  },
  {
    id: "combat-level-up",
    chapter: "combat",
    title: "Level up!",
    description:
      "Your experience now covers level 2. Every level raises your maximum health, chakra and stamina.",
    action: "Tap Level up!, then Awesome!",
    elementIds: levelUpElements,
    page: "/profile/experience",
    advanceOn: "levelUp",
  },
  // Chapter 3: Tools of the Trade
  {
    id: "tools-training-building",
    chapter: "tools",
    title: "Training Grounds",
    description:
      "A win is a fine start, but shinobi grow through daily training. Let's visit the training grounds.",
    action: "Tap Training Grounds.",
    elementIds: ["tutorial-traininggrounds"],
    page: "/village",
    proceedOnHighlightClick: true,
  },
  {
    id: "tools-train-stat",
    chapter: "tools",
    title: "Train with Energy",
    description:
      "Training spends <b>Energy</b> to raise a stat instantly. I've set aside a small amount so you can see what it buys.",
    action: "Tap Offence to train it.",
    elementIds: ["tutorial-traininggrounds-offence"],
    page: "/traininggrounds",
    advanceOn: "trainStats",
    showNextButton: true,
  },
  {
    id: "tools-queue-energy",
    chapter: "tools",
    title: "The Energy queue",
    description:
      "Energy refills over time, even while you are offline. The <b>Energy queue</b> spends it for you as it comes back, so your training never stops.",
    action: "Tap Defence to queue the rest of your Energy.",
    elementIds: ["tutorial-traininggrounds-defence"],
    page: "/traininggrounds",
    advanceOn: "queueEnergy",
    showNextButton: true,
  },
  {
    id: "tools-train-jutsu",
    chapter: "tools",
    title: "Your first jutsu",
    description:
      "Jutsu are your signature techniques. <b>Sonic Slash</b> is a piercing blade strike that hits from a few tiles away. The first level takes about a minute and costs a little ryo, and a new jutsu is equipped automatically.",
    action: "Tap Sonic Slash, then Learn.",
    elementIds: [
      "tutorial-traininggrounds-trainJutsu-proceed",
      `tutorial-combat-action-${TUTORIAL_JUTSU_ID}`,
    ],
    page: "/traininggrounds",
    objectiveId: STARTER_QUEST_OBJECTIVES.jutsu,
    advanceOn: "trainJutsu",
  },
  {
    id: "tools-claim-jutsu",
    chapter: "tools",
    title: "Objective complete",
    description:
      "Learning a jutsu completed your next trial. You can use Sonic Slash in battle right away, even while it finishes training.",
    action: "Open Quests and claim your reward there.",
    questsTabPrompt: "Claim your reward here.",
    page: "/traininggrounds",
    relatedValue: TUTORIAL_STARTER_QUEST_ID,
    objectiveId: STARTER_QUEST_OBJECTIVES.jutsu,
    objectiveStepId: TUTORIAL_JUTSU_PICK_STEP_ID,
    advanceOn: "questReward",
  },
  {
    id: "tools-assign",
    chapter: "tools",
    title: "Grow stronger",
    description:
      "Your jutsu trial earned you more experience. New experience always waits under <b>Assign XP</b> in the game menu. This time the choice is yours: use a style again, or open <b>Advanced</b> and place each point where you want it.",
    action: "Open Assign XP and spend your experience.",
    elementIds: ["tutorial-unassigned-stats"],
    page: TUTORIAL_ANY_PAGE,
    advanceOn: "assignStats",
    needsUnassignedExperience: true,
  },
  {
    id: "tools-level-up",
    chapter: "tools",
    title: "Level 3",
    description:
      "That covers another level. A <b>Level up</b> button shows on your profile and on the experience page whenever you have earned one.",
    action: "Take level 3.",
    page: TUTORIAL_ANY_PAGE,
    advanceOn: "levelUp",
  },
  {
    id: "tools-itemshop-building",
    chapter: "tools",
    title: "Item Shop",
    description:
      "Jutsu are not your only weapons. Ninja tools let you strike from a distance.",
    action: "Tap Item shop.",
    elementIds: ["tutorial-itemshop"],
    page: "/village",
    proceedOnHighlightClick: true,
  },
  {
    id: "tools-buy-shuriken",
    chapter: "tools",
    title: "Shuriken",
    description:
      "<b>Shuriken</b> hit from a distance and are used up when thrown. Tools you buy go straight into a free item slot, ready for battle.",
    action: "Tap Shuriken, then buy a few.",
    elementIds: [
      "tutorial-itemshop-confirmPurchase-proceed",
      "tutorial-itemshop-item",
      `tutorial-combat-action-${TUTORIAL_ITEM_ID}`,
    ],
    page: "/itemshop",
    advanceOn: "buyItem",
    showNextButton: true,
  },
  // Chapter 4: The Missing Pup
  {
    id: "mission-brief",
    chapter: "mission",
    title: "A real mission",
    description:
      "Last night a violet flash lit up the eastern ridge, and a pup from the <b>Bondkeeper Sanctuary</b> bolted in fright. Scouts saw someone in a mask following its tracks. Your final trial: bring the pup back safely.",
    action: "Accept the mission in your quest log.",
    elementIds: ["tutorial-dialog-options", starterLogbookEntry],
    teachOnPage: true,
    page: "/academy",
    relatedValue: TUTORIAL_STARTER_QUEST_ID,
    objectiveId: STARTER_QUEST_OBJECTIVES.brief,
    advanceOn: "questDialog",
  },
  {
    id: "mission-open-travel",
    chapter: "mission",
    title: "Beyond the walls",
    description:
      "Missions take you out into the world of Seichi. The travel map shows both the sector you stand in and the whole globe. The buttons along its top are labelled while you learn them.",
    action: "Tap Travel in the main menu.",
    elementIds: ["tutorial-travel"],
    page: "/academy",
    objectiveId: STARTER_QUEST_OBJECTIVES.pup,
    proceedOnHighlightClick: true,
    requiresGameMenu: true,
  },
  {
    id: "mission-travel-to-pup",
    chapter: "mission",
    title: "The world map",
    description:
      "The pup fled beyond the village walls, to the sector marked on your quest. The <b>Global</b> map shows the whole world: tap a sector on it to travel there. Journeys between sectors take a little time: follow your character along the route as the arrival timer counts down. Don't worry, I'm coming with you.",
    action: "Open the Global map, tap the marked sector, then Travel.",
    elementIds: [...globalTravelElements, "tutorial-globe-target", "tutorial-Global"],
    teachOnPage: true,
    page: "/travel",
    relatedValue: TUTORIAL_CAPTURE_SECTOR,
    autoTravelLabel: "Take me there",
    objectiveId: STARTER_QUEST_OBJECTIVES.pup,
    advanceOn: "travelArrive",
  },
  {
    id: "mission-find-pup",
    chapter: "mission",
    title: "Find the pup",
    description: (
      <>
        The pup is cornered at the{" "}
        <MapPin className="inline-block h-4 w-4 text-red-500" /> marker, and the masked
        figure is with it. Whoever it is, they won&apos;t hand it over. On your first
        turn I&apos;ll show you Sonic Slash and your shuriken; then the fight is yours.
      </>
    ),
    action: "Tap the ground next to the marker to walk there.",
    elementIds: ["tutorial-travel-sector"],
    page: "/travel",
    relatedValue: TUTORIAL_STARTER_QUEST_ID,
    objectiveId: STARTER_QUEST_OBJECTIVES.pup,
    onCombatWin: "mission-claim-pup",
    onCombatLoss: "mission-travel-to-pup",
  },
  {
    id: "mission-claim-pup",
    chapter: "mission",
    title: "Safe and sound",
    description:
      "The masked courier breaks off and vanishes into the trees, and something falls from their belt: a sliver of <b>dark metal</b>, threaded with faint violet veins. The pup's collar is scorched the same violet. Strange... Let's get it home first.",
    action: "Open Quests and claim your reward there.",
    questsTabPrompt: "Claim your reward here.",
    page: "/travel",
    relatedValue: TUTORIAL_STARTER_QUEST_ID,
    objectiveId: STARTER_QUEST_OBJECTIVES.pup,
    advanceOn: "questReward",
  },
  {
    id: "mission-ramen",
    chapter: "mission",
    title: "Refuel",
    description:
      "That fight cost you <b>Stamina</b> (basic attacks) and <b>Chakra</b> (jutsu). Both refill slowly on their own, or at once with a bowl of ramen. The Horizon ramen shop delivers to Academy patrols, and a small bowl costs only a few ryo.",
    action: "Order a bowl of ramen.",
    elementIds: ["tutorial-ramen-menu"],
    page: "/ramenshop",
    advanceOn: "buyRamen",
    showNextButton: true,
  },
  {
    id: "mission-level-up",
    chapter: "mission",
    title: "Level 4",
    description:
      "Your first field mission paid well. No pointers from me this time: spend the experience the way you think best, then take level 4. One more level after that and you are ready for the Genin exam.",
    action: "Assign your experience, then level up.",
    page: TUTORIAL_ANY_PAGE,
    advanceOn: "levelUp",
  },
  // Chapter 5: Bondkeepers
  {
    id: "bond-travel-wake",
    chapter: "bond",
    title: "Bring it home",
    description:
      "The pup wears a Bondkeeper tag: it belongs to the sanctuary on <b>Wake Island</b>, a short trip from here. Wake Island is neutral ground, and it is where you will take your Genin exam.",
    action: "Travel to Wake Island on the Global map.",
    elementIds: [...globalTravelElements, "tutorial-globe-target"],
    teachOnPage: true,
    page: "/travel",
    relatedValue: TUTORIAL_WAKE_SECTOR,
    autoTravelLabel: "Take me to Wake Island",
    objectiveId: STARTER_QUEST_OBJECTIVES.sanctuary,
    advanceOn: "travelArrive",
  },
  {
    id: "bond-open-village",
    chapter: "bond",
    title: "Wake Island",
    description:
      "Wake Island is neutral ground that every village shares. Its buildings open from the location menu, just like at home.",
    action: "Tap Wake Island in the location menu.",
    elementIds: ["tutorial-village"],
    page: "/travel",
    proceedOnHighlightClick: true,
    requiresGameMenu: true,
  },
  {
    id: "bond-sanctuary-building",
    chapter: "bond",
    title: "The Bondkeeper Sanctuary",
    description:
      "The Bondkeepers care for the island's creatures and pair them with shinobi they trust.",
    action: "Tap Bondkeeper Sanctuary.",
    elementIds: ["tutorial-pets"],
    page: "/village",
    proceedOnHighlightClick: true,
  },
  {
    id: "bond-return-pup",
    chapter: "bond",
    title: "Home at last",
    description:
      "The Bondkeepers rush out to meet you, and the pup bounds straight into their arms.",
    action: "Open Quests and hand over the pup there.",
    questsTabPrompt: "Answer to hand over the pup.",
    page: "/pets",
    relatedValue: TUTORIAL_STARTER_QUEST_ID,
    objectiveId: STARTER_QUEST_OBJECTIVES.sanctuary,
    advanceOn: "questDialog",
  },
  {
    id: "bond-adopt",
    chapter: "bond",
    title: "It won't leave your side",
    description:
      "The pup refuses to let you out of sight, so the Bondkeepers offer it to you as your companion, and your <b>first bond is free</b>. Take the pup, or design a companion of your own instead. We'll teach you how to care for it later.",
    action: "Tap Adopt the pup, or design your own.",
    elementIds: ["tutorial-sanctuary-pup", "tutorial-pet-acquisition"],
    page: "/pets",
    advanceOn: "petAdopt",
    showNextButton: true,
  },
  // Chapter 6: Graduation
  {
    id: "genin-debrief",
    chapter: "genin",
    title: "Graduation",
    description:
      "You did well out there, better than most graduates. That metal the courier dropped... show it to no one; I'll take it to the academy archives myself. Now, you have earned your graduation.",
    action: "Open Quests and answer me there to complete the Academy Trials.",
    questsTabPrompt: "Answer Lemu to complete the Academy Trials.",
    page: "/pets",
    relatedValue: TUTORIAL_STARTER_QUEST_ID,
    objectiveId: STARTER_QUEST_OBJECTIVES.debrief,
    advanceOn: "questDialog",
  },
  {
    id: "genin-level-up",
    chapter: "genin",
    title: "Level 5",
    description:
      "The Academy Trials paid out experience and ryo. The Genin exam asks for level 5, and you know how to get there by now.",
    action: "Assign your experience and reach level 5.",
    page: TUTORIAL_ANY_PAGE,
    advanceOn: "levelUp",
  },
  // Chapter 7: The Genin Exam
  {
    id: "exam-walk",
    chapter: "exam",
    title: "The exam hall",
    description: (
      <>
        Your <b>Road to Genin</b> has begun, and the exam is held right here on Wake
        Island, in the Administration Building at the{" "}
        <MapPin className="inline-block h-4 w-4 text-red-500" /> marker. Tap the ground
        next to it and you will walk there.
      </>
    ),
    action: "Tap the ground next to the marker to walk there.",
    elementIds: ["tutorial-travel-sector"],
    teachOnPage: true,
    page: "/travel",
    relatedValue: TUTORIAL_GENIN_EXAM_QUEST_ID,
    objectiveId: GENIN_QUEST_OBJECTIVES.exam,
    autoTravelLabel: "Walk to the exam",
  },
  {
    id: "exam-proctor",
    chapter: "exam",
    title: "The practical test",
    description:
      "The proctor sends a clone to test you, and you must beat it to pass. No more pointers from me: win with what you have learned, jutsu, ninja tools and basic attacks alike. There is no time limit, so take your time.",
    action: "Defeat the proctor's clone.",
    elementIds: ["tutorial-combat-field"],
    page: "/combat",
    relatedValue: TUTORIAL_GENIN_EXAM_QUEST_ID,
    objectiveId: GENIN_QUEST_OBJECTIVES.proctor,
    onCombatWin: "exam-tour",
    onCombatLoss: "exam-proctor-retry",
  },
  {
    id: "exam-proctor-retry",
    chapter: "exam",
    title: "Not this time",
    description:
      "The clone won this round. Every Genin has lost a fight, and every loss teaches something. Did you spend all your Action Points each turn? Did you use your jutsu whenever they were ready, and your ninja tools while they recharged? Fill your chakra and stamina with ramen if they ran low, then face the clone again.",
    action: "Tap Retry battle when you are ready.",
    page: "/travel",
    relatedValue: TUTORIAL_GENIN_EXAM_QUEST_ID,
    objectiveId: GENIN_QUEST_OBJECTIVES.proctor,
    onCombatWin: "exam-tour",
    onCombatLoss: "exam-proctor-retry",
  },
  {
    id: "exam-tour",
    chapter: "exam",
    title: "Wake Island",
    description:
      "You passed, and the proctor has one question left. Wake Island belongs to no village, so every shinobi meets there.",
    action: "Open Quests and answer the proctor there.",
    questsTabPrompt: "Answer the proctor.",
    page: "/travel",
    relatedValue: TUTORIAL_GENIN_EXAM_QUEST_ID,
    objectiveId: GENIN_QUEST_OBJECTIVES.tour,
    advanceOn: "questDialog",
    quoteObjective: true,
  },
  {
    id: "exam-choose",
    chapter: "exam",
    title: "Choose your village",
    description:
      "This is the biggest choice of your career: your village is your home for good. It decides who fights beside you, the missions you are given and the village bloodline you can earn.",
    action: "Pick the village you want to join, then confirm.",
    page: "/travel",
    relatedValue: TUTORIAL_GENIN_EXAM_QUEST_ID,
    objectiveId: GENIN_QUEST_OBJECTIVES.choose,
    advanceOn: "questDialog",
  },
  {
    id: "exam-joined",
    chapter: "exam",
    title: "A new home",
    description: "Your new village is expecting you.",
    action: "Open Quests and answer the proctor there.",
    questsTabPrompt: "Answer the proctor.",
    page: "/travel",
    relatedValue: TUTORIAL_GENIN_EXAM_QUEST_ID,
    objectiveId: GENIN_QUEST_OBJECTIVES.join,
    advanceOn: "questDialog",
    quoteObjective: true,
  },
  {
    id: "exam-report",
    chapter: "exam",
    title: "Report for duty",
    description: (
      <>
        Every new Genin reports to their village&apos;s mission hall, at the{" "}
        <MapPin className="inline-block h-4 w-4 text-red-500" /> marker. Find your
        village on the Global map and travel there, then walk to the marker. The journey
        takes only a few seconds.
      </>
    ),
    action: "Travel home, then walk to the marker.",
    teachOnPage: true,
    page: "/travel",
    relatedValue: TUTORIAL_GENIN_EXAM_QUEST_ID,
    objectiveId: GENIN_QUEST_OBJECTIVES.report,
    autoTravelLabel: "Travel home",
  },
  {
    id: "exam-claim",
    chapter: "exam",
    title: "Your headband",
    description:
      "You made it. Claim your reward to receive the Genin rank and your headband.",
    action: "Open Quests and claim your reward there.",
    questsTabPrompt: "Collect your reward to become a Genin.",
    page: "/travel",
    relatedValue: TUTORIAL_GENIN_EXAM_QUEST_ID,
    objectiveId: GENIN_QUEST_OBJECTIVES.win,
    advanceOn: "questReward",
  },
  {
    id: "exam-rank-up",
    chapter: "exam",
    title: "Genin",
    description: "Congratulations, Genin!",
    page: "/village",
    screen: "rankUp",
  },
  {
    id: "exam-tomorrow",
    chapter: "exam",
    title: "Tomorrow",
    description: "Here's what tomorrow brings.",
    page: "/village",
    screen: "tomorrow",
  },
  {
    id: "exam-dashboard",
    chapter: "exam",
    title: "Your Dashboard",
    description:
      "This Dashboard is home base: everything waiting for you today is listed under <b>Right now</b>. Start with the first day of your daily streak. Then settle in, and when you're ready, come find me at the <b>Academy</b>: someone wants to see that shard.",
    action: "Claim day 1 of your streak.",
    elementIds: ["tutorial-dashboard-streak", "tutorial-dashboard-now"],
    page: "/profile?tab=dashboard",
    advanceOn: "claimStreak",
    showNextButton: true,
    nextLabel: "Finish",
  },
];
