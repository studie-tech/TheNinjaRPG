import { MapPin } from "lucide-react";
import { isValidElement, type ReactNode } from "react";
import {
  IMG_BONDKEEPER_ELDER,
  TUTORIAL_GENIN_EXAM_QUEST_ID,
  TUTORIAL_ITEM_ID,
  TUTORIAL_JUTSU_ID,
  TUTORIAL_STARTER_QUEST_ID,
} from "@/drizzle/constants";
import type { GuidedLessonMark } from "@/layout/tutorial/guidedLesson";
import type { StoryRole } from "@/libs/storyScene";
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
  /**
   * The call to action while one of the elements is the highlighted one, for a control
   * pressed on the way to the step's target, such as the tab that holds it.
   */
  elementActions?: Partial<Record<string, string>>;
  /** The words while one of the elements is the highlighted one, for a control that needs its own. */
  elementDescriptions?: Partial<Record<string, string>>;
  /** Who says the words in the lesson's box, when it is not Lemu. */
  speaker?: { name: string; image: string };
  /** Further elements the words refer to, each marked with its name. */
  marks?: GuidedLessonMark[];
  /** What Lemu says while the scene that opens the step still plays on the map. */
  sceneLead?: { description: string; action: string };
  /** Figures the sector map shows while the player is on the step. */
  mapScene?: TutorialMapScene;
  /**
   * The page whose scene takes the step's answer or reward, when its own controls do. The
   * lesson's button waits for a stuck player there, and shows at once on any other page.
   */
  scenePage?: string;
  /** The target stands in a scene, which is scrolled no further than the target needs. */
  isInScene?: boolean;
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
   * The step's reward is claimed on the Activity dock's Quests tab, which leads with the
   * quest, open, and returns to the lesson once the quest moves on. `prompt` is what the
   * tab says to do there.
   */
  questsTab?: { prompt?: string };
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
  /** The page the marked control leads to; reaching it, by any way, completes the step. */
  arrivesAt?: string;
  /**
   * What Lemu says on the way to the step's page, while the player is on another one. The
   * way itself is worked out from there (see `getTutorialWay`): the player always makes
   * the move. Left out, the way speaks for itself.
   */
  wayLead?: string;
  /** Set on the way to a step: where the next move leads, for a player who cannot find it. */
  wayHref?: string;
  requiresGameMenu?: boolean;
  /** What the phone prompt to open the game menu says the step needs from it. */
  gameMenuLead?: string;
  /** The page the step's game-menu entry opens; there the step needs no menu. */
  gameMenuEntryPage?: string;
  /** What Lemu says on `gameMenuEntryPage`, where the entry is already open. */
  onEntryPage?: { description: string; action: string };
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

/**
 * Figures standing by the player on the sector map, the first of them speaking. Their bubble
 * holds the answer or reward the lesson waits for and they can be talked to, or the last
 * figure can be fought.
 */
export type TutorialMapScene = {
  cast: readonly StoryRole[];
  offers: "answer" | "claim" | "fight";
  /**
   * What the speaker says: their own words, or the lesson's or the quest objective's, which
   * the lesson then leaves out.
   */
  says: string | { from: "lesson" | "objective" };
};

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
};
// A speaker's answers on the map: in the dialog they open, or under their words.
const sceneAnswers = {
  elementIds: ["tutorial-npc-answers", "tutorial-story-answers"],
  isInScene: true,
};
// Who speaks for the Bondkeeper Sanctuary, in the box of its lessons.
const bondkeeperElder = { name: "Bondkeeper elder", image: IMG_BONDKEEPER_ELDER };
// The trip's confirmation and arrival timer, ahead of the controls that lead to them.
const globalTravelElements = [
  "tutorial-auto-travel-proceed",
  "tutorial-global-travel-proceed",
  "tutorial-travel-arrival",
];
const openStatsTab = { "tutorial-Stats": "Open the Stats tab." };
const openJutsuTab = { "tutorial-Jutsu": "Open the Jutsu tab." };
const assignElements = [
  "tutorial-specialization-confirm-proceed",
  "tutorial-specialization-options",
  "tutorial-unassigned-stats-contentbox",
];
// The same Level up button on the experience page, the profile and the dashboard, then the
// confirmation it opens.
const levelUpTarget = {
  elementIds: [
    "tutorial-level-up-modal-proceed",
    "tutorial-level-up-experience",
    "tutorial-level-up-btn",
    "tutorial-level-up-dashboard",
  ],
  elementActions: { "tutorial-level-up-modal-proceed": "Tap Awesome! to level up." },
};

export const TUTORIAL_STEPS: TutorialStepConfig[] = [
  // Chapter 1: A Violet Flash
  {
    id: "arrival-welcome",
    chapter: "arrival",
    title: "Welcome to Horizon",
    description:
      "There you are! I'm <b>Lemu</b>, your instructor from today. Welcome to <b>Horizon</b>, where every shinobi begins. Come, walk with me.",
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
      "Someone is hunting that pup, and left a <b>smoke double</b> to hold us back. Breathe. Strike it when you're ready; I'm right beside you.",
    action: "Tap the smoke double to attack it.",
    // The double on the map is the answer; the dock's own button helps a stuck player.
    teachOnPage: true,
    sceneLead: {
      description: "That light on the ridge... Stay behind me!",
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
    title: "Hold your ground",
    description:
      "Easy. It's only smoke, but it hits like the real thing, two tiles away on this grid. Pick an action below the field, then tap a tile to use it.",
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
    title: "Action Points",
    description:
      "Every move costs <b>Action Points</b> from this bar: you get 100 a turn, a step costs 10 and a strike 20. There's no clock, and I'll call your first moves.",
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
    description: "Strike until it breaks apart.",
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
      "I drove it back, but it's circling round. Get next to it, and spend every Action Point striking before you end your turn.",
    action: "Tap the smoke double to attack it again.",
    ...mapSceneTarget,
    scenePage: "/travel",
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
    wayLead:
      "Only smoke... and the hunter is long gone, after the pup. Still, you held your ground on your very first day. That earns a reward: it waits in the logbook on your <b>profile</b>.",
    description:
      "Your <b>logbook</b> keeps your quests, and their rewards until you claim them.",
    action: "Tap Claim to collect your reward.",
    // The Character tab holds the logbook, for a profile that opened on another one.
    elementIds: ["tutorial-objective-claim", "tutorial-Character"],
    elementActions: { "tutorial-Character": "Open the Character tab." },
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
      "That fight taught you something. Experience goes into the stats you choose, and new experience always shows up here.",
    action: "Tap Assign XP.",
    elementIds: ["tutorial-unassigned-stats"],
    page: TUTORIAL_ANY_PAGE,
    arrivesAt: "/profile/experience",
    requiresGameMenu: true,
    gameMenuLead: "Your new experience waits under Assign XP in the game menu.",
    needsUnassignedExperience: true,
  },
  {
    id: "combat-assign-form",
    chapter: "academy",
    title: "Choose your strengths",
    description:
      "How do you want to fight? Each path raises <b>Offence</b> (harder hits) and <b>Defence</b> (softer blows), plus two of the stats your techniques draw on. <b>Advanced</b> lets you place each point yourself later.",
    action: "Tap Mind, Body, Resolve or Tactics, then Proceed.",
    elementIds: assignElements,
    elementActions: {
      "tutorial-specialization-confirm-proceed":
        "Tap Proceed, or Close to pick another.",
    },
    page: "/profile/experience",
    advanceOn: "assignStats",
    needsUnassignedExperience: true,
  },
  {
    id: "combat-level-up",
    chapter: "academy",
    title: "Level up!",
    description:
      "That's enough for level 2, and more health, chakra and stamina with it. You'll need them.",
    action: "Tap Level up!, then Awesome!",
    ...levelUpTarget,
    page: "/profile/experience",
    advanceOn: "levelUp",
  },
  {
    id: "academy-building",
    chapter: "academy",
    title: "To the academy",
    wayLead:
      "That hunter will be back, and we'll make sure you're ready. Your training begins at the academy, here in Horizon. The <b>location menu</b> always opens the place you stand in.",
    description:
      "Every building in Horizon has its use. Yours today is the <b>academy</b>.",
    action: "Tap Academy.",
    elementIds: ["tutorial-academy"],
    page: "/village",
    objectiveId: STARTER_QUEST_OBJECTIVES.accept,
    arrivesAt: "/academy",
  },
  {
    id: "academy-accept-trials",
    chapter: "academy",
    title: "Your first quest",
    description:
      "Quests move you forward, with rewards along the way, and your <b>logbook</b> keeps them. Your first is the <b>Academy Trials</b>: they'll make a shinobi of you.",
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
    wayLead:
      "Courage got you through one fight. Skill will get you through the rest. The training grounds are back through the <b>location menu</b>.",
    description:
      "Shinobi grow a little every day, and the <b>training grounds</b> are where it happens.",
    action: "Tap Training Grounds.",
    elementIds: ["tutorial-traininggrounds"],
    page: "/village",
    arrivesAt: "/traininggrounds",
  },
  {
    id: "tools-energy",
    chapter: "academy",
    title: "Your Energy",
    description:
      "Training costs <b>Energy</b> (EP). This bar shows yours, and it refills by itself over time.",
    elementIds: ["tutorial-training-energy", "tutorial-Stats"],
    elementActions: openStatsTab,
    marks: [{ selector: "#tutorial-sidebar-energy", label: "Always shown here" }],
    page: "/traininggrounds",
    showNextButton: true,
  },
  {
    id: "tools-train-stat",
    chapter: "academy",
    title: "Train with Energy",
    description:
      "Pick a stat, and the Energy chosen above goes into it at once. <b>Max</b> spends all you have. That double hit hard, so start with Offence.",
    action: "Tap Offence to train it.",
    elementIds: ["tutorial-traininggrounds-offence", "tutorial-Stats"],
    elementActions: openStatsTab,
    marks: [
      { selector: "#tutorial-training-energy", label: "Your Energy" },
      { selector: "#tutorial-training-amount", label: "What you spend" },
    ],
    page: "/traininggrounds",
    advanceOn: "trainStats",
  },
  {
    id: "tools-queue-energy",
    chapter: "academy",
    title: "The Energy queue",
    description:
      "All spent! It refills over time, even while you're away, and in <b>Queue</b> mode you decide now what it trains next.",
    action: "Now tap Defence to queue it.",
    elementIds: [
      "tutorial-training-queue",
      "tutorial-traininggrounds-defence",
      "tutorial-Stats",
    ],
    elementActions: { ...openStatsTab, "tutorial-training-queue": "Tap Queue." },
    marks: [{ selector: "#tutorial-training-energy", label: "Refilling" }],
    page: "/traininggrounds",
    advanceOn: "queueEnergy",
  },
  {
    id: "tools-queue-check",
    chapter: "academy",
    title: "Training is queued",
    description:
      "There's your <b>Energy queue</b>. Once your Energy is back, it trains Defence by itself, even while you sleep. Remove an entry any time.",
    elementIds: ["tutorial-energy-queue", "tutorial-Stats"],
    elementActions: openStatsTab,
    page: "/traininggrounds",
    showNextButton: true,
  },
  {
    id: "tools-train-jutsu",
    chapter: "academy",
    title: "Your first jutsu",
    description:
      "Now, a real technique. I've put <b>Sonic Slash</b> first in the <b>Jutsu</b> tab: a piercing blade strike from a few tiles away. That double wouldn't have lasted. It costs a little ryo.",
    action: "Tap Sonic Slash, then Learn.",
    elementIds: [
      "tutorial-traininggrounds-trainJutsu-proceed",
      `tutorial-combat-action-${TUTORIAL_JUTSU_ID}`,
      "tutorial-Jutsu",
    ],
    elementActions: openJutsuTab,
    page: "/traininggrounds",
    objectiveId: STARTER_QUEST_OBJECTIVES.jutsu,
    advanceOn: "trainJutsu",
  },
  {
    id: "tools-jutsu-check",
    chapter: "academy",
    title: "Sonic Slash in training",
    description:
      "Sonic Slash needs a minute in your <b>training queue</b>, but a new jutsu is equipped at once: you can use it in battle already.",
    elementIds: ["tutorial-jutsu-queue", "tutorial-Jutsu"],
    elementActions: openJutsuTab,
    page: "/traininggrounds",
    showNextButton: true,
  },
  {
    id: "tools-claim-jutsu",
    chapter: "academy",
    title: "Objective complete",
    description:
      "Your first trial, done! Rewards wait on the <b>Quests</b> tab here too, with no trip to your profile.",
    action: "Open Quests and claim your reward there.",
    questsTab: { prompt: "Claim your reward here. Then I'll go on." },
    page: TUTORIAL_ANY_PAGE,
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
      "Your trial paid out in experience, and it waits under <b>Assign XP</b> in the game menu. Your call this time: a specialization again, or <b>Advanced</b> to place each point yourself.",
    sidebarDescription:
      "Your trial paid out in experience, and it waits under <b>Assign XP</b>, in the <b>Notifications</b> at the top of the right sidebar. Your call this time: a specialization again, or <b>Advanced</b> to place each point yourself.",
    action: "Open Assign XP and spend your experience.",
    elementIds: ["tutorial-unassigned-stats"],
    page: TUTORIAL_ANY_PAGE,
    requiresGameMenu: true,
    gameMenuLead: "Your new experience waits under Assign XP in the game menu.",
    gameMenuEntryPage: "/profile/experience",
    onEntryPage: {
      description:
        "Your call this time: a specialization again, or <b>Advanced</b> to place each point yourself.",
      action: "Pick a specialization, or open Advanced.",
    },
    revealId: "tutorial-specialization-options",
    advanceOn: "assignStats",
    needsUnassignedExperience: true,
  },
  {
    id: "tools-level-up",
    chapter: "tools",
    title: "Level 3",
    description:
      "Level 3 already! A <b>Level up</b> button shows on your profile and the experience page whenever you've earned one.",
    action: "Tap Level up! to take level 3.",
    ...levelUpTarget,
    page: TUTORIAL_ANY_PAGE,
    advanceOn: "levelUp",
  },
  {
    id: "tools-itemshop-building",
    chapter: "tools",
    title: "Item Shop",
    wayLead:
      "Jutsu aren't your only weapons. The village shop has the rest, and you know the way by now.",
    description:
      "Ninja tools let you strike from a distance, and the <b>item shop</b> keeps them.",
    action: "Tap Item shop.",
    elementIds: ["tutorial-itemshop"],
    page: "/village",
    arrivesAt: "/itemshop",
  },
  {
    id: "tools-buy-shuriken",
    chapter: "tools",
    title: "Shuriken",
    description:
      "I had <b>Shuriken</b> put out front. They hit from range and are used up as you throw them. What you buy goes straight into a free slot, ready for battle.",
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
    wayLead:
      "That double took a lot of small hits. Let's see what a jutsu does! The village arena is the place to try.",
    description:
      "The <b>Battle Arena</b> has training opponents, as often as you like.",
    action: "Tap Battle Arena.",
    elementIds: ["tutorial-battlearena"],
    page: "/village",
    objectiveId: STARTER_QUEST_OBJECTIVES.arena,
    arrivesAt: "/battlearena",
  },
  {
    id: "arena-enter",
    chapter: "tools",
    title: "Your second trial",
    description:
      "I've picked the <b>Academy Dummy</b> for you in <b>Arena</b>. Auto combat stays off while you train with me: you strike with your own hands.",
    action: "Tap the Fight button.",
    elementIds: [
      "tutorial-battlearena-challenge-ai-enter",
      "tutorial-battlearena-mode-Arena",
      "tutorial-battlearena-tab-Arena",
    ],
    elementActions: {
      "tutorial-battlearena-mode-Arena": "Open Arena.",
      "tutorial-battlearena-tab-Arena": "Open Arena.",
    },
    marks: [{ selector: "#tutorial-battlearena-opponent", label: "Your opponent" }],
    page: "/battlearena",
    objectiveId: STARTER_QUEST_OBJECTIVES.arena,
    advanceOn: "arenaStart",
  },
  {
    id: "arena-fight",
    chapter: "tools",
    title: "Put it to work",
    description: "Show the dummy what Sonic Slash can do.",
    elementIds: ["tutorial-combat-field"],
    page: "/combat",
    objectiveId: STARTER_QUEST_OBJECTIVES.arena,
    onCombatWin: "tools-ramen",
    onCombatLoss: "arena-enter",
  },
  {
    id: "tools-ramen",
    chapter: "tools",
    title: "Refuel",
    wayLead:
      "Well fought! Fights spend <b>Stamina</b> on strikes and <b>Chakra</b> on jutsu. Both come back slowly by themselves, or at once over a bowl of ramen.",
    description:
      "A small bowl costs a few ryo and refills both. Remember this counter after a hard fight.",
    action: "Order a bowl of ramen.",
    elementIds: ["tutorial-ramen-menu"],
    page: "/ramenshop",
    advanceOn: "buyRamen",
  },
  // Chapter 4: The Missing Pup
  {
    id: "mission-brief",
    chapter: "mission",
    title: "A real mission",
    wayLead: "A hunter just ran into the <b>academy</b>. Someone has seen the pup!",
    description: "You heard him. Take the mission, and we're off.",
    action: "Accept the mission in the Academy Trials.",
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
      "The ridge lies beyond the walls, out in the wide world of Seichi. Your travel map shows this sector and the whole globe; its header menu holds the rest.",
    action: "Tap Travel in the main menu.",
    elementIds: ["tutorial-travel"],
    page: TUTORIAL_ANY_PAGE,
    objectiveId: STARTER_QUEST_OBJECTIVES.pup,
    arrivesAt: "/travel",
    requiresGameMenu: true,
  },
  {
    id: "mission-travel-to-pup",
    chapter: "mission",
    title: "The world map",
    description:
      "I've marked the ridge on the <b>Global</b> map, which opens turned towards it. Trips take a moment: watch the timer while you travel. I'm right behind you.",
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
        There! The pup, at the <MapPin className="inline-block h-4 w-4 text-red-500" />{" "}
        marker, and the masked figure with it: no double this time. Use everything
        I&apos;ve taught you. The fight starts the moment you reach them.
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
      "A smoke pellet, and they're gone! They dropped a sliver of <b>dark metal</b> with violet veins, and the pup's collar is scorched the same violet. Strange... Let's get it home first.",
    action: "Claim your reward.",
    ...sceneAnswers,
    scenePage: "/travel",
    mapScene: {
      cast: ["lemu", "pup"],
      offers: "claim",
      says: { from: "lesson" },
    },
    page: TUTORIAL_ANY_PAGE,
    relatedValue: TUTORIAL_STARTER_QUEST_ID,
    objectiveId: STARTER_QUEST_OBJECTIVES.pup,
    advanceOn: "questReward",
  },
  {
    id: "mission-level-up",
    chapter: "mission",
    title: "Level 4",
    description:
      "Your first mission paid well. No pointers this time: spend your experience as you see fit and take level 4. One more after that, and you're ready for the Genin exam.",
    action: "Assign your experience, then level up.",
    page: TUTORIAL_ANY_PAGE,
    advanceOn: "levelUp",
  },
  // Chapter 5: Bondkeepers
  {
    id: "bond-travel-wake",
    chapter: "bond",
    title: "Bring it home",
    wayLead:
      "Look at its collar tag: it's from the Bondkeeper Sanctuary on <b>Wake Island</b>. Open your map, and let's take it home.",
    description:
      "Its tag says <b>Wake Island</b>, a short trip from here: neutral ground every village shares, and where your Genin exam is held.",
    action: "Travel to Wake Island on the Global map.",
    // The second trip points at its entry alone; the lesson's own trip keeps its ring.
    elementIds: ["tutorial-auto-travel-proceed", "tutorial-Global"],
    revealId: "tutorial-global-map",
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
      "Wake Island! Smell that sea air? Its buildings open from the location menu, just like at home.",
    action: "Tap Wake Island in the location menu.",
    elementIds: ["tutorial-village"],
    page: TUTORIAL_ANY_PAGE,
    arrivesAt: "/village",
    requiresGameMenu: true,
  },
  {
    id: "bond-sanctuary-building",
    chapter: "bond",
    title: "The Bondkeeper Sanctuary",
    description:
      "The Bondkeepers care for the island's creatures, and pair them with shinobi they trust. The pup already knows the way.",
    action: "Tap Bondkeeper Sanctuary.",
    elementIds: ["tutorial-pets"],
    page: "/village",
    arrivesAt: "/pets",
  },
  {
    id: "bond-return-pup",
    chapter: "bond",
    title: "Home at last",
    speaker: bondkeeperElder,
    description:
      "You brought one of ours home! Look at it wriggle; it knows this garden. Thank you, young one. Let us repay the kindness.",
    action: "Hand over the pup.",
    page: "/pets",
    relatedValue: TUTORIAL_STARTER_QUEST_ID,
    objectiveId: STARTER_QUEST_OBJECTIVES.sanctuary,
    advanceOn: "questDialog",
  },
  {
    id: "bond-adopt",
    chapter: "bond",
    title: "Your first companion",
    speaker: bondkeeperElder,
    description:
      "It refuses to let you out of its sight! Then it belongs with you, and your <b>first bond is free</b>. Give the pup a name, or design a companion of your own below it instead.",
    action: "Name the pup, then tap Adopt the pup.",
    // The page gives its ids to the one control the player needs next.
    elementIds: [
      "tutorial-pet-meet",
      "tutorial-pet-identity",
      "tutorial-pet-continue",
      "tutorial-pet-speciesId",
      "tutorial-pet-paletteIndex",
      "tutorial-pet-characteristicIndex",
      "tutorial-pet-auraIndex",
      "tutorial-sanctuary-pup",
    ],
    elementDescriptions: {
      "tutorial-pet-speciesId":
        "A companion of your own, then! First, its <b>species</b>. It decides how far your companion can grow: some have a fixed potential, others reveal theirs once you are bonded.",
      "tutorial-pet-paletteIndex":
        "Now its <b>colours</b>. From here on you only decide how it looks, so pick what you like.",
      "tutorial-pet-characteristicIndex":
        "Every companion has something you know it by. What is yours known for?",
      "tutorial-pet-auraIndex":
        "Last of its looks, its <b>aura</b>: the light that follows it.",
      "tutorial-pet-continue": "A fine choice.",
      "tutorial-pet-identity":
        "I can picture it already. What will you call it, and is it male or female? Its portrait will show it.",
      "tutorial-pet-meet":
        "Then it is ready to meet you. The bond is free, and its portrait is painted while you go on.",
    },
    elementActions: {
      "tutorial-pet-speciesId": "Choose a species.",
      "tutorial-pet-paletteIndex": "Choose a colour palette.",
      "tutorial-pet-characteristicIndex": "Choose its defining characteristic.",
      "tutorial-pet-auraIndex": "Choose an aura.",
      "tutorial-pet-continue": "Tap Continue.",
      "tutorial-pet-identity": "Name your companion and choose its gender.",
      "tutorial-pet-meet": "Tap Meet my first companion.",
    },
    marks: [{ selector: "[data-pup-name]", label: "" }],
    page: "/pets",
    advanceOn: "petAdopt",
  },
  // Chapter 6: Graduation
  {
    id: "genin-debrief",
    chapter: "genin",
    title: "Graduation",
    description:
      "Better than most graduates, and on your first day out. That metal... tell no one. I'll take it to the archives myself. You've earned this.",
    action: "Answer me to complete the Academy Trials.",
    page: TUTORIAL_ANY_PAGE,
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
    wayLead:
      "Level 5! Your <b>Road to Genin</b> has begun, and the exam is held right here on Wake Island. Your map marks the hall.",
    description: (
      <>
        The exam is held in the Administration Building, at the{" "}
        <MapPin className="inline-block h-4 w-4 text-red-500" /> marker. It opens with a
        fight the moment you arrive. Ready?
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
      "Beat the proctor's clone to pass. No pointers from me now: use every action your bar offers, and take all the time you need. I know you can do this.",
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
      "The clone took this round; every Genin has lost one. Spend all your Action Points each turn and use your strongest move when it's ready. Running low? Have some ramen first.",
    action: "Tap the proctor's clone when you are ready.",
    ...mapSceneTarget,
    scenePage: "/travel",
    mapScene: {
      cast: ["proctor", "clone"],
      offers: "fight",
      says: "Catch your breath. My clone is waiting whenever you are.",
    },
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
    action: "Answer the proctor.",
    ...sceneAnswers,
    scenePage: "/travel",
    mapScene: {
      cast: ["proctor"],
      offers: "answer",
      says: { from: "objective" },
    },
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
      "Your village will be your home from here on. Read about each one before you choose.",
    action: "Talk to the proctor to choose your village.",
    ...sceneAnswers,
    scenePage: "/travel",
    mapScene: {
      cast: ["proctor"],
      offers: "answer",
      says: "Take your time. Which village will you call home?",
    },
    page: "/travel",
    relatedValue: TUTORIAL_GENIN_EXAM_QUEST_ID,
    objectiveId: GENIN_QUEST_OBJECTIVES.choose,
    advanceOn: "questDialog",
  },
  {
    id: "exam-joined",
    chapter: "exam",
    title: "A new home",
    description: "Answer <b>Travel home</b>, and I'll show you the way.",
    action: "Answer the proctor.",
    ...sceneAnswers,
    scenePage: "/travel",
    mapScene: {
      cast: ["proctor"],
      offers: "answer",
      says: { from: "objective" },
    },
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
        walk to the marker.
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
    description: "You made it, Genin. Claim your reward: the rank, and your headband.",
    action: "Claim your reward.",
    ...sceneAnswers,
    scenePage: "/travel",
    mapScene: {
      cast: ["lemu"],
      offers: "claim",
      says: { from: "lesson" },
    },
    page: TUTORIAL_ANY_PAGE,
    relatedValue: TUTORIAL_GENIN_EXAM_QUEST_ID,
    objectiveId: GENIN_QUEST_OBJECTIVES.win,
    advanceOn: "questReward",
  },
  {
    id: "exam-rank-up",
    chapter: "exam",
    title: "Genin",
    description: "Congratulations, Genin!",
    page: TUTORIAL_ANY_PAGE,
    screen: "rankUp",
  },
  {
    id: "exam-tomorrow",
    chapter: "exam",
    title: "Tomorrow",
    description: "Here's what tomorrow brings.",
    page: TUTORIAL_ANY_PAGE,
    screen: "tomorrow",
  },
  {
    id: "exam-dashboard",
    chapter: "exam",
    title: "Your Dashboard",
    wayLead:
      "One last stop: the <b>Dashboard</b> on your profile, which gathers everything waiting for you each day.",
    description:
      "This Dashboard is home base: <b>Right now</b> lists everything waiting for you today. Start with the first day of your daily streak.",
    action: "Claim day 1 of your streak.",
    elementIds: [
      "tutorial-dashboard-streak",
      "tutorial-dashboard-now",
      "tutorial-Dashboard",
    ],
    elementActions: { "tutorial-Dashboard": "Open the Dashboard tab." },
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
