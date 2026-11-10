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
  /** Label of a button that travels and walks to the related quest's current objective. */
  autoTravelLabel?: string;
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
}

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
const globalTravelElements = [
  "tutorial-global-travel-proceed",
  "tutorial-global-map",
  "tutorial-Global",
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
      "Welcome to Horizon, the academy town where every shinobi begins. I'm <b>Lemu</b>, your instructor. This is your profile, where everything you achieve is recorded. Before you can earn your Genin headband you must pass the <b>Academy Trials</b>, and I'll guide you through every one of them.",
    page: "/profile",
    showNextButton: true,
    nextLabel: "Let's begin",
  },
  {
    id: "student-open-village",
    chapter: "student",
    title: "Into the village",
    description:
      "The <b>location menu</b> always shows where you are standing. Tap it any time to see what the place has to offer.",
    action: "Tap Horizon Village in the location menu.",
    elementIds: ["tutorial-village"],
    page: "/profile",
    proceedOnHighlightClick: true,
    requiresGameMenu: true,
  },
  {
    id: "student-academy-building",
    chapter: "student",
    title: "The Academy",
    description:
      "Every building in the village offers something different. The academy is where I teach, and where the trials begin.",
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
    action: "Accept the trials by answering me below.",
    elementIds: [starterLogbookEntry],
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
      "Fights play out on a grid of hexagonal tiles. Find yourself and the dummy. You act by choosing an action below the field and then tapping a tile on it.",
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
      "You and your opponent take turns. Each turn gives you <b>60 seconds</b> and <b>100 Action Points (AP)</b>. Moving costs 10 AP, a basic attack 20, and this bar shows what you have left.",
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
    action: "Claim your reward.",
    elementIds: [starterLogbookEntry],
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
      "Experience from quests is not spent for you: you decide which stats it strengthens. New experience always shows up here.",
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
      "Training spends <b>Energy</b> to raise a stat instantly. Energy refills over time, even while you are offline, and the Energy queue can spend it for you.",
    action: "Tap Offence to train it.",
    elementIds: ["tutorial-traininggrounds-offence"],
    page: "/traininggrounds",
    advanceOn: "trainStats",
    showNextButton: true,
  },
  {
    id: "tools-train-jutsu",
    chapter: "tools",
    title: "Your first jutsu",
    description:
      "Jutsu are your signature techniques. <b>Sonic Slash</b> is a piercing blade strike that hits from a few tiles away. The first level takes about a minute and costs a little ryo, and a new jutsu is equipped automatically.",
    action: "Tap Sonic Slash, then Train.",
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
    action: "Tap Claim below to collect your reward.",
    page: "/traininggrounds",
    relatedValue: TUTORIAL_STARTER_QUEST_ID,
    objectiveId: STARTER_QUEST_OBJECTIVES.jutsu,
    objectiveStepId: TUTORIAL_JUTSU_PICK_STEP_ID,
    advanceOn: "questReward",
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
  {
    id: "tools-ramen-building",
    chapter: "tools",
    title: "Ramen Shop",
    description:
      "Basic attacks cost <b>Stamina</b> and jutsu cost <b>Chakra</b>. Both refill slowly on their own, or instantly with a bowl of ramen.",
    action: "Tap Ramen Shop.",
    elementIds: ["tutorial-ramenshop"],
    page: "/village",
    proceedOnHighlightClick: true,
  },
  {
    id: "tools-buy-ramen",
    chapter: "tools",
    title: "Refuel",
    description:
      "A small bowl costs only a few ryo. Top up before you head out. Health comes back by resting, or at the hospital.",
    action: "Order a bowl of ramen.",
    elementIds: ["tutorial-ramen-menu"],
    page: "/ramenshop",
    advanceOn: "buyRamen",
    showNextButton: true,
  },
  {
    id: "tools-mission-hall",
    chapter: "tools",
    title: "Mission Hall",
    description:
      "The <b>Mission Hall</b> is where you will earn ryo and experience every day: errands for the village now, and real missions as you climb the ranks.",
    elementIds: ["tutorial-missionhall"],
    page: "/village",
    showNextButton: true,
  },
  {
    id: "tools-home",
    chapter: "tools",
    title: "Home",
    description:
      "At <b>Home</b> you can sleep to regenerate faster, safe from attacks, and cook meals in your kitchen. Actions that need you awake wake you automatically by default; you can change this in your profile settings.",
    elementIds: ["tutorial-home"],
    page: "/village",
    showNextButton: true,
  },
  {
    id: "tools-assign",
    chapter: "tools",
    title: "Grow stronger",
    description:
      "Your jutsu trial earned you 1,000 experience. Spend it the same way as before.",
    action: "Tap a style, then confirm.",
    elementIds: assignElements,
    page: "/profile/experience",
    advanceOn: "assignStats",
    needsUnassignedExperience: true,
  },
  {
    id: "tools-level-up",
    chapter: "tools",
    title: "Level 3",
    description: "Another level, earned the hard way.",
    action: "Tap Level up!, then Awesome!",
    elementIds: levelUpElements,
    page: "/profile/experience",
    advanceOn: "levelUp",
  },
  // Chapter 4: The Missing Pup
  {
    id: "mission-brief",
    chapter: "mission",
    title: "A real mission",
    description:
      "Last night a violet flash lit up the eastern ridge, and a pup from the <b>Bondkeeper Sanctuary</b> bolted in fright. It is out there alone and scared. Your final trial: bring it back safely.",
    action: "Accept the mission below.",
    elementIds: [starterLogbookEntry],
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
      "Missions take you out into the world of Seichi. The travel map shows both the sector you stand in and the whole globe.",
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
      "This globe is the world of Seichi, and the \u{1F4DC} marks your objective. Journeys between sectors take a little time. Don't worry, I'm coming with you.",
    action: "Open Global, tap the \u{1F4DC} marker, then confirm the trip.",
    elementIds: globalTravelElements,
    page: "/travel",
    relatedValue: TUTORIAL_CAPTURE_SECTOR,
    objectiveId: STARTER_QUEST_OBJECTIVES.pup,
    advanceOn: "travelArrive",
  },
  {
    id: "mission-find-pup",
    chapter: "mission",
    title: "Find the pup",
    description: (
      <>
        The pup is hiding at the{" "}
        <MapPin className="inline-block h-4 w-4 text-red-500" /> marker. It is
        frightened and may lash out, so be ready to use Sonic Slash and your shuriken.
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
      "The pup calms the moment the fight is over. Caught in its collar is a sliver of <b>dark metal</b>, threaded with faint violet veins. Strange... Let's get it home first.",
    action: "Tap Claim below to collect your reward.",
    page: "/travel",
    relatedValue: TUTORIAL_STARTER_QUEST_ID,
    objectiveId: STARTER_QUEST_OBJECTIVES.pup,
    advanceOn: "questReward",
  },
  {
    id: "mission-assign",
    chapter: "mission",
    title: "Grow stronger",
    description: "Your first field mission earned you 1,500 experience.",
    action: "Tap a style, then confirm.",
    elementIds: assignElements,
    page: "/profile/experience",
    advanceOn: "assignStats",
    needsUnassignedExperience: true,
  },
  {
    id: "mission-level-up",
    chapter: "mission",
    title: "Level 4",
    description: "Level 4. One more and you are ready for the Genin exam.",
    action: "Tap Level up!, then Awesome!",
    elementIds: levelUpElements,
    page: "/profile/experience",
    advanceOn: "levelUp",
  },
  // Chapter 5: Bondkeepers
  {
    id: "bond-travel-wake",
    chapter: "bond",
    title: "Bring it home",
    description:
      "The pup wears a Bondkeeper tag: it belongs to the sanctuary on <b>Wake Island</b>, a short trip from here. Wake Island is neutral ground, and it is where you will take your Genin exam.",
    action: "Open Global, tap Wake Island, then confirm the trip.",
    elementIds: globalTravelElements,
    page: "/travel",
    relatedValue: TUTORIAL_WAKE_SECTOR,
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
    action: "Hand over the pup below.",
    page: "/pets",
    relatedValue: TUTORIAL_STARTER_QUEST_ID,
    objectiveId: STARTER_QUEST_OBJECTIVES.sanctuary,
    advanceOn: "questDialog",
  },
  {
    id: "bond-adopt",
    chapter: "bond",
    title: "A companion of your own",
    description:
      "To thank you, the Bondkeepers offer you a companion of your own, and your <b>first bond is free</b>. Choose a species, its colours, a defining trait and an aura, then give it a name.",
    action: "Finish the steps, then tap Meet my first companion.",
    elementIds: ["tutorial-pet-acquisition"],
    page: "/pets",
    advanceOn: "petAdopt",
    showNextButton: true,
  },
  {
    id: "bond-pet-profile",
    chapter: "bond",
    title: "Your companion",
    description:
      "Companions grow alongside you: they share the experience you earn and fight at your side in quests and dungeons. Feed them meals from your home kitchen to help them grow, and manage everything from this tab.",
    elementIds: ["tutorial-pet-profile"],
    page: "/profile?tab=pet",
    showNextButton: true,
  },
  // Chapter 6: Road to Genin
  {
    id: "genin-debrief",
    chapter: "genin",
    title: "Graduation",
    description:
      "You did well out there, better than most graduates. That metal in the pup's collar... show it to no one; I'll take it to the academy archives myself. Now, you have earned your graduation.",
    action: "Answer me below to complete the Academy Trials.",
    page: "/profile?tab=pet",
    relatedValue: TUTORIAL_STARTER_QUEST_ID,
    objectiveId: STARTER_QUEST_OBJECTIVES.debrief,
    advanceOn: "questDialog",
  },
  {
    id: "genin-assign",
    chapter: "genin",
    title: "Graduation rewards",
    description:
      "The Academy Trials paid out ryo, a badge and 2,000 experience. Assign it to reach level 5, the level the Genin exam requires.",
    action: "Tap a style, then confirm.",
    elementIds: assignElements,
    page: "/profile/experience",
    advanceOn: "assignStats",
    needsUnassignedExperience: true,
  },
  {
    id: "genin-level-up",
    chapter: "genin",
    title: "Level 5",
    description: "Level 5. You are ready.",
    action: "Tap Level up!, then Awesome!",
    elementIds: levelUpElements,
    page: "/profile/experience",
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
        <MapPin className="inline-block h-4 w-4 text-red-500" /> marker. Any quest
        location works the same way: open it from your quest and you will walk there on
        your own.
      </>
    ),
    action: "Tap Walk to the exam, then Travel.",
    page: "/travel",
    relatedValue: TUTORIAL_GENIN_EXAM_QUEST_ID,
    objectiveId: GENIN_QUEST_OBJECTIVES.exam,
    autoTravelLabel: "Walk to the exam",
  },
  {
    id: "exam-tour",
    chapter: "exam",
    title: "Wake Island",
    description:
      "The proctor is waiting. Wake Island belongs to no village, so every shinobi meets here.",
    action: "Answer the proctor below.",
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
    action: "Pick the village you want to join.",
    page: "/travel",
    relatedValue: TUTORIAL_GENIN_EXAM_QUEST_ID,
    objectiveId: GENIN_QUEST_OBJECTIVES.choose,
    advanceOn: "questDialog",
    quoteObjective: true,
  },
  {
    id: "exam-joined",
    chapter: "exam",
    title: "A new home",
    description: "Your new village is expecting you.",
    action: "Answer the proctor below.",
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
        Every new Genin reports to their village's mission hall, at the{" "}
        <MapPin className="inline-block h-4 w-4 text-red-500" /> marker. The journey
        takes only a few seconds.
      </>
    ),
    action: "Tap Travel home, then Travel.",
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
    action: "Tap the claim button below.",
    page: "/travel",
    relatedValue: TUTORIAL_GENIN_EXAM_QUEST_ID,
    objectiveId: GENIN_QUEST_OBJECTIVES.win,
    advanceOn: "questReward",
  },
  {
    id: "exam-farewell",
    chapter: "exam",
    title: "Genin",
    description:
      "Congratulations, Genin! This is your village. Its mission hall hands out daily missions, the tavern is where your villagers talk, and the <b>Guide</b> explains every system. Remember to assign the experience you earned on your profile. From here on I'll show your active quest in this panel, and once fighting feels natural you can switch auto combat on in the arena. Good luck, shinobi!",
    page: "/village",
    showNextButton: true,
    nextLabel: "Finish",
  },
];
