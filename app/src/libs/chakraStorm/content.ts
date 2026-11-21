/**
 * Chakra Storm content and balance: the hero, the jutsu it casts on its own, the passive
 * arts it trains, the regions of Seichi it scouts, the raiders and the Training Hall.
 * Everything here is plain numbers the deterministic simulation reads, so it follows the
 * simulation's arithmetic rules (no `**`, `Math.pow`, trigonometry or clocks).
 */
import { CHAKRA_STORM_STAGE_NAMES, CHAKRA_STORM_STAGES } from "@/drizzle/constants";
import type { TdElement } from "@/libs/towerDefense/content";

/** Simulation ticks per second. */
export const CS_TPS = 20;
export const CS_TICK_SECONDS = 1 / CS_TPS;
/** Holding out this long completes the scouting report and wins the run. */
export const CS_RUN_SECONDS = 15 * 60;
/** Half the side of the square battlefield, in units; the hero stays inside it. */
export const CS_ARENA_HALF = 18;
/** Raiders appear this far from the hero, just beyond the camera's view. */
export const CS_SPAWN_DISTANCE = 13;
/** Most raiders alive at once; spawns wait while the field is this crowded. */
export const CS_MAX_ENEMIES = 300;
/** Most experience orbs on the ground; a new one beyond it joins the oldest. */
export const CS_MAX_ORBS = 220;
/** Jutsu and passive arts the hero can hold at once. */
export const CS_SLOTS = 5;

export const CS_HERO = {
  hp: 100,
  /** Units per second. */
  speed: 4.2,
  radius: 0.4,
  /** Distance at which orbs start flying to the hero. */
  pickup: 2.4,
  /** Chance a hit lands as a critical double. */
  crit: 0.05,
} as const;

/**
 * Experience needed to go from `level` to the next one, on the curve survivors-likes
 * share: quick early levels so the first minute already offers choices, a steady climb,
 * and a gentler slope past level 20 once the orbs themselves are worth more.
 */
export const csExperienceFor = (level: number) =>
  level < 20 ? 5 + 8 * (level - 1) : 157 + 20 * (level - 20);

export const CS_JUTSU = [
  "shuriken",
  "ember",
  "gale",
  "thunder",
  "tidal",
  "stonefang",
  "frost",
  "wisps",
] as const;
export type CsJutsu = (typeof CS_JUTSU)[number];

export const CS_PASSIVES = [
  "swiftFeet",
  "ironBody",
  "chakraControl",
  "battleFocus",
  "magnetSeal",
  "expansion",
  "echoSeal",
  "fortune",
] as const;
export type CsPassive = (typeof CS_PASSIVES)[number];

/** One jutsu level: what it casts at that level. */
export interface CsJutsuStats {
  /** Seconds between casts. */
  cooldown: number;
  damage: number;
  /** Projectiles, sickles, fields, blooms or wisps per cast; jumps for Forked Thunder. */
  count: number;
  /** Blast, orbit, ring, field or bloom radius. */
  radius: number;
  /**
   * Raiders a shuriken or wisp passes through; push for the Tidal Ring; seconds a
   * raider stays frozen or stunned for Frost Lotus and Forked Thunder.
   */
  extra: number;
}

export interface CsJutsuInfo {
  name: string;
  /** The damage-number tone its hits show in. */
  element: TdElement;
  /** Its colour on cards and in the HUD, readable on light and dark surfaces. */
  color: string;
  /** Its glow on the battlefield. */
  glow: number;
  /** The element as Seichi's shinobi name it, which may differ from the effect colour. */
  elementName: string;
  summary: string;
  /** Stats per level, from level 1; the last entry is the mastery. */
  levels: CsJutsuStats[];
  /** How its draft cards name what a level adds. */
  terms: CsJutsuTerms;
  /** The awakened form: a mastered jutsu plus its partner art, opened by a scroll. */
  awakening: { name: string; partner: CsPassive; summary: string; stats: CsJutsuStats };
}

const stats = (
  cooldown: number,
  damage: number,
  count: number,
  radius: number,
  extra = 0,
): CsJutsuStats => ({ cooldown, damage, count, radius, extra });

/**
 * How a jutsu's draft cards name an upgrade: what it casts more of, and the words for
 * faster casts, a wider reach and its extra stat (pierce, stun, push, freeze or passes).
 */
export interface CsJutsuTerms {
  unit?: [one: string, many: string];
  faster?: string;
  wider?: string;
  extra?: "pierce" | "stun" | "push" | "freeze" | "passes";
}

export const CS_JUTSU_INFO: Record<CsJutsu, CsJutsuInfo> = {
  shuriken: {
    name: "Shuriken Volley",
    element: "physical",
    color: "#64748b",
    glow: 0xffffff,
    elementName: "Bukijutsu",
    summary: "Throws shuriken at the nearest raiders.",
    terms: { unit: ["shuriken", "shuriken"], faster: "faster throws", extra: "pierce" },
    levels: [
      stats(1, 100, 1, 0),
      stats(1, 100, 2, 0),
      stats(0.88, 100, 2, 0),
      stats(0.88, 125, 2, 0),
      stats(0.88, 125, 3, 0),
      stats(0.88, 156, 3, 0),
      stats(0.77, 156, 3, 0),
    ],
    awakening: {
      name: "Thousand Shuriken Squall",
      partner: "swiftFeet",
      summary: "A storm of shuriken, each cutting through four raiders.",
      stats: stats(0.6, 53, 5, 0, 4),
    },
  },
  ember: {
    name: "Ember Comet",
    element: "fire",
    color: "#ea580c",
    glow: 0xff7a1a,
    elementName: "Fire",
    summary: "Hurls a comet of fire that bursts in the crowd.",
    terms: { unit: ["comet", "comets"], faster: "faster casts", wider: "wider burst" },
    levels: [
      stats(2.4, 86, 1, 1.6),
      stats(2.4, 108, 1, 1.6),
      stats(2.4, 108, 1, 1.79),
      stats(2.4, 108, 2, 1.79),
      stats(2.4, 134, 2, 1.79),
      stats(2.4, 134, 2, 2),
      stats(2.11, 134, 2, 2),
    ],
    awakening: {
      name: "Sunfall Comet",
      partner: "battleFocus",
      summary: "Comets the size of a courtyard that scorch the ground where they land.",
      stats: stats(1.8, 72, 3, 2.8),
    },
  },
  gale: {
    name: "Gale Sickles",
    element: "wind",
    color: "#16a34a",
    glow: 0xc8ffd4,
    elementName: "Wind",
    summary: "Sickles of wind circle you and cut what they touch.",
    terms: { unit: ["sickle", "sickles"], wider: "wider orbit" },
    levels: [
      stats(0.5, 16, 2, 2),
      stats(0.5, 16, 3, 2),
      stats(0.5, 21, 3, 2),
      stats(0.5, 21, 3, 2.24),
      stats(0.5, 26, 3, 2.24),
      stats(0.5, 32, 3, 2.24),
      stats(0.5, 32, 4, 2.51),
    ],
    awakening: {
      name: "Akikaze Tempest",
      partner: "expansion",
      summary: "The storm canyon's wind howls around you in a wide, unbroken ring.",
      stats: stats(0.5, 38, 6, 3),
    },
  },
  thunder: {
    name: "Forked Thunder",
    element: "lightning",
    color: "#0284c7",
    glow: 0x9fd8ff,
    elementName: "Lightning",
    summary: "Lightning strikes a raider, stuns it and forks to those nearby.",
    terms: {
      unit: ["fork", "forks"],
      faster: "faster strikes",
      wider: "longer forks",
      extra: "stun",
    },
    levels: [
      stats(1.8, 81, 2, 3, 0.35),
      stats(1.8, 81, 3, 3, 0.35),
      stats(1.8, 101, 3, 3, 0.35),
      stats(1.58, 126, 3, 3, 0.35),
      stats(1.58, 126, 4, 3, 0.45),
      stats(1.58, 158, 4, 3, 0.45),
      stats(1.58, 198, 4, 3, 0.55),
    ],
    awakening: {
      name: "Storm Crown",
      partner: "chakraControl",
      summary: "Three bolts fall at once, each forking through the crowd.",
      stats: stats(1.2, 63, 7, 4, 0.6),
    },
  },
  tidal: {
    name: "Tidal Ring",
    element: "water",
    color: "#2563eb",
    glow: 0x4fc3ff,
    elementName: "Water",
    summary: "A ring of water bursts from you and throws raiders back.",
    terms: { faster: "faster pulses", wider: "wider ring", extra: "push" },
    levels: [
      stats(3, 29, 1, 3.4, 1.4),
      stats(3, 37, 1, 3.4, 1.4),
      stats(3, 37, 1, 3.81, 1.8),
      stats(2.64, 46, 1, 3.81, 1.8),
      stats(2.64, 57, 1, 3.81, 1.8),
      stats(2.64, 57, 1, 4.27, 2.2),
      stats(2.32, 72, 1, 4.27, 2.2),
    ],
    awakening: {
      name: "Maelstrom",
      partner: "ironBody",
      summary:
        "A whirlpool that hurls raiders away and mends you for each one it strikes.",
      stats: stats(2.2, 88, 1, 5.4, 3),
    },
  },
  stonefang: {
    name: "Stonefang Field",
    element: "earth",
    color: "#a16207",
    glow: 0xc8945a,
    elementName: "Earth",
    summary: "Stone fangs rise under raiders, wounding and slowing them.",
    terms: { unit: ["field", "fields"], faster: "faster casts", wider: "wider fields" },
    levels: [
      stats(2.6, 24, 1, 1.4),
      stats(2.6, 30, 1, 1.4),
      stats(2.6, 30, 1, 1.57),
      stats(2.29, 30, 1, 1.57),
      stats(2.29, 38, 1, 1.57),
      stats(2.29, 38, 1, 1.76),
      stats(2.02, 47, 1, 1.76),
    ],
    awakening: {
      name: "Mountain Maw",
      partner: "magnetSeal",
      summary: "The earth opens and drags every raider nearby into its teeth.",
      stats: stats(2, 22, 3, 2.4),
    },
  },
  frost: {
    name: "Frost Lotus",
    element: "water",
    color: "#0891b2",
    glow: 0xb8f4ff,
    elementName: "Ice",
    summary:
      "Hyorin's ice lotus blooms in the crowd and freezes raiders where they stand.",
    terms: {
      unit: ["lotus", "lotuses"],
      faster: "faster blooms",
      wider: "wider bloom",
      extra: "freeze",
    },
    levels: [
      stats(3.2, 128, 1, 1.5, 1),
      stats(3.2, 159, 1, 1.5, 1),
      stats(3.2, 159, 1, 1.5, 1.2),
      stats(3.2, 159, 1, 1.68, 1.2),
      stats(3.2, 159, 2, 1.68, 1.2),
      stats(3.2, 199, 2, 1.68, 1.4),
      stats(2.82, 249, 2, 1.68, 1.4),
    ],
    awakening: {
      name: "Winter Bloom",
      partner: "echoSeal",
      summary: "A field of ice lotuses that leaves half the field frozen still.",
      stats: stats(2.4, 158, 4, 2.3, 2),
    },
  },
  wisps: {
    name: "Spirit Wisps",
    element: "wind",
    color: "#ca8a04",
    glow: 0xfff1a8,
    elementName: "Light",
    summary: "Akasumi's forest spirits seek out raiders and pass through them.",
    terms: { unit: ["wisp", "wisps"], faster: "faster calls", extra: "passes" },
    levels: [
      stats(2, 91, 1, 0, 2),
      stats(2, 91, 2, 0, 2),
      stats(2, 113, 2, 0, 2),
      stats(2, 113, 2, 0, 3),
      stats(1.76, 113, 2, 0, 3),
      stats(1.55, 113, 2, 0, 3),
      stats(1.55, 141, 2, 0, 3),
    ],
    awakening: {
      name: "Spirit Host",
      partner: "fortune",
      summary: "A procession of spirits that circles back for every raider it misses.",
      stats: stats(1.3, 65, 5, 0, 6),
    },
  },
};

/**
 * What a jutsu's level adds over the one before, for its draft card, worked out from
 * the stats so the card always says what the level really does.
 */
export const csUpgradeText = (id: CsJutsu, level: number) => {
  const info = CS_JUTSU_INFO[id];
  const before = info.levels[level - 2];
  const after = info.levels[level - 1];
  if (!before || !after) return "Stronger";
  const { terms } = info;
  const parts: string[] = [];
  const more = after.count - before.count;
  if (more > 0 && terms.unit)
    parts.push(`+${more} ${more === 1 ? terms.unit[0] : terms.unit[1]}`);
  const damage = Math.round((100 * after.damage) / before.damage) - 100;
  if (damage > 0) parts.push(`+${damage}% damage`);
  if (after.cooldown < before.cooldown && terms.faster) parts.push(terms.faster);
  if (after.radius > before.radius && terms.wider) parts.push(terms.wider);
  if (after.extra > before.extra && terms.extra)
    parts.push(extraText(terms.extra, after.extra));
  const text = parts.join(", ") || "Stronger";
  return text.charAt(0).toUpperCase() + text.slice(1);
};

const extraText = (extra: NonNullable<CsJutsuTerms["extra"]>, value: number) => {
  if (extra === "pierce") return value === 1 ? "pierces 1 raider" : `pierces ${value}`;
  if (extra === "passes") return `${value} passes`;
  if (extra === "stun") return "longer stun";
  if (extra === "freeze") return "longer freeze";
  return "stronger push";
};

/** How long a stone field stands, and how often its fangs strike. */
export const CS_FIELD_SECONDS = 2.4;
export const CS_FIELD_INTERVAL = 0.4;
/** Projectile flight. */
export const CS_SHURIKEN_SPEED = 13;
export const CS_SHURIKEN_RANGE = 11;
export const CS_COMET_SPEED = 8;
export const CS_WISP_SPEED = 7;
export const CS_WISP_SECONDS = 4;
/** Raiders a jutsu looks for within this distance of the hero. */
export const CS_TARGET_RANGE = 8;
/** A sickle cuts the same raider at most this often. */
export const CS_SICKLE_REHIT_SECONDS = 0.5;
/** How fast the tidal ring expands, units per second. */
export const CS_TIDAL_SPEED = 9;

export interface CsPassiveInfo {
  name: string;
  summary: string;
  /** What one level adds, for the draft cards. */
  perLevel: string;
  maxLevel: number;
}

export const CS_PASSIVE_INFO: Record<CsPassive, CsPassiveInfo> = {
  swiftFeet: {
    name: "Swift Feet",
    summary: "Move faster.",
    perLevel: "+8% movement speed",
    maxLevel: 5,
  },
  ironBody: {
    name: "Iron Body",
    summary: "More health that slowly mends.",
    perLevel: "+20 health, +0.4 health per second",
    maxLevel: 5,
  },
  chakraControl: {
    name: "Chakra Control",
    summary: "Cast every jutsu more often.",
    perLevel: "-5% jutsu cooldowns",
    maxLevel: 5,
  },
  battleFocus: {
    name: "Battle Focus",
    summary: "Every jutsu hits harder.",
    perLevel: "+8% jutsu damage",
    maxLevel: 5,
  },
  magnetSeal: {
    name: "Magnet Seal",
    summary: "Pull chakra orbs in from further away.",
    perLevel: "+30% pickup range",
    maxLevel: 5,
  },
  expansion: {
    name: "Expansion Seal",
    summary: "Bursts, rings, orbits, fields and blooms grow.",
    perLevel: "+6% jutsu area",
    maxLevel: 5,
  },
  echoSeal: {
    name: "Echo Seal",
    summary: "Each jutsu casts one more of everything.",
    perLevel: "+1 shuriken, comet, sickle, field, lotus, wisp or fork",
    maxLevel: 1,
  },
  fortune: {
    name: "Fortune Charm",
    summary: "Luck favours you: more critical hits and more drops.",
    perLevel: "+3% critical chance, +20% onigiri and talisman drops",
    maxLevel: 5,
  },
};

export const CS_ENEMY_KINDS = [
  "grunt",
  "runner",
  "caster",
  "brute",
  "veteran",
  "juggernaut",
  "boss",
] as const;
export type CsEnemyKind = (typeof CS_ENEMY_KINDS)[number];

export interface CsEnemyInfo {
  hp: number;
  /** Units per second. */
  speed: number;
  /** Damage on contact. */
  damage: number;
  radius: number;
  /** Experience its orb carries. */
  experience: number;
}

export const CS_ENEMIES: Record<CsEnemyKind, CsEnemyInfo> = {
  grunt: { hp: 24, speed: 1.6, damage: 5, radius: 0.38, experience: 1 },
  runner: { hp: 18, speed: 2.8, damage: 4, radius: 0.34, experience: 1 },
  caster: { hp: 42, speed: 1.5, damage: 5, radius: 0.38, experience: 2 },
  brute: { hp: 150, speed: 1.15, damage: 12, radius: 0.6, experience: 5 },
  veteran: { hp: 360, speed: 1.75, damage: 10, radius: 0.45, experience: 6 },
  juggernaut: { hp: 960, speed: 1.05, damage: 18, radius: 0.7, experience: 12 },
  boss: { hp: 0, speed: 1.4, damage: 20, radius: 0.9, experience: 100 },
};

/** Raid captains arrive with this much health per hero level, so they test any build. */
export const CS_BOSS_HP_PER_LEVEL = 240;
/** Elites carry this much extra experience on top of their kind's. */
export const CS_ELITE_EXPERIENCE = 25;

/** Elites have this much more health and size, and always drop a scroll. */
export const CS_ELITE_HEALTH = 6;
export const CS_ELITE_SIZE = 1.35;
/** A raider strikes a hero it touches at most this often. */
export const CS_CONTACT_SECONDS = 0.8;
/** Casters hold this distance and throw an orb this often. */
export const CS_CASTER_RANGE = 6;
export const CS_CASTER_SECONDS = 3.2;
export const CS_ORB_SPEED = 4.5;
/** Bosses arrive at these minutes; they fire a ring of orbs and charge at the hero. */
export const CS_BOSS_MINUTES = [5, 10, 14] as const;
export const CS_BOSS_BURST_SECONDS = 4.5;
export const CS_BOSS_CHARGE_SECONDS = 7;
/** How long a boss winds up before a charge, and how fast and long it charges. */
export const CS_BOSS_WINDUP_SECONDS = 0.8;
export const CS_BOSS_DASH_SPEED = 10;
export const CS_BOSS_DASH_SECONDS = 0.6;
/** Every run starts with this many draft rerolls before Insight adds more. */
export const CS_BASE_REROLLS = 1;
/**
 * Picks a scroll holds, and their odds: elites mostly one, captains often three, and
 * now and then five, as survivors-like treasure chests pay out.
 */
export const CS_SCROLL_ODDS = {
  elite: [
    [1, 0.7],
    [3, 0.25],
    [5, 0.05],
  ],
  boss: [
    [1, 0.4],
    [3, 0.45],
    [5, 0.15],
  ],
} as const satisfies Record<string, readonly (readonly [number, number])[]>;
/** Health a dropped onigiri restores. */
export const CS_ONIGIRI_HEAL = 30;
/** Base chance a fallen raider drops an onigiri or a gust talisman (which pulls in every orb). */
export const CS_ONIGIRI_CHANCE = 0.004;
export const CS_TALISMAN_CHANCE = 0.0015;

/** Health multiplier for raiders spawned `seconds` into the run. */
export const csHealthScale = (seconds: number) => 1 + seconds / 240;

/**
 * Raiders toughen with the clock and with every raider the hero has defeated: each
 * crystal that drops makes the next wave a little hardier, as a survivors-like curse
 * builds through a run.
 */
export const CS_KILLS_PER_TOUGHNESS = 10000;
export const csToughness = (seconds: number, kills: number) =>
  csHealthScale(seconds) * (1 + kills / CS_KILLS_PER_TOUGHNESS);

/** After a hit the hero cannot be struck again for this long, so a crowd cannot burst it. */
export const CS_HERO_GUARD_SECONDS = 0.25;

/**
 * A stage's health or damage multiplier `seconds` into the run. It grows in over the
 * first five minutes, so a harder stage tests the full build rather than ending a run
 * before the first choices are made.
 */
export const csStageFactor = (
  stage: CsStage,
  key: "health" | "damage",
  seconds: number,
) => {
  const info = CS_STAGE_INFO[stage];
  const base = 1 + (info[key] - 1) * Math.min(1, seconds / 300);
  // Undercover keeps hardening for as long as the cover holds.
  return info.endless ? base * (1 + (info.endless[key] * seconds) / 3600) : base;
};

/**
 * The run's pressure by minute: raiders kept alive at the least (the field refills to
 * it at once) and the seconds between the steady trickle's spawns. It dips when a raid
 * captain arrives at 5 and 10, as survivors-likes give a breather for each boss.
 */
const CS_SPAWN_SCHEDULE: readonly [minimum: number, interval: number][] = [
  [12, 1],
  [25, 0.9],
  [40, 0.8],
  [35, 0.7],
  [55, 0.6],
  [30, 0.6],
  [70, 0.55],
  [85, 0.5],
  [90, 0.45],
  [105, 0.4],
  [50, 0.4],
  [120, 0.35],
  [135, 0.3],
  [150, 0.28],
  [165, 0.25],
];

/**
 * The minimum alive and trickle interval `seconds` into the run. After an opening like
 * Horizon's, Undercover drops the refill: raiders arrive at a steadily rising rate, so a
 * build that kills as fast as they come keeps the field thin and one that falls behind
 * is buried. Killing power, not a clock, decides how long the cover holds.
 */
export const csSpawnPressure = (seconds: number, stage: CsStage) => {
  const minute = seconds / 60;
  if (CS_STAGE_INFO[stage].endless && minute >= CS_ENDLESS_STEADY_MINUTE)
    return {
      minimum: CS_ENDLESS_MINIMUM,
      interval: 1 / (CS_ENDLESS_RATE + minute * CS_ENDLESS_RATE_PER_MINUTE),
    };
  const index = Math.min(CS_SPAWN_SCHEDULE.length - 1, Math.floor(minute));
  const [minimum, interval] = CS_SPAWN_SCHEDULE[index] ?? [12, 1];
  return { minimum, interval };
};
/** Undercover's steady arrivals: raiders per second, and how much faster per minute of its clock. */
const CS_ENDLESS_STEADY_MINUTE = 5;
const CS_ENDLESS_MINIMUM = 30;
const CS_ENDLESS_RATE = 0.5;
const CS_ENDLESS_RATE_PER_MINUTE = 0.4;

/** An elite raider joins the run every this many seconds after the first. */
export const CS_ELITE_FIRST_SECONDS = 75;
export const CS_ELITE_EVERY_SECONDS = 50;
/** Undercover fades each new raider kind in over this many of its paced seconds. */
const CS_ENDLESS_FADE_SECONDS = 600;
/** Swarms: a ring of grunts closes in around the hero at these times. */
export const CS_SWARM_SECONDS = [150, 330, 510, 690, 810] as const;
/** Past the usual schedule, Undercover sends a hunter and an ambush this often. */
export const CS_ENDLESS_BOSS_SECONDS = 300;
export const CS_ENDLESS_SWARM_SECONDS = 180;
/**
 * An Undercover run that somehow outlasts this is extracted with its report; the
 * region is tuned so that even a perfect run cannot get near it.
 */
export const CS_ENDLESS_SECONDS = 4 * 60 * 60;

/** When the run's `index`-th hunter arrives, or null when no more come. */
export const csBossSeconds = (stage: CsStage, index: number): number | null => {
  const minute = CS_BOSS_MINUTES[index];
  if (minute !== undefined) return minute * 60;
  if (!CS_STAGE_INFO[stage].endless) return null;
  const last = CS_BOSS_MINUTES[CS_BOSS_MINUTES.length - 1] ?? 0;
  return last * 60 + (index - CS_BOSS_MINUTES.length + 1) * CS_ENDLESS_BOSS_SECONDS;
};

/** When the run's `index`-th ambush closes in, or null when no more come. */
export const csSwarmSeconds = (stage: CsStage, index: number): number | null => {
  const at = CS_SWARM_SECONDS[index];
  if (at !== undefined) return at;
  if (!CS_STAGE_INFO[stage].endless) return null;
  const last = CS_SWARM_SECONDS[CS_SWARM_SECONDS.length - 1] ?? 0;
  return last + (index - CS_SWARM_SECONDS.length + 1) * CS_ENDLESS_SWARM_SECONDS;
};

/** The endless region whose runs rank on the monthly leaderboard. */
export const CS_LEADERBOARD_STAGE = "undercover" satisfies CsStage;

/** How long a run in the region lasts at most: the report's due time, or Undercover's cap. */
export const csRunSeconds = (stage: CsStage) =>
  CS_STAGE_INFO[stage].endless ? CS_ENDLESS_SECONDS : CS_RUN_SECONDS;

/**
 * The run's clock as the raiders feel it. Undercover keeps the usual pace through its
 * `opening`, so it starts like Horizon, then slows to the square root of the time: the
 * usual fifteen-minute arc completes after about three quarters of an hour, and three
 * hours feel like thirty minutes, so the climb is long and steady instead of a wall.
 */
export const csPaced = (stage: CsStage, seconds: number) => {
  const endless = CS_STAGE_INFO[stage].endless;
  if (!endless || seconds <= endless.opening) return seconds;
  return Math.sqrt(endless.opening * seconds);
};

/**
 * Raiders defeated as the toughness ramp counts them: Undercover counts them at its
 * clock's slower pace; every other region counts them as they are.
 */
export const csPacedKills = (stage: CsStage, seconds: number, kills: number) =>
  CS_STAGE_INFO[stage].endless && seconds > 0
    ? (kills * csPaced(stage, seconds)) / seconds
    : kills;

/**
 * Experience the hero's `level` costs in a region. Undercover's levels grow dearer
 * through the first twenty, so it opens like Horizon and slows from there.
 */
export const csLevelCost = (stage: CsStage, level: number) => {
  const extra = (CS_STAGE_INFO[stage].endless?.levelCost ?? 1) - 1;
  return Math.round(
    csExperienceFor(level) * (1 + extra * Math.min(1, (level - 1) / 20)),
  );
};

export const CS_STAGES = CHAKRA_STORM_STAGES;
export type CsStage = (typeof CS_STAGES)[number];

/** How a region's field is laid out: ponds to wade through, trees and rocks to go around. */
export interface CsFieldPlan {
  ponds: number;
  trees: number;
  rocks: number;
}

export interface CsStageInfo {
  name: string;
  /** Where in Seichi it lies, for the region card. */
  region: string;
  summary: string;
  /** The terrain biome the field is painted with. */
  biome: "ground" | "dessert" | "snow";
  /**
   * The sun's path across the scouting run, from 0 at sunrise to 1 at sunset: where it
   * stands when the run starts and when the report is due. Past 1 the light turns to dusk.
   */
  sun: [start: number, end: number];
  /** Colour the field takes on at dusk. */
  dusk: number;
  field: CsFieldPlan;
  /** Multipliers on hostile health, speed, damage and the run's spawn pressure. */
  health: number;
  speed: number;
  damage: number;
  spawns: number;
  /** Extra weight per hostile kind on top of the run's usual mix. */
  mix: Partial<Record<CsEnemyKind, number>>;
  /** The hunters who lead the hostiles, in the order they arrive. */
  bosses: [string, string, string];
  /** Intel a run here brings home, as a multiple of the base award. */
  reward: number;
  /** Seconds scouted in the previous region that open this one; 0 opens it from the start. */
  unlockSeconds: number;
  /**
   * An endless region: no reinforcements come, the raiders' clock slows after its
   * `opening` seconds (see `csPaced`), levels cost `levelCost` times the usual
   * experience, and health and damage grow by these shares every hour on top. Its runs
   * rank on the leaderboard.
   */
  endless?: { opening: number; levelCost: number; health: number; damage: number };
}

export const CS_STAGE_INFO: Record<CsStage, CsStageInfo> = {
  horizon: {
    name: CHAKRA_STORM_STAGE_NAMES.horizon,
    region: "Horizon, the academy town",
    summary:
      "Map the fields and ponds beyond the academy, where outlaws have been seen watching the roads.",
    biome: "ground",
    sun: [0.3, 0.75],
    dusk: 0xff9a5a,
    field: { ponds: 3, trees: 24, rocks: 6 },
    health: 0.75,
    speed: 1,
    damage: 0.8,
    spawns: 1,
    mix: {},
    bosses: ["Bandit Chief", "Syndicate Enforcer", "Raid Warlord"],
    reward: 1,
    unlockSeconds: 0,
  },
  akasumi: {
    name: CHAKRA_STORM_STAGE_NAMES.akasumi,
    region: "Akasumi, the forest village",
    summary:
      "Learn why the forest spirits grow restless. The woods are thick, and something hunts between the roots.",
    biome: "ground",
    sun: [0.06, 0.5],
    dusk: 0xffb27a,
    field: { ponds: 3, trees: 40, rocks: 4 },
    health: 1.15,
    speed: 1.03,
    damage: 1.1,
    spawns: 1.05,
    mix: { caster: 3 },
    bosses: ["Hollow Warden", "Canopy Stalker", "Withered Ancient"],
    reward: 1.2,
    unlockSeconds: 600,
  },
  akikaze: {
    name: CHAKRA_STORM_STAGE_NAMES.akikaze,
    region: "Akikaze, the canyon village",
    summary:
      "Chart the canyon passes as storm winds rake the floor and fast raiders pour down from the cliffs.",
    biome: "dessert",
    sun: [0.45, 0.95],
    dusk: 0xff8a4a,
    field: { ponds: 1, trees: 10, rocks: 18 },
    health: 1.45,
    speed: 1.06,
    damage: 1.2,
    spawns: 1.1,
    mix: { runner: 8 },
    bosses: ["Canyon Marauder", "Thunderhide Beast", "Stormcaller"],
    reward: 1.35,
    unlockSeconds: 600,
  },
  hyorin: {
    name: CHAKRA_STORM_STAGE_NAMES.hyorin,
    region: "Hyorin, the mountain village",
    summary:
      "Scout the frozen pass where heavy brutes push through the snow and the lakes lie under ice.",
    biome: "snow",
    sun: [0.25, 0.6],
    dusk: 0xffc8a0,
    field: { ponds: 2, trees: 22, rocks: 10 },
    health: 1.9,
    speed: 1,
    damage: 1.25,
    spawns: 1.15,
    mix: { brute: 2, caster: 2 },
    bosses: ["Frostbound Ronin", "Avalanche Brute", "Glacier Tyrant"],
    reward: 1.5,
    unlockSeconds: 600,
  },
  mei: {
    name: CHAKRA_STORM_STAGE_NAMES.mei,
    region: "the Syndicate's outlaw stronghold",
    summary:
      "Spy on the Syndicate's own walls from sunset into the night, where every outlaw answers the alarm.",
    biome: "dessert",
    sun: [0.75, 1.25],
    dusk: 0xff6a4a,
    field: { ponds: 1, trees: 8, rocks: 20 },
    health: 2.6,
    speed: 1.08,
    damage: 1.55,
    spawns: 1.2,
    mix: { runner: 4, caster: 3, brute: 4 },
    bosses: ["Syndicate Lieutenant", "Crimson Executioner", "Lord of Mei"],
    reward: 1.7,
    unlockSeconds: 600,
  },
  undercover: {
    name: CHAKRA_STORM_STAGE_NAMES.undercover,
    region: "deep behind Syndicate lines",
    summary:
      "Slip into the Syndicate's hinterland and send word home for as long as your cover holds. No reinforcements are coming.",
    biome: "ground",
    sun: [0.2, 0.8],
    dusk: 0xff9a5a,
    field: { ponds: 3, trees: 24, rocks: 8 },
    health: 0.75,
    speed: 1,
    damage: 0.8,
    spawns: 1,
    mix: {},
    bosses: ["Syndicate Informant", "Shadow Broker", "Spymaster of Mei"],
    reward: 1,
    unlockSeconds: 0,
    endless: { opening: 300, levelCost: 3, health: 0.3, damage: 0.5 },
  },
};

/** Collision radius of a tree trunk and a rock, in units. */
export const CS_TREE_RADIUS = 0.55;
export const CS_ROCK_RADIUS = 0.5;
/** Wading through a pond slows hero and hostiles to this share of their speed. */
export const CS_WADE_SPEED = 0.55;

/** Kinds raiders spawn as at a given time on a stage, with their weights. */
export const csSpawnTable = (
  seconds: number,
  stage: CsStage,
): [CsEnemyKind, number][] => {
  const { mix, endless } = CS_STAGE_INFO[stage];
  // In Undercover each new kind fades in rather than arriving at full strength, so no
  // single minute becomes a wall that no build can outgrow.
  const fade = (start: number) =>
    endless ? Math.min(1, (seconds - start) / CS_ENDLESS_FADE_SECONDS) : 1;
  // Tougher kinds join as the run goes on and the early ones thin out, which carries
  // most of the late game's health growth, as survivors-likes swap in new enemy types.
  const table: [CsEnemyKind, number][] = [["grunt", Math.max(2, 10 - seconds / 90)]];
  if (seconds >= 90)
    table.push(["runner", (4 + seconds / 120 + (mix.runner ?? 0)) * fade(90)]);
  if (seconds >= 180)
    table.push(["caster", (2 + seconds / 200 + (mix.caster ?? 0)) * fade(180)]);
  if (seconds >= 240)
    table.push(["brute", (1 + seconds / 150 + (mix.brute ?? 0)) * fade(240)]);
  if (seconds >= 480) table.push(["veteran", (2 + seconds / 150) * fade(480)]);
  if (seconds >= 690) table.push(["juggernaut", (1 + seconds / 300) * fade(690)]);
  return table;
};

/**
 * The daily scouting report: a signed-in player's first run of the UTC day that scouts at
 * least this long pays the same reward as the daily Guard Hall duty.
 */
export const CS_DAILY_SECONDS = 5 * 60;

/** Permanent upgrades bought in the Training Hall with intel. */
export const CS_TRAINING = [
  "might",
  "vitality",
  "recovery",
  "haste",
  "swiftness",
  "reach",
  "luck",
  "revival",
  "reroll",
] as const;
export type CsTraining = (typeof CS_TRAINING)[number];

export interface CsTrainingInfo {
  name: string;
  perLevel: string;
  maxLevel: number;
  /** Shard price of the first level. */
  baseCost: number;
}

/** What each Training Hall level adds. */
export const CS_TRAINING_EFFECT = {
  might: 0.1,
  vitality: 25,
  recovery: 0.4,
  haste: 0.04,
  swiftness: 0.05,
  reach: 0.2,
  luck: 0.03,
} as const;

const percent = (share: number) => Math.round(share * 100);

export const CS_TRAINING_INFO: Record<CsTraining, CsTrainingInfo> = {
  might: {
    name: "Might",
    perLevel: `+${percent(CS_TRAINING_EFFECT.might)}% jutsu damage`,
    maxLevel: 5,
    baseCost: 200,
  },
  vitality: {
    name: "Vitality",
    perLevel: `+${CS_TRAINING_EFFECT.vitality} health`,
    maxLevel: 5,
    baseCost: 200,
  },
  recovery: {
    name: "Recovery",
    perLevel: `+${CS_TRAINING_EFFECT.recovery} health per second`,
    maxLevel: 5,
    baseCost: 200,
  },
  haste: {
    name: "Haste",
    perLevel: `-${percent(CS_TRAINING_EFFECT.haste)}% jutsu cooldowns`,
    maxLevel: 3,
    baseCost: 600,
  },
  swiftness: {
    name: "Swiftness",
    perLevel: `+${percent(CS_TRAINING_EFFECT.swiftness)}% movement speed`,
    maxLevel: 3,
    baseCost: 300,
  },
  reach: {
    name: "Reach",
    perLevel: `+${percent(CS_TRAINING_EFFECT.reach)}% pickup range`,
    maxLevel: 3,
    baseCost: 300,
  },
  luck: {
    name: "Luck",
    perLevel: `+${percent(CS_TRAINING_EFFECT.luck)}% critical chance`,
    maxLevel: 3,
    baseCost: 400,
  },
  revival: {
    name: "Second Wind",
    perLevel: "Rise once per run with half health",
    maxLevel: 1,
    baseCost: 1500,
  },
  reroll: {
    name: "Insight",
    perLevel: "+1 draft reroll per run",
    maxLevel: 3,
    baseCost: 500,
  },
};

/** Training levels, all zero for a new player. */
export type CsTrainingLevels = Record<CsTraining, number>;
export const csNoTraining = (): CsTrainingLevels =>
  Object.fromEntries(CS_TRAINING.map((id) => [id, 0])) as CsTrainingLevels;

/**
 * Price of the next level of an upgrade, after Vampire Survivors' PowerUp prices: each
 * level costs its base once more, and every level bought anywhere in the hall adds a
 * surcharge growing 10% per level, so the hall's total power stays a late reward.
 */
export const csTrainingCost = (
  id: CsTraining,
  levels: CsTrainingLevels,
): number | null => {
  const info = CS_TRAINING_INFO[id];
  const level = levels[id];
  if (level >= info.maxLevel) return null;
  const bought = CS_TRAINING.reduce((sum, key) => sum + levels[key], 0);
  let growth = 1;
  for (let i = 0; i < bought; i++) growth *= 1.1;
  return info.baseCost * (level + 1) + Math.floor(20 * growth);
};

/** Intel a finished run earns: time, raiders and captains, scaled by the stage. */
export const csIntelFor = (run: {
  seconds: number;
  kills: number;
  bosses: number;
  won: boolean;
  stage: CsStage;
}) =>
  Math.floor(
    (run.seconds / 4 + run.kills / 10 + run.bosses * 40 + (run.won ? 150 : 0)) *
      CS_STAGE_INFO[run.stage].reward,
  );
