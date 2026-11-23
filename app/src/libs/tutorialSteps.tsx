import { MapPin } from "lucide-react";
import { isValidElement, type ReactNode } from "react";
import {
  TUTORIAL_GENIN_EXAM_QUEST_ID,
  TUTORIAL_ITEM_ID,
  TUTORIAL_JUTSU_ID,
  TUTORIAL_STARTER_QUEST_ID,
} from "@/drizzle/constants";
import type { QuestsTabMarks } from "@/libs/questsTabLesson";
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
  { id: "arrival", title: "A Violet Flash" },
  { id: "academy", title: "Academy Trials" },
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
  /** What Lemu says while the scene that opens the step still plays on the map. */
  sceneLead?: { description: string; action: string };
  /** Marks the target without dimming the page, for a scene that plays around it. */
  isPageLit?: boolean;
  /** Element brought into view, unmarked, while no target is on screen. */
  revealId?: string;
  /**
   * Elements to highlight instead for a player who took Express Trials, whose skipped
   * lessons taught the controls this step expects them to know.
   */
  expressElementIds?: string[];
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
   * The step's answer or reward is given on the Activity dock's Quests tab, which leads
   * with the quest, open, and returns to the lesson once the quest moves on. The lesson's
   * own buttons wait as with `teachOnPage`; `marks` sets how much of the tab points, and
   * `prompt` what the tab says to do there (by default, to answer or claim per `advanceOn`).
   */
  questsTab?: QuestsTabMarks;
  /** Game action that completes the step. */
  advanceOn?: TutorialTrigger;
  /**
   * Lemu's closing words once game data shows `advanceOn` has happened, or that there is
   * nothing left to do; the step then offers its Next button, labelled `nextLabel`,
   * instead of moving on.
   */
  afterAction?: { description: string; action: string; nextLabel?: string };
  /** Skipped while the player has no unassigned experience to spend. */
  needsUnassignedExperience?: boolean;
  showNextButton?: boolean;
  nextLabel?: string;
  proceedOnHighlightClick?: boolean;
  requiresGameMenu?: boolean;
  /** What the phone prompt to open the game menu says the step needs from it. */
  gameMenuLead?: string;
  /** The page the step's game-menu entry opens; there the step needs no menu. */
  gameMenuEntryPage?: string;
  /** The call to action on `gameMenuEntryPage`, where the entry is already open. */
  gameMenuEntryAction?: string;
  /**
   * What Lemu says once the player stands in the sector a trip-and-walk step sends them
   * to: only the walk is left, under its own shortcut label.
   */
  onArrival?: {
    description?: string | React.ReactNode;
    action: string;
    autoTravelLabel?: string;
  };
  /** What Lemu says instead where the game menu is the sidebar beside the page. */
  sidebarDescription?: string;
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
  chapter: "academy",
  title: "Patched up",
  description:
    "Every shinobi loses a fight now and then. You'll be discharged for free when the timer runs out, or you can pay a little ryo to heal right away.",
  action: "Heal or wait, then we'll try again.",
  page: "/hospital",
  elementIds: ["tutorial-hospital-buttons"],
};

const starterLogbookEntry = `logbook-entry-${TUTORIAL_STARTER_QUEST_ID}`;
// The marker of the quest objective on the sector map, ahead of the map around it.
const sectorTargetElements = ["tutorial-objective-marker", "tutorial-travel-sector"];
// What a story scene on the sector map points at, and the map it plays on.
const mapSceneTarget = {
  elementIds: ["tutorial-map-target"],
  revealId: "tutorial-travel-sector",
  isPageLit: true,
};
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
  // Chapter 1: A Violet Flash
  {
    id: "arrival-welcome",
    chapter: "arrival",
    title: "Welcome to Horizon",
    description:
      "You made it! I'm <b>Lemu</b>, your instructor from today. This is <b>Horizon</b>, where every shinobi begins. Come, walk with me.",
    action: "Tap the marked ground to walk over to me.",
    ...mapSceneTarget,
    page: "/travel",
    objectiveId: STARTER_QUEST_OBJECTIVES.stand,
    advanceOn: "sectorWalk",
  },
  {
    id: "arrival-ambush",
    chapter: "arrival",
    title: "A violet flash",
    description:
      "That poor pup! Its hunter left a <b>smoke double</b> to stop us. Breathe, and attack it when you're ready. I'm right here.",
    action: "Tap the smoke double to attack it.",
    // The double on the map is the answer; the dock's own button helps a stuck player.
    teachOnPage: true,
    sceneLead: {
      description: "That light on the ridge... Stay close to me!",
      action: "Watch the map.",
    },
    ...mapSceneTarget,
    page: "/travel",
    relatedValue: TUTORIAL_STARTER_QUEST_ID,
    objectiveId: STARTER_QUEST_OBJECTIVES.stand,
    advanceOn: "questDialog",
  },
  {
    id: "combat-battlefield",
    chapter: "arrival",
    title: "The battlefield",
    description:
      "Fights play out on a grid of hexagonal tiles. The double stands just two tiles away. You act by choosing an action below the field and then tapping a tile on it.",
    elementIds: ["tutorial-combat-field"],
    page: "/combat",
    relatedValue: TUTORIAL_STARTER_QUEST_ID,
    objectiveId: STARTER_QUEST_OBJECTIVES.double,
    showNextButton: true,
    onCombatWin: "combat-claim-reward",
    onCombatLoss: "combat-rematch",
  },
  {
    id: "combat-turns",
    chapter: "arrival",
    title: "Turns and Action Points",
    description:
      "Each turn you get <b>100 Action Points (AP)</b>, shown on this bar: moving costs 10 AP and a basic attack 20. There is no time limit while I'm with you, and I'll guide your first turn.",
    elementIds: ["tutorial-combat-action-timer"],
    page: "/combat",
    relatedValue: TUTORIAL_STARTER_QUEST_ID,
    objectiveId: STARTER_QUEST_OBJECTIVES.double,
    showNextButton: true,
    onCombatWin: "combat-claim-reward",
    onCombatLoss: "combat-rematch",
  },
  {
    id: "combat-fight",
    chapter: "arrival",
    title: "Fight!",
    description: "Defeat the smoke double.",
    elementIds: ["tutorial-combat-field"],
    page: "/combat",
    relatedValue: TUTORIAL_STARTER_QUEST_ID,
    objectiveId: STARTER_QUEST_OBJECTIVES.double,
    onCombatWin: "combat-claim-reward",
    onCombatLoss: "combat-rematch",
  },
  {
    id: "combat-rematch",
    chapter: "arrival",
    title: "Back on your feet",
    description:
      "I drove the double off, but it is circling back. Step next to it, and spend all your Action Points striking before you end your turn.",
    action: "Tap the smoke double to attack it again.",
    ...mapSceneTarget,
    page: "/travel",
    relatedValue: TUTORIAL_STARTER_QUEST_ID,
    objectiveId: STARTER_QUEST_OBJECTIVES.double,
    onCombatWin: "combat-claim-reward",
    onCombatLoss: "combat-rematch",
  },
  {
    id: "combat-claim-reward",
    chapter: "arrival",
    title: "Only smoke",
    description:
      "The double bursts into violet smoke, and the hunter it was shielding is gone. You held your ground without a day of training! Deeds like that earn rewards, and they wait in your <b>logbook</b> until you claim them.",
    action: "Tap Claim in your logbook to collect your reward.",
    elementIds: ["tutorial-objective-claim"],
    teachOnPage: true,
    page: "/profile",
    relatedValue: TUTORIAL_STARTER_QUEST_ID,
    objectiveId: STARTER_QUEST_OBJECTIVES.double,
    advanceOn: "questReward",
  },
  // Chapter 2: The Academy Trials
  {
    id: "combat-assign-notice",
    chapter: "academy",
    title: "Unassigned experience",
    description:
      "Experience from quests goes into the stats you choose. New experience always shows up here.",
    action: "Tap Assign XP.",
    elementIds: ["tutorial-unassigned-stats"],
    page: "/profile",
    proceedOnHighlightClick: true,
    requiresGameMenu: true,
    gameMenuLead: "Your new experience waits under Assign XP in the game menu.",
    needsUnassignedExperience: true,
  },
  {
    id: "combat-assign-form",
    chapter: "academy",
    title: "Choose your strengths",
    description:
      "Each specialization raises <b>Offence</b> (harder hits) and <b>Defence</b> (softer blows), plus two of the stats your techniques draw on. Pick the one that fits how you want to fight; <b>Advanced</b> lets you place each point yourself later.",
    action: "Tap Mind, Body, Resolve or Tactics, then Proceed.",
    elementIds: assignElements,
    page: "/profile/experience",
    advanceOn: "assignStats",
    needsUnassignedExperience: true,
  },
  {
    id: "combat-level-up",
    chapter: "academy",
    title: "Level up!",
    description:
      "Your experience now covers level 2. Every level raises your maximum health, chakra and stamina.",
    action: "Tap Level up!, then Awesome!",
    elementIds: levelUpElements,
    page: "/profile/experience",
    advanceOn: "levelUp",
  },
  {
    id: "academy-building",
    chapter: "academy",
    title: "To the academy",
    description:
      "Whoever that was will be back, and we'll be ready. The <b>location menu</b> always shows what the place you stand in offers, and every building in Horizon offers something different. Your training begins at the academy.",
    action: "Tap Academy.",
    elementIds: ["tutorial-academy"],
    page: "/village",
    objectiveId: STARTER_QUEST_OBJECTIVES.accept,
    proceedOnHighlightClick: true,
  },
  {
    id: "academy-accept-trials",
    chapter: "academy",
    title: "Your first quest",
    description:
      "Quests are how you progress: chains of objectives with rewards along the way. Your active quests are always in your <b>logbook</b>. Your first one is the <b>Academy Trials</b>.",
    action: "Answer me in the Academy Trials to accept them.",
    elementIds: ["tutorial-dialog-options", starterLogbookEntry],
    teachOnPage: true,
    page: "/academy",
    relatedValue: TUTORIAL_STARTER_QUEST_ID,
    objectiveId: STARTER_QUEST_OBJECTIVES.accept,
    advanceOn: "questDialog",
  },
  {
    id: "tools-training-building",
    chapter: "academy",
    title: "Training Grounds",
    description:
      "Courage carried you through that fight. Next time you'll have skill as well: shinobi grow through daily training. Let's visit the training grounds.",
    action: "Tap Training Grounds.",
    elementIds: ["tutorial-traininggrounds"],
    page: "/village",
    proceedOnHighlightClick: true,
  },
  {
    id: "tools-train-stat",
    chapter: "academy",
    title: "Train with Energy",
    description:
      "Training spends <b>Energy</b> to raise a stat instantly. I've set aside a small amount so you can see what it buys.",
    action: "Tap Offence to train it.",
    elementIds: ["tutorial-traininggrounds-offence"],
    page: "/traininggrounds",
    advanceOn: "trainStats",
  },
  {
    id: "tools-queue-energy",
    chapter: "academy",
    title: "The Energy queue",
    description:
      "Energy refills over time, even while you are offline. The <b>Energy queue</b> spends it for you as it comes back, so your training never stops.",
    action: "Tap Defence to queue the rest of your Energy.",
    elementIds: ["tutorial-traininggrounds-defence"],
    page: "/traininggrounds",
    advanceOn: "queueEnergy",
  },
  {
    id: "tools-train-jutsu",
    chapter: "academy",
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
    chapter: "academy",
    title: "Objective complete",
    description:
      "Learning a jutsu completed your first trial. You can use Sonic Slash in battle right away, even while it finishes training.",
    action: "Open Quests and claim your reward there.",
    questsTab: { marks: "all", prompt: "Claim your reward here." },
    page: "/traininggrounds",
    relatedValue: TUTORIAL_STARTER_QUEST_ID,
    objectiveId: STARTER_QUEST_OBJECTIVES.jutsu,
    objectiveStepId: TUTORIAL_JUTSU_PICK_STEP_ID,
    advanceOn: "questReward",
  },
  // Chapter 3: Tools of the Trade
  {
    id: "tools-assign",
    chapter: "tools",
    title: "Grow stronger",
    description:
      "Your jutsu trial earned you more experience. New experience always waits under <b>Assign XP</b> in the game menu. This time the choice is yours: pick a specialization again, or open <b>Advanced</b> and place each point where you want it.",
    sidebarDescription:
      "Your jutsu trial earned you more experience. New experience always waits under <b>Assign XP</b>, in the <b>Notifications</b> at the top of the right sidebar. This time the choice is yours: pick a specialization again, or open <b>Advanced</b> and place each point where you want it.",
    action: "Open Assign XP and spend your experience.",
    elementIds: ["tutorial-unassigned-stats"],
    page: TUTORIAL_ANY_PAGE,
    requiresGameMenu: true,
    gameMenuLead: "Your new experience waits under Assign XP in the game menu.",
    gameMenuEntryPage: "/profile/experience",
    gameMenuEntryAction:
      "Pick a specialization, or open Advanced and place each point.",
    advanceOn: "assignStats",
    needsUnassignedExperience: true,
  },
  {
    id: "tools-level-up",
    chapter: "tools",
    title: "Level 3",
    description:
      "That covers another level. A <b>Level up</b> button shows on your profile and on the experience page whenever you have earned one.",
    action: "Tap Level up! to take level 3.",
    // The same Level up button on the experience page, the profile and the dashboard.
    elementIds: [
      "tutorial-level-up-experience",
      "tutorial-level-up-btn",
      "tutorial-level-up-dashboard",
    ],
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
  },
  {
    id: "arena-building",
    chapter: "tools",
    title: "The Battle Arena",
    description:
      "The double took all those small hits to bring down. Let's see what a jutsu does! The arena is where you test yourself against training opponents, as often as you like.",
    action: "Tap Battle Arena.",
    elementIds: ["tutorial-battlearena"],
    page: "/village",
    objectiveId: STARTER_QUEST_OBJECTIVES.arena,
    proceedOnHighlightClick: true,
  },
  {
    id: "arena-enter",
    chapter: "tools",
    title: "Your second trial",
    description:
      "I've picked the <b>Academy Dummy</b> for you. Auto combat stays off while you train with me, so you strike with your own hands. Open with Sonic Slash.",
    action: "Tap the Fight button.",
    elementIds: ["tutorial-battlearena-challenge-ai-enter"],
    page: "/battlearena",
    objectiveId: STARTER_QUEST_OBJECTIVES.arena,
    advanceOn: "arenaStart",
  },
  {
    id: "arena-fight",
    chapter: "tools",
    title: "Put it to work",
    description: "Defeat the Academy Dummy with what you have learned.",
    elementIds: ["tutorial-combat-field"],
    page: "/combat",
    objectiveId: STARTER_QUEST_OBJECTIVES.arena,
    onCombatWin: "mission-brief",
    onCombatLoss: "arena-enter",
  },
  // Chapter 4: The Missing Pup
  {
    id: "mission-brief",
    chapter: "mission",
    title: "A real mission",
    description:
      "The pup that ran past us belongs to the <b>Bondkeeper Sanctuary</b>. A hunter has seen it cornered on the eastern ridge, with the masked figure closing in. Your final trial: find the pup and bring it back safely.",
    action: "Accept the mission in the Academy Trials.",
    elementIds: [starterLogbookEntry],
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
      "Missions take you out into the world of Seichi. The travel map shows both the sector you stand in and the whole globe. The menu button in its header holds the map's other controls.",
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
      "The pup fled beyond the walls, to the sector marked on the <b>Global</b> map. Trips between sectors take a little time: follow your character along the route as the arrival timer counts down. Don't worry, I'm coming with you.",
    action: "Open the Global tab, tap the marked sector, then confirm with Travel.",
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
        figure is with it: no double this time. They won&apos;t hand it over, so use
        everything you have. I&apos;ll call out what I see, but the fight is yours.
      </>
    ),
    action: "Tap the marker to walk to it.",
    elementIds: sectorTargetElements,
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
      "The masked courier hurls a smoke pellet and vanishes. Where they stood lies a sliver of <b>dark metal</b>, threaded with violet veins, and the pup's collar is scorched the same violet. Strange... Let's get it home first.",
    action: "Open Quests and claim your reward there.",
    questsTab: { marks: "tab" },
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
      "Fights spend <b>Stamina</b> (basic attacks) and <b>Chakra</b> (jutsu). Both refill slowly on their own, and a bowl of ramen refills them at once. The Horizon ramen shop delivers to Academy patrols, and a small bowl costs only a few ryo: remember where it is for after a hard fight.",
    action: "Order a bowl of ramen.",
    elementIds: ["tutorial-ramen-menu"],
    page: "/ramenshop",
    advanceOn: "buyRamen",
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
      "The pup wears a Bondkeeper tag: it belongs to the sanctuary on <b>Wake Island</b>, a short trip from here. Wake Island is neutral ground every village shares, and your Genin exam is held there.",
    action: "Travel to Wake Island on the Global map.",
    // The second trip points at its entry alone; the lesson's own trip keeps its ring.
    elementIds: ["tutorial-auto-travel-proceed", "tutorial-Global"],
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
      "Here we are. Wake Island's buildings open from the location menu, just like at home.",
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
      "The Bondkeepers rush out to meet you, the pup wriggling in your arms at the sight of them, and their elder bows low to thank you for bringing it home.",
    action: "Open Quests and hand over the pup there.",
    questsTab: { marks: "all", prompt: "Answer to hand over the pup." },
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
  },
  // Chapter 6: Graduation
  {
    id: "genin-debrief",
    chapter: "genin",
    title: "Graduation",
    description:
      "You did well out there, better than most graduates. That metal the courier left behind... show it to no one; I'll take it to the academy archives myself. Now, you have earned your graduation.",
    action: "Open Quests and answer me there to complete the Academy Trials.",
    questsTab: { marks: "none", prompt: "Answer here to complete the Academy Trials." },
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
      "The Genin exam asks for level 5. Spend your experience on the stats you want, then take the levels it covers.",
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
        Your <b>Road to Genin</b> has begun. The exam is held right here on Wake Island,
        in the Administration Building at the{" "}
        <MapPin className="inline-block h-4 w-4 text-red-500" /> marker.
      </>
    ),
    action: "Tap the marker on the Administration Building to walk there.",
    elementIds: sectorTargetElements,
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
      "The proctor sends a clone to test you, and you must beat it to pass. No more pointers from me: win with what you have learned, using every action your bar offers. There is no time limit, so take your time.",
    action: "Defeat the proctor's clone.",
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
      "The clone won this round, and every Genin has lost a fight. Spend all your Action Points each turn, and use your strongest action whenever it is ready. Low on chakra or stamina? Have a bowl of ramen first.",
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
    title: "Exam passed",
    description: "You passed! The proctor has one last question for you.",
    action: "Open Quests and answer the proctor there.",
    questsTab: { marks: "none", prompt: "Answer the proctor here." },
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
      "This is the biggest choice of your career, so read about each village before you pick.",
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
    description: "Answer <b>Travel home</b> in Quests, and I'll show you the way.",
    action: "Open Quests and answer the proctor there.",
    questsTab: { marks: "none", prompt: "Answer the proctor here." },
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
        <MapPin className="inline-block h-4 w-4 text-red-500" /> marker. On the Global
        tab the globe turns to your village, marked with <b>!</b>. Travel there, then
        walk to the marker. The journey takes only a few seconds.
      </>
    ),
    action: "Travel home, then walk to the marker.",
    // Players who took the trials' trips find home on their own.
    expressElementIds: [...globalTravelElements, "tutorial-Global"],
    teachOnPage: true,
    page: "/travel",
    relatedValue: TUTORIAL_GENIN_EXAM_QUEST_ID,
    objectiveId: GENIN_QUEST_OBJECTIVES.report,
    autoTravelLabel: "Travel home",
    onArrival: {
      description: (
        <>
          Welcome home. Every new Genin reports to their village&apos;s mission hall, at
          the <MapPin className="inline-block h-4 w-4 text-red-500" /> marker.
        </>
      ),
      action: "Walk to the marker: tap it on the map.",
      autoTravelLabel: "Walk to the marker",
    },
  },
  {
    id: "exam-claim",
    chapter: "exam",
    title: "Your headband",
    description:
      "You made it. Claim your reward to receive the Genin rank and your headband.",
    action: "Open Quests and tap Claim there.",
    questsTab: { marks: "none" },
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
      "This Dashboard is home base: <b>Right now</b> lists everything waiting for you today. Start with the first day of your daily streak.",
    action: "Claim day 1 of your streak.",
    elementIds: ["tutorial-dashboard-streak", "tutorial-dashboard-now"],
    page: "/profile?tab=dashboard",
    advanceOn: "claimStreak",
    afterAction: {
      description:
        "Day 1 is yours. Settle in, and when you're ready, come find me at the <b>Academy</b>: the archives have turned up something you should see.",
      action: "Tap Finish when you're ready.",
      nextLabel: "Finish",
    },
  },
];

/** Seconds a new player takes to read one word of a lesson (about 200 words a minute). */
const LESSON_SECONDS_PER_WORD = 0.3;

/** Seconds a new player needs to read a lesson's text, any quoted objective and its call to action. */
export const lessonReadingSeconds = (
  step: Pick<TutorialStepConfig, "description" | "action">,
  quote?: string,
) =>
  `${nodeText(step.description)} ${quote ?? ""} ${step.action ?? ""}`
    .replace(/<[^>]+>/g, " ")
    .split(/\s+/)
    .filter(Boolean).length * LESSON_SECONDS_PER_WORD;

/** The words a lesson shows, ignoring inline markup and icons. */
const nodeText = (node: ReactNode): string => {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join(" ");
  if (isValidElement<{ children?: ReactNode }>(node))
    return nodeText(node.props.children);
  return "";
};
