/**
 * Tower-defense content: enemies, affixes, eras, jutsu, sentries, seal arts, ultimates,
 * perks, the in-run shop and the permanent Dojo. Everything here is data read by the
 * deterministic simulation (`sim.ts`), the server replay and the UI, so balance changes
 * apply to all three at once. Changing a value changes how recorded runs replay; runs
 * are only replayed while their session token is live, so this is safe between deploys
 * as long as no claim straddles one.
 */

// ============================================
// Elements and enemies
// ============================================

export const TD_ELEMENTS = [
  "physical",
  "fire",
  "lightning",
  "water",
  "wind",
  "earth",
] as const;
export type TdElement = (typeof TD_ELEMENTS)[number];

export const TD_ENEMY_KINDS = [
  "grunt",
  "swift",
  "brute",
  "archer",
  "shieldbearer",
  "splitter",
  "mini",
  "regenerator",
  "shade",
  "medic",
  "bomber",
  "summoner",
  "golem",
  "wraith",
  "boss",
  "titan",
] as const;
export type TdEnemyKind = (typeof TD_ENEMY_KINDS)[number];

export interface TdEnemyArchetype {
  name: string;
  /** What the player should learn about this enemy. */
  hint: string;
  /** Multipliers on the wave's reference health, damage and bounty. */
  hp: number;
  damage: number;
  bounty: number;
  /** Units per second. */
  speed: number;
  /** Seconds between attacks. */
  attackEvery: number;
  /** Attack range in units; melee enemies stop at the hero. */
  range: number;
  firstWave: number;
  /** Relative spawn weight once unlocked; 0 means never spawned by waves directly. */
  weight: number;
  /** Flat damage reduction per hit as a fraction of max health. */
  armor?: number;
  /** Shield as a fraction of max health; refills after `TD_SHIELD_REFILL_TICKS` unhit. */
  shield?: number;
  /** Health regained per second as a fraction of max health, blocked by burning. */
  regen?: number;
  split?: { kind: TdEnemyKind; count: number };
  /** Only targetable by auto-attacks within `TD_CAMO_REVEAL_RANGE` unless detected. */
  camo?: boolean;
  /** Heals allies in a radius by a fraction of their max health per second. */
  heal?: { radius: number; pct: number };
  /** Explodes on reaching the hero for this multiple of its damage. */
  explode?: number;
  summon?: { everySeconds: number; count: number };
  /** Immune to slows, stuns and knockback. */
  ccImmune?: boolean;
  /** Untargetable and immune for 1s of every 3s. */
  phase?: boolean;
  /** Render tint. */
  tint: number;
  /** Rendered size in units. */
  size: number;
}

export const TD_ENEMIES: Record<TdEnemyKind, TdEnemyArchetype> = {
  grunt: {
    name: "Bandit",
    hint: "Basic melee fighter.",
    hp: 1,
    damage: 1,
    bounty: 1,
    speed: 0.9,
    attackEvery: 1,
    range: 0,
    firstWave: 1,
    weight: 10,
    tint: 0xffffff,
    size: 1,
  },
  swift: {
    name: "Runner",
    hint: "Fast and fragile. Slows and range keep them off you.",
    hp: 0.55,
    damage: 0.7,
    bounty: 0.9,
    speed: 1.9,
    attackEvery: 0.7,
    range: 0,
    firstWave: 4,
    weight: 6,
    tint: 0xbfe9ff,
    size: 0.85,
  },
  brute: {
    name: "Armored Brute",
    hint: "Armor shrugs off weak hits. Use big hits, crits or lightning.",
    hp: 3,
    damage: 2,
    bounty: 2.5,
    speed: 0.55,
    attackEvery: 1.4,
    range: 0,
    firstWave: 8,
    weight: 4,
    armor: 0.06,
    tint: 0xc0c4cc,
    size: 1.25,
  },
  archer: {
    name: "Kunai Thrower",
    hint: "Attacks from range. Extend your range or blink toward them.",
    hp: 0.8,
    damage: 0.8,
    bounty: 1.4,
    speed: 0.8,
    attackEvery: 1.6,
    range: 5.5,
    firstWave: 12,
    weight: 4,
    tint: 0xffe6a8,
    size: 0.95,
  },
  shieldbearer: {
    name: "Chakra Guard",
    hint: "Shield refills when left alone. Lightning breaks shields twice as fast.",
    hp: 1.2,
    damage: 1.2,
    bounty: 2,
    speed: 0.75,
    attackEvery: 1.1,
    range: 0,
    firstWave: 18,
    weight: 4,
    shield: 1.4,
    tint: 0x9fd0ff,
    size: 1.1,
  },
  splitter: {
    name: "Clay Clone",
    hint: "Splits into three when killed. Area damage cleans up.",
    hp: 1.6,
    damage: 1,
    bounty: 1.2,
    speed: 0.8,
    attackEvery: 1,
    range: 0,
    firstWave: 24,
    weight: 4,
    split: { kind: "mini", count: 3 },
    tint: 0xd9a36c,
    size: 1.1,
  },
  mini: {
    name: "Clay Fragment",
    hint: "Remains of a clay clone.",
    hp: 0.35,
    damage: 0.5,
    bounty: 0.3,
    speed: 1.2,
    attackEvery: 0.8,
    range: 0,
    firstWave: 1,
    weight: 0,
    tint: 0xd9a36c,
    size: 0.6,
  },
  regenerator: {
    name: "Cursed Monk",
    hint: "Regenerates quickly. Fire and black flames stop the healing.",
    hp: 1.9,
    damage: 1.1,
    bounty: 2,
    speed: 0.7,
    attackEvery: 1.1,
    range: 0,
    firstWave: 30,
    weight: 3,
    regen: 0.06,
    tint: 0xa4ffa4,
    size: 1.1,
  },
  shade: {
    name: "Shade",
    hint: "Camouflaged: auto-attacks only see it up close. Sensor totems reveal it.",
    hp: 1,
    damage: 1.3,
    bounty: 2,
    speed: 1.15,
    attackEvery: 0.9,
    range: 0,
    firstWave: 40,
    weight: 3,
    camo: true,
    tint: 0x8a7bd8,
    size: 1,
  },
  medic: {
    name: "Field Medic",
    hint: "Heals nearby enemies. Kill it first: mark it or use Support targeting.",
    hp: 1.5,
    damage: 0.6,
    bounty: 2.5,
    speed: 0.65,
    attackEvery: 1.5,
    range: 3,
    firstWave: 52,
    weight: 2,
    heal: { radius: 3, pct: 0.04 },
    tint: 0xffb3d1,
    size: 1,
  },
  bomber: {
    name: "Tag Runner",
    hint: "Sprints in and explodes. Knock it back, slow it, or swap out with Substitution.",
    hp: 0.7,
    damage: 1,
    bounty: 1.8,
    speed: 1.6,
    attackEvery: 1,
    range: 0,
    firstWave: 62,
    weight: 3,
    explode: 7,
    tint: 0xff8a5c,
    size: 0.95,
  },
  summoner: {
    name: "Summoner",
    hint: "Keeps calling bandits. Hunt it down.",
    hp: 2.6,
    damage: 0.8,
    bounty: 3,
    speed: 0.5,
    attackEvery: 1.5,
    range: 4,
    firstWave: 76,
    weight: 2,
    summon: { everySeconds: 4, count: 2 },
    tint: 0xd6a8ff,
    size: 1.15,
  },
  golem: {
    name: "Stone Golem",
    hint: "Huge, armored and immune to crowd control.",
    hp: 8,
    damage: 3,
    bounty: 6,
    speed: 0.35,
    attackEvery: 1.8,
    range: 0,
    firstWave: 100,
    weight: 2,
    armor: 0.08,
    ccImmune: true,
    tint: 0x9c8f80,
    size: 1.6,
  },
  wraith: {
    name: "Wraith",
    hint: "Phases out of reality every few seconds. Hit it while it is solid.",
    hp: 2,
    damage: 1.6,
    bounty: 3,
    speed: 1,
    attackEvery: 1,
    range: 0,
    firstWave: 140,
    weight: 2,
    phase: true,
    tint: 0x7ff0e6,
    size: 1.05,
  },
  boss: {
    name: "Rogue Jonin",
    hint: "Boss. Watch for red circles: blink away or time a Substitution.",
    hp: 40,
    damage: 4,
    bounty: 25,
    speed: 0.5,
    attackEvery: 1.4,
    range: 0,
    firstWave: 10,
    weight: 0,
    tint: 0xffffff,
    size: 1.9,
  },
  titan: {
    name: "Titan",
    hint: "Era boss. Every move in the book, and it enrages.",
    hp: 220,
    damage: 7,
    bounty: 120,
    speed: 0.4,
    attackEvery: 1.6,
    range: 0,
    firstWave: 50,
    weight: 0,
    ccImmune: true,
    tint: 0xffd36b,
    size: 2.6,
  },
};

// ============================================
// Elite affixes
// ============================================

export const TD_AFFIXES = [
  "armored",
  "shielded",
  "hasted",
  "regenerating",
  "vampiric",
  "juggernaut",
  "warded",
  "splitting",
  "berserk",
] as const;
export type TdAffix = (typeof TD_AFFIXES)[number];

export const TD_AFFIX_INFO: Record<
  TdAffix,
  { name: string; hint: string; tint: number }
> = {
  armored: { name: "Armored", hint: "+5% armor", tint: 0xc0c4cc },
  shielded: { name: "Shielded", hint: "Chakra shield", tint: 0x6fb8ff },
  hasted: { name: "Hasted", hint: "+50% speed", tint: 0xfff176 },
  regenerating: { name: "Regenerating", hint: "Heals 3%/s", tint: 0x8cff8c },
  vampiric: { name: "Vampiric", hint: "Heals from hits on you", tint: 0xff4d6d },
  juggernaut: { name: "Juggernaut", hint: "Crowd control immune", tint: 0xb08968 },
  warded: { name: "Warded", hint: "Resists one element", tint: 0xe0aaff },
  splitting: { name: "Splitting", hint: "Splits on death", tint: 0xd9a36c },
  berserk: { name: "Berserk", hint: "Faster and harder at low health", tint: 0xff6b35 },
};

// ============================================
// Eras: wave modifiers rotating every 10 waves
// ============================================

export const TD_ERAS = [
  "calm",
  "iron_tide",
  "blitz",
  "swarm",
  "fog",
  "siege",
  "titans",
  "blood_moon",
  "elemental_storm",
  "hydra",
  "meteor_shower",
  "rifts",
] as const;
export type TdEra = (typeof TD_ERAS)[number];

export const TD_ERA_INFO: Record<
  TdEra,
  { name: string; description: string; firstWave: number; sky: number }
> = {
  calm: {
    name: "Calm",
    description: "No modifier.",
    firstWave: 1,
    sky: 0x87b5ff,
  },
  iron_tide: {
    name: "Iron Tide",
    description: "Every enemy wears armor. Hit hard or use lightning.",
    firstWave: 21,
    sky: 0x9aa5b1,
  },
  blitz: {
    name: "Blitz",
    description: "Enemies are 40% faster but 20% frailer.",
    firstWave: 21,
    sky: 0xffd36b,
  },
  swarm: {
    name: "Swarm",
    description: "Twice the enemies at 45% health. Area damage shines.",
    firstWave: 21,
    sky: 0xb7e07a,
  },
  fog: {
    name: "Fog of War",
    description: "Range -25% and every third enemy is camouflaged.",
    firstWave: 41,
    sky: 0x6b7a8f,
  },
  siege: {
    name: "Siege",
    description: "Three times as many kunai throwers with longer range.",
    firstWave: 41,
    sky: 0xd9915c,
  },
  titans: {
    name: "Titans",
    description: "Half the enemies with 2.5x health, all immune to crowd control.",
    firstWave: 61,
    sky: 0x8d6e63,
  },
  blood_moon: {
    name: "Blood Moon",
    description: "Enemies regenerate and heal from their hits.",
    firstWave: 81,
    sky: 0xb3002d,
  },
  elemental_storm: {
    name: "Elemental Storm",
    description: "Every enemy resists a random element. Diversify your damage.",
    firstWave: 91,
    sky: 0x7c4dff,
  },
  hydra: {
    name: "Hydra",
    description: "Every enemy splits in two when it dies.",
    firstWave: 111,
    sky: 0x2e7d32,
  },
  meteor_shower: {
    name: "Meteor Shower",
    description: "Meteors rain on the arena. They hit enemies too, and you.",
    firstWave: 151,
    sky: 0xff5722,
  },
  rifts: {
    name: "Void Rifts",
    description: "Enemies tear through rifts much closer to you.",
    firstWave: 201,
    sky: 0x311b92,
  },
};

/** Visual stage of the run, changing the sky and effects as waves climb. */
export const TD_STAGES = [
  { wave: 1, name: "Dawn", sky: 0x9cc8ff, ground: 0xffffff },
  { wave: 25, name: "Midday", sky: 0xbfe3ff, ground: 0xffffff },
  { wave: 50, name: "Dusk", sky: 0xff9e6b, ground: 0xffe0c8 },
  { wave: 100, name: "Blood Moon", sky: 0x8b0f2e, ground: 0xffb3b3 },
  { wave: 200, name: "Eclipse", sky: 0x2b1640, ground: 0xc9a3ff },
  { wave: 300, name: "Void", sky: 0x0d0221, ground: 0x9e8cff },
  { wave: 400, name: "Cosmic", sky: 0x050014, ground: 0x7fdfff },
  { wave: 500, name: "Infinite Dream", sky: 0x000000, ground: 0xffffff },
] as const;

export const tdStageForWave = (wave: number) => {
  let stage: (typeof TD_STAGES)[number] = TD_STAGES[0];
  for (const candidate of TD_STAGES) if (wave >= candidate.wave) stage = candidate;
  return stage;
};

// ============================================
// Hero jutsu, sentries, seal arts and ultimates
// ============================================

export const TD_JUTSU = ["fire", "lightning", "water", "wind", "earth"] as const;
export type TdJutsu = (typeof TD_JUTSU)[number];

export const TD_JUTSU_INFO: Record<
  TdJutsu,
  {
    name: string;
    evolvedName: string;
    description: string;
    element: TdElement;
    /** Seconds between automatic casts. */
    cooldown: number;
    /** Multiple of hero shuriken damage. */
    power: number;
    radius: number;
  }
> = {
  fire: {
    name: "Great Fireball",
    evolvedName: "Phoenix Flower",
    description:
      "Explodes on the densest crowd and sets it ablaze. Burning blocks regen.",
    element: "fire",
    cooldown: 4,
    power: 4,
    radius: 1.6,
  },
  lightning: {
    name: "Lightning Chain",
    evolvedName: "Kirin",
    description:
      "Chains between enemies, ignoring armor and hitting shields twice as hard.",
    element: "lightning",
    cooldown: 3,
    power: 2.5,
    radius: 6,
  },
  water: {
    name: "Tidal Wave",
    evolvedName: "Absolute Zero",
    description: "A wave around you that chills: slowed enemies take +20% damage.",
    element: "water",
    cooldown: 6,
    power: 1.5,
    radius: 5,
  },
  wind: {
    name: "Vacuum Blades",
    evolvedName: "Gale Spiral",
    description: "A blade that pierces every enemy in a line and pushes them back.",
    element: "wind",
    cooldown: 2.5,
    power: 2,
    radius: 8,
  },
  earth: {
    name: "Stone Spikes",
    evolvedName: "Tectonic Rift",
    description: "Spikes erupt around you, stunning and knocking enemies back.",
    element: "earth",
    cooldown: 7,
    power: 3,
    radius: 3,
  },
};

export const TD_SENTRIES = ["kunai", "mortar", "rod", "frost", "sensor"] as const;
export type TdSentry = (typeof TD_SENTRIES)[number];

export const TD_SENTRY_INFO: Record<
  TdSentry,
  {
    name: string;
    description: string;
    element: TdElement;
    /** Half the ryo to build; each level costs 60% more than the last. */
    cost: number;
    /** Seconds between attacks. */
    attackEvery: number;
    power: number;
    range: number;
  }
> = {
  kunai: {
    name: "Kunai Turret",
    description: "Rapid single-target kunai.",
    element: "physical",
    cost: 40,
    attackEvery: 0.5,
    power: 0.6,
    range: 6,
  },
  mortar: {
    name: "Tag Mortar",
    description: "Lobs explosive tags at crowds.",
    element: "fire",
    cost: 70,
    attackEvery: 2,
    power: 2.5,
    range: 7,
  },
  rod: {
    name: "Lightning Rod",
    description: "Chains three enemies, ignoring armor.",
    element: "lightning",
    cost: 80,
    attackEvery: 1.25,
    power: 1.2,
    range: 4.5,
  },
  frost: {
    name: "Frost Totem",
    description: "Chills everything nearby and pulses damage.",
    element: "water",
    cost: 60,
    attackEvery: 1,
    power: 0.5,
    range: 3.5,
  },
  sensor: {
    name: "Sensor Totem",
    description: "Reveals camouflage within its range; enemies there take +15% damage.",
    element: "physical",
    cost: 50,
    attackEvery: 1,
    power: 0,
    range: 6,
  },
};

/** Hand seals; a sequence of three casts a seal art at the aimed spot. */
export const TD_SEALS = ["tiger", "snake", "dog", "bird"] as const;
export type TdSeal = (typeof TD_SEALS)[number];

export const TD_SEAL_ARTS = [
  "dragon_flame",
  "thunder_strike",
  "water_prison",
  "cyclone",
  "mystic_palm",
  "earth_dome",
] as const;
export type TdSealArt = (typeof TD_SEAL_ARTS)[number];

export const TD_SEAL_ART_INFO: Record<
  TdSealArt,
  {
    name: string;
    description: string;
    seals: readonly [TdSeal, TdSeal, TdSeal];
    chakra: number;
    power: number;
    radius: number;
    firstWave: number;
    element: TdElement;
  }
> = {
  dragon_flame: {
    name: "Dragon Flame",
    description: "Engulfs the aimed area in long-burning fire.",
    seals: ["tiger", "snake", "tiger"],
    chakra: 30,
    power: 10,
    radius: 2,
    firstWave: 1,
    element: "fire",
  },
  thunder_strike: {
    name: "Thunder Strike",
    description:
      "A bolt on the strongest enemy at the aim: huge, armor-piercing, stuns.",
    seals: ["dog", "bird", "dog"],
    chakra: 35,
    power: 30,
    radius: 2.5,
    firstWave: 15,
    element: "lightning",
  },
  water_prison: {
    name: "Water Prison",
    description: "Freezes enemies at the aim for 3s; frozen enemies take +30% damage.",
    seals: ["snake", "dog", "bird"],
    chakra: 30,
    power: 2,
    radius: 2,
    firstWave: 30,
    element: "water",
  },
  cyclone: {
    name: "Cyclone",
    description: "A vortex that drags enemies into its eye and shreds them.",
    seals: ["bird", "tiger", "bird"],
    chakra: 40,
    power: 3,
    radius: 3,
    firstWave: 50,
    element: "wind",
  },
  mystic_palm: {
    name: "Mystic Palm",
    description: "Heal 35% of your health and burn away every debuff.",
    seals: ["snake", "snake", "dog"],
    chakra: 45,
    power: 0.35,
    radius: 0,
    firstWave: 8,
    element: "physical",
  },
  earth_dome: {
    name: "Earth Dome",
    description: "Halve all damage you take for 5s.",
    seals: ["tiger", "dog", "tiger"],
    chakra: 40,
    power: 0.5,
    radius: 0,
    firstWave: 70,
    element: "earth",
  },
};

export const TD_ULTIMATES = [
  "clones",
  "tempest",
  "amaterasu",
  "tsukuyomi",
  "cataclysm",
] as const;
export type TdUltimate = (typeof TD_ULTIMATES)[number];

export const TD_ULTIMATE_INFO: Record<
  TdUltimate,
  { name: string; description: string; cooldown: number; aimed: boolean }
> = {
  clones: {
    name: "Shadow Clone Army",
    description: "Six clones join the fight for 10s, each throwing at half your power.",
    cooldown: 75,
    aimed: false,
  },
  tempest: {
    name: "Spiral Tempest",
    description:
      "A screaming spiral of wind at the aimed spot shreds everything for 6s.",
    cooldown: 60,
    aimed: true,
  },
  amaterasu: {
    name: "Amaterasu",
    description: "Black flames on every enemy: 3% of their max health per second.",
    cooldown: 90,
    aimed: false,
  },
  tsukuyomi: {
    name: "Tsukuyomi",
    description: "Time stops for every enemy for 5s; they take +50% damage.",
    cooldown: 120,
    aimed: false,
  },
  cataclysm: {
    name: "Chakra Cataclysm",
    description: "A colossal bomb at the aimed spot: 150x damage and a shockwave.",
    cooldown: 150,
    aimed: true,
  },
};

// ============================================
// Perks drafted after each boss
// ============================================

export const TD_PERKS = [
  "sharp_steel",
  "quick_hands",
  "keen_eye",
  "long_arm",
  "iron_body",
  "second_breath",
  "stone_skin",
  "fortune",
  "jutsu_focus",
  "fast_seals",
  "engineer",
  "twin_throw",
  "ricochet",
  "glass_cannon",
  "greed",
  "berserker",
  "gale_hands",
  "blood_pact",
  "fortress",
  "exploding_kunai",
  "burning_steel",
  "static_charge",
  "frost_edge",
  "executioner",
  "bounty_hunter",
  "second_wind",
  "chakra_well",
  "trapper",
  "evolve_fire",
  "evolve_lightning",
  "evolve_water",
  "evolve_wind",
  "evolve_earth",
] as const;
export type TdPerk = (typeof TD_PERKS)[number];

export interface TdPerkInfo {
  name: string;
  description: string;
  /** Picked at most this many times per run. */
  max: number;
  firstWave: number;
  /** Tradeoffs and evolutions are highlighted in the draft. */
  kind: "stat" | "tradeoff" | "mechanic" | "evolution";
  /** Evolutions need this jutsu at in-run level `TD_EVOLUTION_LEVEL` or more. */
  jutsu?: TdJutsu;
}

export const TD_PERK_INFO: Record<TdPerk, TdPerkInfo> = {
  sharp_steel: {
    name: "Sharp Steel",
    description: "+30% shuriken damage.",
    max: 99,
    firstWave: 1,
    kind: "stat",
  },
  quick_hands: {
    name: "Quick Hands",
    description: "+20% attack speed.",
    max: 99,
    firstWave: 1,
    kind: "stat",
  },
  keen_eye: {
    name: "Keen Eye",
    description: "+8% crit chance and +50% crit damage.",
    max: 5,
    firstWave: 1,
    kind: "stat",
  },
  long_arm: {
    name: "Long Arm",
    description: "+0.8 range.",
    max: 4,
    firstWave: 1,
    kind: "stat",
  },
  iron_body: {
    name: "Iron Body",
    description: "+40% max health.",
    max: 99,
    firstWave: 1,
    kind: "stat",
  },
  second_breath: {
    name: "Second Breath",
    description: "+1% health regeneration per second.",
    max: 5,
    firstWave: 1,
    kind: "stat",
  },
  stone_skin: {
    name: "Stone Skin",
    description: "+8% damage reduction.",
    max: 4,
    firstWave: 1,
    kind: "stat",
  },
  fortune: {
    name: "Fortune",
    description: "+35% ryo.",
    max: 99,
    firstWave: 1,
    kind: "stat",
  },
  jutsu_focus: {
    name: "Jutsu Focus",
    description: "+30% jutsu damage.",
    max: 99,
    firstWave: 5,
    kind: "stat",
  },
  fast_seals: {
    name: "Fast Seals",
    description: "-12% jutsu cooldowns.",
    max: 3,
    firstWave: 5,
    kind: "stat",
  },
  engineer: {
    name: "Engineer",
    description: "+40% sentry damage.",
    max: 99,
    firstWave: 15,
    kind: "stat",
  },
  twin_throw: {
    name: "Twin Throw",
    description: "+1 multishot target.",
    max: 3,
    firstWave: 20,
    kind: "stat",
  },
  ricochet: {
    name: "Ricochet",
    description: "Shuriken bounce to 2 more enemies.",
    max: 3,
    firstWave: 20,
    kind: "stat",
  },
  glass_cannon: {
    name: "Glass Cannon",
    description: "+90% damage everywhere, but -40% max health.",
    max: 2,
    firstWave: 10,
    kind: "tradeoff",
  },
  greed: {
    name: "Greed",
    description: "+80% ryo and +30% scrolls, but enemies have +25% health.",
    max: 2,
    firstWave: 10,
    kind: "tradeoff",
  },
  berserker: {
    name: "Berserker",
    description: "Up to +150% damage as your health drops, but -25% regen.",
    max: 1,
    firstWave: 20,
    kind: "tradeoff",
  },
  gale_hands: {
    name: "Gale Hands",
    description: "+50% attack speed, but -1 range.",
    max: 2,
    firstWave: 20,
    kind: "tradeoff",
  },
  blood_pact: {
    name: "Blood Pact",
    description: "Heal 1.5% of damage dealt, but regen is halved.",
    max: 1,
    firstWave: 30,
    kind: "tradeoff",
  },
  fortress: {
    name: "Fortress",
    description: "+20% damage reduction, but -25% attack speed.",
    max: 1,
    firstWave: 30,
    kind: "tradeoff",
  },
  exploding_kunai: {
    name: "Exploding Kunai",
    description: "Kills explode, dealing 40% of the victim's max health nearby.",
    max: 1,
    firstWave: 20,
    kind: "mechanic",
  },
  burning_steel: {
    name: "Burning Steel",
    description: "Shuriken set enemies ablaze, blocking regen.",
    max: 1,
    firstWave: 30,
    kind: "mechanic",
  },
  static_charge: {
    name: "Static Charge",
    description: "Every 8th shuriken calls down a chain of lightning.",
    max: 1,
    firstWave: 30,
    kind: "mechanic",
  },
  frost_edge: {
    name: "Frost Edge",
    description: "Shuriken chill: -25% speed and +20% damage taken.",
    max: 1,
    firstWave: 40,
    kind: "mechanic",
  },
  executioner: {
    name: "Executioner",
    description: "Non-boss enemies below 10% health die instantly.",
    max: 1,
    firstWave: 40,
    kind: "mechanic",
  },
  bounty_hunter: {
    name: "Bounty Hunter",
    description: "Elites and bosses drop triple ryo, and loot drops twice as often.",
    max: 1,
    firstWave: 20,
    kind: "mechanic",
  },
  second_wind: {
    name: "Second Wind",
    description: "Once this run, survive a killing blow at 50% health.",
    max: 1,
    firstWave: 30,
    kind: "mechanic",
  },
  chakra_well: {
    name: "Chakra Well",
    description: "+50 max chakra and double chakra regeneration.",
    max: 2,
    firstWave: 10,
    kind: "mechanic",
  },
  trapper: {
    name: "Trapper",
    description: "+2 explosive tag charges; tags deal double damage.",
    max: 1,
    firstWave: 15,
    kind: "mechanic",
  },
  evolve_fire: {
    name: "Evolution: Phoenix Flower",
    description: "Great Fireball splits into five fireballs.",
    max: 1,
    firstWave: 10,
    kind: "evolution",
    jutsu: "fire",
  },
  evolve_lightning: {
    name: "Evolution: Kirin",
    description: "Every cast also strikes every enemy on the field.",
    max: 1,
    firstWave: 10,
    kind: "evolution",
    jutsu: "lightning",
  },
  evolve_water: {
    name: "Evolution: Absolute Zero",
    description: "Tidal Wave freezes enemies solid for 1.5s.",
    max: 1,
    firstWave: 10,
    kind: "evolution",
    jutsu: "water",
  },
  evolve_wind: {
    name: "Evolution: Gale Spiral",
    description: "Vacuum Blades fire in three directions and pull enemies.",
    max: 1,
    firstWave: 10,
    kind: "evolution",
    jutsu: "wind",
  },
  evolve_earth: {
    name: "Evolution: Tectonic Rift",
    description: "Stone Spikes erupt in three expanding rings and stun 1s longer.",
    max: 1,
    firstWave: 10,
    kind: "evolution",
    jutsu: "earth",
  },
};

/** In-run jutsu level at which its evolution can be drafted. */
export const TD_EVOLUTION_LEVEL = 8;

// ============================================
// In-run shop (ryo)
// ============================================

export const TD_SHOP = [
  "damage",
  "rate",
  "crit",
  "range",
  "health",
  "regen",
  "block",
  "ryo",
  "chakra",
  "jutsu_fire",
  "jutsu_lightning",
  "jutsu_water",
  "jutsu_wind",
  "jutsu_earth",
] as const;
export type TdShopItem = (typeof TD_SHOP)[number];

export interface TdShopInfo {
  name: string;
  description: string;
  /** Cost of level 1 as a multiple of the wave-1 bounty, and its growth per level. */
  base: number;
  growth: number;
  max: number;
  jutsu?: TdJutsu;
}

export const TD_SHOP_INFO: Record<TdShopItem, TdShopInfo> = {
  damage: {
    name: "Damage",
    description: "x1.08 shuriken damage",
    base: 8,
    growth: 1.16,
    max: 2000,
  },
  rate: {
    name: "Attack Speed",
    description: "+4% attack speed",
    base: 12,
    growth: 1.13,
    max: 75,
  },
  crit: {
    name: "Crit",
    description: "+1% crit chance, +5% crit damage",
    base: 15,
    growth: 1.13,
    max: 40,
  },
  range: {
    name: "Range",
    description: "+0.1 range",
    base: 20,
    growth: 1.2,
    max: 25,
  },
  health: {
    name: "Health",
    description: "x1.08 max health",
    base: 8,
    growth: 1.16,
    max: 2000,
  },
  regen: {
    name: "Regeneration",
    description: "+0.1% health per second",
    base: 12,
    growth: 1.14,
    max: 50,
  },
  block: {
    name: "Defense",
    description: "+1% damage reduction",
    base: 20,
    growth: 1.16,
    max: 25,
  },
  ryo: {
    name: "Ryo Bonus",
    description: "+6% ryo from kills",
    base: 25,
    growth: 1.17,
    max: 20,
  },
  chakra: {
    name: "Chakra Flow",
    description: "+10% chakra regeneration",
    base: 20,
    growth: 1.2,
    max: 30,
  },
  jutsu_fire: {
    name: "Great Fireball",
    description: "x1.08 damage, -2% cooldown",
    base: 25,
    growth: 1.2,
    max: 2000,
    jutsu: "fire",
  },
  jutsu_lightning: {
    name: "Lightning Chain",
    description: "x1.08 damage, -2% cooldown, +1 chain every 3 levels",
    base: 25,
    growth: 1.2,
    max: 2000,
    jutsu: "lightning",
  },
  jutsu_water: {
    name: "Tidal Wave",
    description: "x1.08 damage, -2% cooldown",
    base: 25,
    growth: 1.2,
    max: 2000,
    jutsu: "water",
  },
  jutsu_wind: {
    name: "Vacuum Blades",
    description: "x1.08 damage, -2% cooldown",
    base: 25,
    growth: 1.2,
    max: 2000,
    jutsu: "wind",
  },
  jutsu_earth: {
    name: "Stone Spikes",
    description: "x1.08 damage, -2% cooldown",
    base: 25,
    growth: 1.2,
    max: 2000,
    jutsu: "earth",
  },
};

/** How "Spend all" weighs each item: it buys whichever is cheapest for its weight. */
export const TD_SPEND_WEIGHTS: Record<TdShopItem, number> = {
  damage: 3,
  health: 2.2,
  rate: 1.6,
  regen: 1,
  crit: 1,
  block: 0.8,
  range: 0.6,
  ryo: 0.6,
  chakra: 0.3,
  jutsu_fire: 1.2,
  jutsu_lightning: 1.2,
  jutsu_water: 1,
  jutsu_wind: 1,
  jutsu_earth: 1,
};

// ============================================
// Permanent Dojo upgrades (scrolls)
// ============================================

export const TD_DOJO_CATEGORIES = [
  "offense",
  "defense",
  "economy",
  "jutsu",
  "arts",
  "ultimate",
] as const;
export type TdDojoCategory = (typeof TD_DOJO_CATEGORIES)[number];

export const TD_DOJO = [
  "dmg",
  "rate",
  "crit",
  "critdmg",
  "range",
  "multishot",
  "ricochet",
  "hp",
  "regen",
  "block",
  "thorns",
  "lifesteal",
  "knockback",
  "ryo",
  "interest",
  "scrolls",
  "startryo",
  "speed",
  "jt_fire",
  "jt_lightning",
  "jt_water",
  "jt_wind",
  "jt_earth",
  "jt_cd",
  "st_slots",
  "st_power",
  "chakra",
  "seal_power",
  "blink",
  "substitution",
  "traps",
  "perk_choices",
  "perk_reroll",
  "ul_clones",
  "ul_tempest",
  "ul_amaterasu",
  "ul_tsukuyomi",
  "ul_cataclysm",
  "ul_auto",
] as const;
export type TdDojoUpgrade = (typeof TD_DOJO)[number];
export type TdDojoLevels = Partial<Record<TdDojoUpgrade, number>>;

export interface TdDojoInfo {
  name: string;
  description: string;
  category: TdDojoCategory;
  /** Scroll cost of level 1 and growth per level. */
  base: number;
  growth: number;
  max: number;
  /** Best wave needed before the first level can be bought. */
  unlockWave: number;
}

export const TD_DOJO_INFO: Record<TdDojoUpgrade, TdDojoInfo> = {
  dmg: {
    name: "Shuriken Mastery",
    description:
      "x1.05 damage per level, compounding. Every jutsu and sentry scales with it.",
    category: "offense",
    base: 4,
    growth: 1.14,
    max: 1000,
    unlockWave: 0,
  },
  rate: {
    name: "Quick Draw",
    description: "+3% attack speed per level.",
    category: "offense",
    base: 6,
    growth: 1.12,
    max: 100,
    unlockWave: 0,
  },
  crit: {
    name: "Vital Points",
    description: "+0.5% crit chance per level.",
    category: "offense",
    base: 8,
    growth: 1.1,
    max: 80,
    unlockWave: 5,
  },
  critdmg: {
    name: "Deadly Precision",
    description: "+10% crit damage per level.",
    category: "offense",
    base: 8,
    growth: 1.14,
    max: 300,
    unlockWave: 10,
  },
  range: {
    name: "Eagle Eye",
    description: "+0.05 range per level.",
    category: "offense",
    base: 10,
    growth: 1.12,
    max: 60,
    unlockWave: 5,
  },
  multishot: {
    name: "Shuriken Fan",
    description: "+1 extra target per throw.",
    category: "offense",
    base: 400,
    growth: 6,
    max: 4,
    unlockWave: 40,
  },
  ricochet: {
    name: "Ricochet Arts",
    description: "+1 bounce per shuriken.",
    category: "offense",
    base: 300,
    growth: 5,
    max: 5,
    unlockWave: 60,
  },
  hp: {
    name: "Iron Body",
    description: "x1.05 max health per level, compounding.",
    category: "defense",
    base: 4,
    growth: 1.14,
    max: 1000,
    unlockWave: 0,
  },
  regen: {
    name: "Healing Chakra",
    description: "+0.06% health regeneration per second per level.",
    category: "defense",
    base: 6,
    growth: 1.12,
    max: 100,
    unlockWave: 0,
  },
  block: {
    name: "Iron Skin",
    description: "+0.5% damage reduction per level.",
    category: "defense",
    base: 8,
    growth: 1.1,
    max: 100,
    unlockWave: 5,
  },
  thorns: {
    name: "Spiked Armor",
    description: "Melee attackers lose 0.2% of their max health per hit per level.",
    category: "defense",
    base: 20,
    growth: 1.12,
    max: 50,
    unlockWave: 20,
  },
  lifesteal: {
    name: "Leech Seal",
    description: "Heal 0.02% of damage dealt per level.",
    category: "defense",
    base: 20,
    growth: 1.12,
    max: 100,
    unlockWave: 30,
  },
  knockback: {
    name: "Heavy Hands",
    description: "+1% chance for shuriken to knock enemies back.",
    category: "defense",
    base: 12,
    growth: 1.14,
    max: 30,
    unlockWave: 10,
  },
  ryo: {
    name: "Merchant Ties",
    description: "x1.04 ryo per level, compounding.",
    category: "economy",
    base: 5,
    growth: 1.15,
    max: 300,
    unlockWave: 0,
  },
  interest: {
    name: "Moneylender",
    description: "+0.5% interest on banked ryo after each wave.",
    category: "economy",
    base: 25,
    growth: 1.2,
    max: 20,
    unlockWave: 15,
  },
  scrolls: {
    name: "Scroll Collector",
    description: "+1% scrolls earned per level.",
    category: "economy",
    base: 30,
    growth: 1.12,
    max: 150,
    unlockWave: 10,
  },
  startryo: {
    name: "War Chest",
    description: "Start every run with +5% more ryo per level.",
    category: "economy",
    base: 20,
    growth: 1.15,
    max: 40,
    unlockWave: 20,
  },
  speed: {
    name: "Time Dilation",
    description: "Unlocks faster game speeds: 1.5x, 2x, 3x, 4x.",
    category: "economy",
    base: 80,
    growth: 6,
    max: 4,
    unlockWave: 20,
  },
  jt_fire: {
    name: "Fire Release",
    description: "Unlocks Great Fireball; later levels x1.06 jutsu damage.",
    category: "jutsu",
    base: 30,
    growth: 1.15,
    max: 300,
    unlockWave: 3,
  },
  jt_lightning: {
    name: "Lightning Release",
    description: "Unlocks Lightning Chain; later levels x1.06 jutsu damage.",
    category: "jutsu",
    base: 80,
    growth: 1.15,
    max: 300,
    unlockWave: 15,
  },
  jt_water: {
    name: "Water Release",
    description: "Unlocks Tidal Wave; later levels x1.06 jutsu damage.",
    category: "jutsu",
    base: 150,
    growth: 1.15,
    max: 300,
    unlockWave: 30,
  },
  jt_wind: {
    name: "Wind Release",
    description: "Unlocks Vacuum Blades; later levels x1.06 jutsu damage.",
    category: "jutsu",
    base: 300,
    growth: 1.15,
    max: 300,
    unlockWave: 45,
  },
  jt_earth: {
    name: "Earth Release",
    description: "Unlocks Stone Spikes; later levels x1.06 jutsu damage.",
    category: "jutsu",
    base: 600,
    growth: 1.15,
    max: 300,
    unlockWave: 70,
  },
  jt_cd: {
    name: "Seal Speed",
    description: "-1% jutsu cooldowns per level.",
    category: "jutsu",
    base: 25,
    growth: 1.14,
    max: 40,
    unlockWave: 15,
  },
  st_slots: {
    name: "Sentry Posts",
    description: "Unlocks a sentry post around you (up to six).",
    category: "jutsu",
    base: 40,
    growth: 3.2,
    max: 6,
    unlockWave: 8,
  },
  st_power: {
    name: "Sentry Craft",
    description: "x1.05 sentry damage per level, compounding.",
    category: "jutsu",
    base: 10,
    growth: 1.14,
    max: 500,
    unlockWave: 8,
  },
  chakra: {
    name: "Chakra Pool",
    description: "+10 max chakra and +5% chakra regeneration per level.",
    category: "arts",
    base: 10,
    growth: 1.12,
    max: 50,
    unlockWave: 0,
  },
  seal_power: {
    name: "Seal Arts",
    description: "x1.06 seal art power per level, compounding.",
    category: "arts",
    base: 10,
    growth: 1.14,
    max: 400,
    unlockWave: 5,
  },
  blink: {
    name: "Body Flicker",
    description: "-5% blink cooldown per level.",
    category: "arts",
    base: 15,
    growth: 1.2,
    max: 12,
    unlockWave: 5,
  },
  substitution: {
    name: "Substitution",
    description: "+0.05s dodge window and x1.1 counter damage per level.",
    category: "arts",
    base: 15,
    growth: 1.12,
    max: 40,
    unlockWave: 10,
  },
  traps: {
    name: "Explosive Tags",
    description: "+1 tag charge per 5 levels and x1.08 tag damage per level.",
    category: "arts",
    base: 12,
    growth: 1.1,
    max: 80,
    unlockWave: 5,
  },
  perk_choices: {
    name: "Strategist",
    description: "+1 perk choice in every draft.",
    category: "arts",
    base: 250,
    growth: 6,
    max: 2,
    unlockWave: 60,
  },
  perk_reroll: {
    name: "Second Opinion",
    description: "+1 perk reroll per run.",
    category: "arts",
    base: 100,
    growth: 4,
    max: 3,
    unlockWave: 30,
  },
  ul_clones: {
    name: "Shadow Clone Army",
    description: "Unlocks the ultimate; later levels x1.1 power and -2% cooldown.",
    category: "ultimate",
    base: 200,
    growth: 1.12,
    max: 50,
    unlockWave: 25,
  },
  ul_tempest: {
    name: "Spiral Tempest",
    description: "Unlocks the ultimate; later levels x1.1 power and -2% cooldown.",
    category: "ultimate",
    base: 500,
    growth: 1.12,
    max: 50,
    unlockWave: 60,
  },
  ul_amaterasu: {
    name: "Amaterasu",
    description: "Unlocks the ultimate; later levels x1.1 power and -2% cooldown.",
    category: "ultimate",
    base: 1500,
    growth: 1.12,
    max: 50,
    unlockWave: 100,
  },
  ul_tsukuyomi: {
    name: "Tsukuyomi",
    description: "Unlocks the ultimate; later levels x1.1 power and -2% cooldown.",
    category: "ultimate",
    base: 4000,
    growth: 1.12,
    max: 50,
    unlockWave: 150,
  },
  ul_cataclysm: {
    name: "Chakra Cataclysm",
    description: "Unlocks the ultimate; later levels x1.1 power and -2% cooldown.",
    category: "ultimate",
    base: 12000,
    growth: 1.12,
    max: 50,
    unlockWave: 250,
  },
  ul_auto: {
    name: "Muscle Memory",
    description: "Lets ultimates cast themselves when ready (toggle in a run).",
    category: "ultimate",
    base: 3000,
    growth: 1,
    max: 1,
    unlockWave: 120,
  },
};

/** A boss closes every this many waves, followed by a perk draft. */
export const TD_BOSS_INTERVAL = 10;
/** First wave on which eras can bend the rules. */
export const TD_ERA_START_WAVE = 21;
/** Eras hold for blocks of this many waves. */
export const TD_ERA_INTERVAL = 10;
/** Every this many waves the boss is a titan. */
export const TD_TITAN_INTERVAL = 50;
/** Share of the best wave reached up to which checkpoints are offered. */
export const TD_CHECKPOINT_SHARE = 0.7;
/** Damage multiplier on the enemy the player has marked. */
export const TD_FOCUS_DAMAGE = 1.2;

/**
 * Waves a run may start from: just after each boss, up to `TD_CHECKPOINT_SHARE` of the
 * best wave reached. Starting on a boss wave would drop an unprepared ninja straight
 * into a boss fight.
 */
export const tdCheckpoints = (bestWave: number) => {
  const checkpoints = [1];
  for (
    let wave = TD_BOSS_INTERVAL + 1;
    wave <= Math.floor(bestWave * TD_CHECKPOINT_SHARE);
    wave += TD_BOSS_INTERVAL
  )
    checkpoints.push(wave);
  return checkpoints;
};
