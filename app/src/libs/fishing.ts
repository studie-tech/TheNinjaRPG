import { FISHING_MAX_LEVEL } from "@/drizzle/constants";
import { calcLevelRequirements } from "@/libs/profile";

export type FishBehavior = "DARTING" | "HEAVY" | "CAUTIOUS" | "ERRATIC";
export type FishingSpecies = {
  id: string;
  itemId: string;
  name: string;
  habitat: string;
  rarity: "Common" | "Uncommon" | "Rare";
  behavior: FishBehavior;
  minLevel: number;
  experience: number;
};
export type FishingAction = "LURE" | "HOOK" | "REEL" | "SLACK" | "STEER";
export type FishingEncounterState =
  | "ATTRACT"
  | "HOOK"
  | "FIGHT"
  | "LANDED"
  | "FAILED"
  | "RESOLVED";

export type FishingEquipmentKind = "ROD" | "BAIT" | "TACKLE";
export type FishingEquipment = {
  itemId: string;
  name: string;
  kind: FishingEquipmentKind;
  /** Added to a bite's attraction chance. */
  attractionBonus: number;
  /** Reduces line tension after every successful fight action. */
  controlBonus: number;
  /** Added to the catch XP multiplier. */
  experienceBonus: number;
  /** Reserved for the future starter quest rather than normal shops. */
  starter?: boolean;
};

/** Fishing modifiers are code-defined so ordinary Item effects remain combat-only. */
export const FISHING_EQUIPMENT: readonly FishingEquipment[] = [
  {
    itemId: "fishing-bamboo-rod",
    name: "Bamboo Rod",
    kind: "ROD",
    attractionBonus: 0,
    controlBonus: 0,
    experienceBonus: 0,
    starter: true,
  },
  {
    itemId: "fishing-willow-rod",
    name: "Willow Rod",
    kind: "ROD",
    attractionBonus: 4,
    controlBonus: 3,
    experienceBonus: 0,
  },
  {
    itemId: "fishing-river-rod",
    name: "River Rod",
    kind: "ROD",
    attractionBonus: 6,
    controlBonus: 4,
    experienceBonus: 5,
  },
  {
    itemId: "fishing-starter-grub",
    name: "Starter Grub",
    kind: "BAIT",
    attractionBonus: 0,
    controlBonus: 0,
    experienceBonus: 0,
    starter: true,
  },
  {
    itemId: "fishing-cricket-bait",
    name: "Cricket Bait",
    kind: "BAIT",
    attractionBonus: 8,
    controlBonus: 0,
    experienceBonus: 0,
  },
  {
    itemId: "fishing-glow-bait",
    name: "Glow Bait",
    kind: "BAIT",
    attractionBonus: 4,
    controlBonus: 1,
    experienceBonus: 4,
  },
  {
    itemId: "fishing-cork-bobber",
    name: "Cork Bobber",
    kind: "TACKLE",
    attractionBonus: 3,
    controlBonus: 0,
    experienceBonus: 0,
  },
  {
    itemId: "fishing-silk-line",
    name: "Silk Line",
    kind: "TACKLE",
    attractionBonus: 0,
    controlBonus: 5,
    experienceBonus: 2,
  },
] as const;

export const getFishingEquipment = (itemId: string) =>
  FISHING_EQUIPMENT.find((equipment) => equipment.itemId === itemId);

export const isFishingStarterEquipment = (itemId: string) =>
  !!getFishingEquipment(itemId)?.starter;

/** Fishing gear must be carried and available, not stored, auctioned, or crafting. */
export const isFishingEquipmentAvailable = (item: {
  quantity: number;
  storedAtHome: boolean;
  isInAuction: boolean;
  craftingFinishedAt: Date | null;
}) =>
  item.quantity > 0 &&
  !item.storedAtHome &&
  !item.isInAuction &&
  (!item.craftingFinishedAt || item.craftingFinishedAt <= new Date());

/** Initial content is static so every deployment has safe beginner water. */
export const FISHING_SPECIES: readonly FishingSpecies[] = [
  {
    id: "river-carp",
    itemId: "fishing-river-carp",
    name: "River Carp",
    habitat: "River",
    rarity: "Common",
    behavior: "CAUTIOUS",
    minLevel: 1,
    experience: 20,
  },
  {
    id: "pond-bluegill",
    itemId: "fishing-pond-bluegill",
    name: "Pond Bluegill",
    habitat: "Pond",
    rarity: "Common",
    behavior: "ERRATIC",
    minLevel: 1,
    experience: 24,
  },
  {
    id: "marsh-catfish",
    itemId: "fishing-marsh-catfish",
    name: "Marsh Catfish",
    habitat: "Marsh",
    rarity: "Common",
    behavior: "HEAVY",
    minLevel: 3,
    experience: 32,
  },
  {
    id: "river-trout",
    itemId: "fishing-river-trout",
    name: "River Trout",
    habitat: "River",
    rarity: "Uncommon",
    behavior: "DARTING",
    minLevel: 6,
    experience: 45,
  },
  {
    id: "lake-perch",
    itemId: "fishing-lake-perch",
    name: "Lake Perch",
    habitat: "Lake",
    rarity: "Uncommon",
    behavior: "ERRATIC",
    minLevel: 9,
    experience: 54,
  },
  {
    id: "tidal-mullet",
    itemId: "fishing-tidal-mullet",
    name: "Tidal Mullet",
    habitat: "Coast",
    rarity: "Common",
    behavior: "DARTING",
    minLevel: 12,
    experience: 62,
  },
  {
    id: "silver-koi",
    itemId: "fishing-silver-koi",
    name: "Silver Koi",
    habitat: "Pond",
    rarity: "Rare",
    behavior: "CAUTIOUS",
    minLevel: 16,
    experience: 85,
  },
  {
    id: "marsh-pike",
    itemId: "fishing-marsh-pike",
    name: "Marsh Pike",
    habitat: "Marsh",
    rarity: "Uncommon",
    behavior: "HEAVY",
    minLevel: 22,
    experience: 110,
  },
  {
    id: "moon-eel",
    itemId: "fishing-moon-eel",
    name: "Moon Eel",
    habitat: "Lake",
    rarity: "Rare",
    behavior: "ERRATIC",
    minLevel: 30,
    experience: 140,
  },
  {
    id: "reef-runner",
    itemId: "fishing-reef-runner",
    name: "Reef Runner",
    habitat: "Coast",
    rarity: "Uncommon",
    behavior: "DARTING",
    minLevel: 40,
    experience: 175,
  },
  {
    id: "storm-ray",
    itemId: "fishing-storm-ray",
    name: "Storm Ray",
    habitat: "Coast",
    rarity: "Rare",
    behavior: "HEAVY",
    minLevel: 55,
    experience: 240,
  },
  {
    id: "glassfin",
    itemId: "fishing-glassfin",
    name: "Glassfin",
    habitat: "River",
    rarity: "Rare",
    behavior: "CAUTIOUS",
    minLevel: 70,
    experience: 320,
  },
] as const;

const thresholds = Array.from({ length: FISHING_MAX_LEVEL - 1 }, (_, i) =>
  calcLevelRequirements(i + 1),
);
export const getFishingLevel = (experience: number) => {
  const next = thresholds.findIndex((required) => Math.max(0, experience) < required);
  return next === -1 ? FISHING_MAX_LEVEL : next + 1;
};

export const getFishingLevelProgress = (experience: number) => {
  const level = getFishingLevel(experience);
  return {
    level,
    expForCurrentLevel: level === 1 ? 0 : calcLevelRequirements(level - 1),
    expForNextLevel: level === FISHING_MAX_LEVEL ? null : calcLevelRequirements(level),
  };
};

export const getFishingSpecies = (id: string) =>
  FISHING_SPECIES.find((species) => species.id === id);

export const FISHING_ACTIVITY_STALE_MS = 60_000;
export const FISHING_MARK_COOLDOWN_MS = 30_000;

/** A cast snapshots this value so later arrivals cannot change its rewards. */
export const getFishingTogetherBonus = (participantCount: number) =>
  Math.min(15, Math.max(0, (Math.max(1, participantCount) - 1) * 3));

export const isRecentFishingInteraction = (interactedAt: Date, now: Date) =>
  now.getTime() - interactedAt.getTime() >= 0 &&
  now.getTime() - interactedAt.getTime() <= FISHING_ACTIVITY_STALE_MS;

export const canMarkFishingSchool = (lastMarkedAt: Date | undefined, now: Date) =>
  !lastMarkedAt || now.getTime() - lastMarkedAt.getTime() >= FISHING_MARK_COOLDOWN_MS;

type WaterTile = { x: number; y: number };

/** Deterministic server seed: school locations change in 30-second windows, never on land. */
export const getMovingSchoolPosition = (
  tiles: readonly WaterTile[],
  habitatId: string,
  now: Date,
) => {
  if (tiles.length === 0) return null;
  const window = Math.floor(now.getTime() / 30_000);
  return tiles[Math.abs(hashFishing(`${habitatId}:${window}`)) % tiles.length] ?? null;
};

const hashFishing = (text: string) =>
  [...text].reduce((value, char) => ((value << 5) - value + char.charCodeAt(0)) | 0, 0);

/** Pure map rule used by habitat authoring and cast-time revalidation. */
export const isValidFishingHabitatTiles = (input: {
  centerIsWater: boolean;
  hasReachableBank: boolean;
  connectedWater: boolean;
}) => input.centerIsWater && input.hasReachableBank && input.connectedWater;

/** Distance for the world's odd-q, flat-top sector coordinates. */
export const fishingHexDistance = (
  from: { x: number; y: number },
  to: { x: number; y: number },
) => {
  const cube = (point: { x: number; y: number }) => {
    const q = point.x;
    const r = point.y - (point.x - (point.x & 1)) / 2;
    return { x: q, z: r, y: -q - r };
  };
  const a = cube(from);
  const b = cube(to);
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.z - b.z));
};

/** Selection stays neutral; tracking is a visual school-finding aid. */
export const selectFishingSpecies = (
  eligible: readonly FishingSpecies[],
  seed: string,
) => {
  return eligible[Math.abs(hashFishing(seed)) % eligible.length];
};

/** A line belongs to a specific bank, not merely to its sector. */
export const hasFishingCastPositionChanged = (
  session: {
    sector: number;
    castLongitude: number;
    castLatitude: number;
  },
  player: { sector: number; longitude: number; latitude: number },
) =>
  session.sector !== player.sector ||
  session.castLongitude !== player.longitude ||
  session.castLatitude !== player.latitude;

const behaviorCues: Record<
  FishBehavior,
  Record<"ATTRACT" | "HOOK" | "FIGHT", string>
> = {
  DARTING: {
    ATTRACT: "The fish darts across the current. Lure it into a committed bite.",
    HOOK: "The line snaps tight after a fast strike. Set the hook.",
    FIGHT: "It makes quick runs. Steer to control it, then reel when it slows.",
  },
  HEAVY: {
    ATTRACT:
      "A deep shadow circles the bait. Lure it closer with a steady presentation.",
    HOOK: "A heavy pull loads the rod. Set the hook with confidence.",
    FIGHT:
      "It is holding deep. Reel for strong progress; slack only when the rod loads up.",
  },
  CAUTIOUS: {
    ATTRACT: "Small nudges test the bait. Lure patiently until the fish commits.",
    HOOK: "The nibble becomes a take. Set the hook now.",
    FIGHT: "It spooks easily. Steer smoothly and use slack to settle the line.",
  },
  ERRATIC: {
    ATTRACT: "The bait is struck from changing angles. Keep luring until it commits.",
    HOOK: "A sudden strike jerks the line. Set the hook immediately.",
    FIGHT:
      "Its direction changes without warning. Alternate controlled steering and slack.",
  },
};

export const getFishingCue = (
  behavior: FishBehavior | undefined,
  state: FishingEncounterState,
) => {
  if (state === "LANDED")
    return "The fish is landed. Choose whether to keep or release it.";
  if (state === "FAILED") return "The fish escaped.";
  if (state === "RESOLVED") return "This catch has been resolved.";
  return behavior
    ? behaviorCues[behavior][state]
    : "Read the line and respond to the fish.";
};

export const getFishingAttractionChance = (
  behavior: FishBehavior,
  socialBonusPercent: number,
  equipmentBonus = 0,
) => {
  const base = { DARTING: 65, HEAVY: 60, CAUTIOUS: 55, ERRATIC: 50 }[behavior];
  return Math.min(
    90,
    base + Math.max(0, socialBonusPercent) + Math.max(0, equipmentBonus),
  );
};

/** Resolves one server-authoritative input without requiring animation or hidden client state. */
export const resolveFishingAction = ({
  behavior,
  state,
  tension,
  landingProgress,
  action,
  socialBonusPercent,
  attractionBonus = 0,
  controlBonus = 0,
  attractionRoll,
}: {
  behavior: FishBehavior;
  state: FishingEncounterState;
  tension: number;
  landingProgress: number;
  action: FishingAction;
  socialBonusPercent: number;
  attractionBonus?: number;
  controlBonus?: number;
  attractionRoll: number;
}) => {
  if (state === "ATTRACT") {
    if (action !== "LURE") return null;
    if (
      attractionRoll >=
      getFishingAttractionChance(behavior, socialBonusPercent, attractionBonus)
    )
      return { state, tension, landingProgress };
    return { state: "HOOK" as const, tension, landingProgress };
  }
  if (state === "HOOK")
    return action === "HOOK"
      ? { state: "FIGHT" as const, tension: 35, landingProgress: 10 }
      : null;
  if (state !== "FIGHT") return null;
  const outcomes = {
    DARTING: { REEL: [18, 27], SLACK: [-22, 4], STEER: [6, 22] },
    HEAVY: { REEL: [10, 34], SLACK: [-18, 6], STEER: [5, 12] },
    CAUTIOUS: { REEL: [14, 24], SLACK: [-28, 3], STEER: [4, 20] },
    ERRATIC: { REEL: [20, 28], SLACK: [-24, 5], STEER: [8, 10] },
  } as const;
  const outcome = outcomes[behavior][action as "REEL" | "SLACK" | "STEER"];
  if (!outcome) return null;
  const nextTension = Math.max(0, tension + outcome[0] - controlBonus);
  if (nextTension >= 100)
    return { state: "FAILED" as const, tension: nextTension, landingProgress };
  const nextProgress = Math.min(100, landingProgress + outcome[1]);
  return {
    state: nextProgress >= 100 ? ("LANDED" as const) : ("FIGHT" as const),
    tension: nextTension,
    landingProgress: nextProgress,
  };
};
