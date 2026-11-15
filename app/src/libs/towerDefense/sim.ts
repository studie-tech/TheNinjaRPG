/**
 * Deterministic tower-defense simulation.
 *
 * A run is a seed, a signed configuration and an ordered log of player actions keyed by
 * tick. The browser steps the simulation live and records every accepted action; the
 * server replays the same log with `replayRun` to verify the result before paying out.
 * Both must take identical decisions, so this module:
 * - draws all randomness from the run's seeded generator, in a fixed order;
 * - uses only arithmetic, `Math.sqrt`, `Math.floor` and comparisons (see `rng.ts`);
 * - iterates arrays in insertion order and never reads wall-clock time;
 * - treats action coordinates as integers in hundredths of a unit.
 *
 * Actions apply at the tick they were recorded on, before that tick advances. A run
 * waiting on a perk draft stays on its tick until the draft is answered; drafts open at
 * the end of the tick (or action) that earned them.
 */

import {
  TD_CAMO_REVEAL_RANGE,
  TD_CHECKPOINT_OPENING_TICKS,
  TD_COORD_SCALE,
  TD_HERO_BASE,
  TD_HERO_ZONE,
  TD_LOOT_TICKS,
  TD_MAX_ALIVE,
  TD_OPENING_TICKS,
  TD_RIFT_SPAWN_RADIUS,
  TD_SEAL_GAP_TICKS,
  TD_SENTRY_RING,
  TD_SENTRY_SLOTS,
  TD_SHIELD_REFILL_TICKS,
  TD_SHURIKEN_SPEED,
  TD_SPAWN_RADIUS,
  TD_SPAWN_WINDOW_TICKS,
  TD_TICK_SECONDS,
  TD_TPS,
  TD_WAVE_TICKS,
  tdAffixCount,
  tdBossScrolls,
  tdEliteChance,
  tdPiercingShare,
  tdReferenceBounty,
  tdReferenceDamage,
  tdReferenceHealth,
  tdSpeedBonus,
  tdStartingDrafts,
  tdStartingRyo,
  tdWaveBonus,
  tdWaveCount,
  tdWaveScrolls,
} from "@/libs/towerDefense/balance";
import {
  TD_AFFIXES,
  TD_DOJO_INFO,
  TD_ELEMENTS,
  TD_ENEMIES,
  TD_ERA_INFO,
  TD_ERAS,
  TD_EVOLUTION_LEVEL,
  TD_JUTSU,
  TD_JUTSU_INFO,
  TD_PERK_INFO,
  TD_PERKS,
  TD_SEAL_ART_INFO,
  TD_SEAL_ARTS,
  TD_SENTRY_INFO,
  TD_SHOP,
  TD_SHOP_INFO,
  TD_SPEND_WEIGHTS,
  TD_ULTIMATE_INFO,
  TD_ULTIMATES,
  type TdAffix,
  type TdDojoLevels,
  type TdDojoUpgrade,
  type TdElement,
  type TdEnemyKind,
  type TdEra,
  type TdJutsu,
  type TdPerk,
  type TdSeal,
  type TdSealArt,
  type TdSentry,
  type TdShopItem,
  type TdUltimate,
} from "@/libs/towerDefense/content";
import { createRng, geometricCost, powi, type Rng } from "@/libs/towerDefense/rng";

// ============================================
// Types
// ============================================

export interface TdRunConfig {
  seed: string;
  startWave: number;
  /** Best wave before this run; gates seal arts. */
  bestWave: number;
  dojo: TdDojoLevels;
}

export const TD_TARGET_MODES = ["near", "strong", "weak", "fast", "support"] as const;
export type TdTargetMode = (typeof TD_TARGET_MODES)[number];

/** A recorded player action: `[tick, kind, ...arguments]`. */
export type TdAction =
  | [number, "buy", TdShopItem]
  | [number, "max", TdShopItem]
  | [number, "spend"]
  | [number, "build", number, TdSentry]
  | [number, "upgrade", number]
  | [number, "sell", number]
  | [number, "ult", TdUltimate, number, number]
  | [number, "perk", number]
  | [number, "reroll"]
  | [number, "aim", TdTargetMode]
  | [number, "focus", number]
  | [number, "blink", number, number]
  | [number, "sub"]
  | [number, "seal", TdSeal, number, number]
  | [number, "trap", number, number]
  | [number, "loot", number]
  | [number, "call"]
  | [number, "auto", 0 | 1]
  | [number, "quit"];
export type TdActionKind = TdAction[1];
/** An action before it is stamped with the tick it applies on. */
export type TdCommand = TdAction extends [number, ...infer Rest] ? Rest : never;

export interface TdEnemy {
  id: number;
  kind: TdEnemyKind;
  boss: boolean;
  titan: boolean;
  elite: boolean;
  affixes: TdAffix[];
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  shield: number;
  maxShield: number;
  armor: number;
  regen: number;
  damage: number;
  speed: number;
  attackTicks: number;
  attackReadyAt: number;
  range: number;
  stop: number;
  bounty: number;
  ward: TdElement | null;
  camo: boolean;
  ccImmune: boolean;
  canSplit: boolean;
  lastHitAt: number;
  chillUntil: number;
  chillPct: number;
  stunUntil: number;
  frozenUntil: number;
  burnUntil: number;
  burnDps: number;
  flameUntil: number;
  flameDps: number;
  dashUntil: number;
  moveReadyAt: number;
  summonReadyAt: number;
  phaseOffset: number;
  enraged: boolean;
  dead: boolean;
  size: number;
}

interface PendingHit {
  due: number;
  targetId: number;
  x: number;
  y: number;
  radius: number;
  damage: number;
  element: TdElement;
  crit: boolean;
  /** Shuriken effects travel with the projectile. */
  shuriken: boolean;
  bounces: number;
  hitIds: number[];
  burn: number;
  stun: number;
  chill: number;
  knockback: number;
  source: "hero" | "clone" | "sentry" | "jutsu" | "art" | "trap" | "ultimate" | "kill";
}

interface EnemyShot {
  due: number;
  damage: number;
  sourceId: number;
  telegraphed: boolean;
}

export interface TdTelegraph {
  id: number;
  x: number;
  y: number;
  radius: number;
  due: number;
  start: number;
  /** Damage to the hero if inside. */
  damage: number;
  /** Damage to enemies inside (meteors). */
  enemyDamage: number;
  sourceId: number;
  kind: "slam" | "meteor" | "cataclysm";
}

export interface TdLoot {
  id: number;
  x: number;
  y: number;
  kind: "ryo" | "chakra" | "scroll" | "rage";
  value: number;
  expires: number;
}

export interface TdSentrySlot {
  type: TdSentry;
  level: number;
  spent: number;
  readyAt: number;
}

export interface TdVortex {
  id: number;
  x: number;
  y: number;
  radius: number;
  until: number;
  damage: number;
  pull: number;
  kind: "tempest" | "cyclone";
}

export type TdEvent =
  | {
      type: "throw";
      from: "hero" | "clone" | "sentry";
      x: number;
      y: number;
      targetId: number;
      due: number;
      crit: boolean;
      element: TdElement;
    }
  | {
      type: "hit";
      targetId: number;
      x: number;
      y: number;
      amount: number;
      crit: boolean;
      element: TdElement;
      shield: boolean;
    }
  | {
      type: "kill";
      id: number;
      x: number;
      y: number;
      boss: boolean;
      elite: boolean;
      kind: TdEnemyKind;
    }
  | { type: "spawn"; id: number }
  | {
      type: "jutsu";
      jutsu: TdJutsu;
      x: number;
      y: number;
      radius: number;
      evolved: boolean;
      points: { x: number; y: number }[];
    }
  | { type: "art"; art: TdSealArt | "fizzle"; x: number; y: number; radius: number }
  | { type: "seal"; seal: TdSeal; count: number }
  | { type: "ultimate"; ultimate: TdUltimate; x: number; y: number }
  | { type: "heroHit"; amount: number; blocked: boolean }
  | { type: "substitution"; perfect: boolean; counterId: number }
  | { type: "blink"; fromX: number; fromY: number; x: number; y: number }
  | { type: "bossMove"; id: number; move: TdBossMove }
  | { type: "explosion"; x: number; y: number; radius: number; element: TdElement }
  | { type: "wave"; wave: number; boss: boolean; titan: boolean; eras: TdEra[] }
  | { type: "loot"; id: number; kind: TdLoot["kind"]; collected: boolean }
  | { type: "secondWind" }
  | { type: "gameOver" };

export const TD_BOSS_MOVES = [
  "slam",
  "summon",
  "roar",
  "charge",
  "barrage",
  "heal",
] as const;
export type TdBossMove = (typeof TD_BOSS_MOVES)[number];
const BOSS_MOVE_WAVE: Record<TdBossMove, number> = {
  slam: 10,
  summon: 20,
  roar: 30,
  charge: 40,
  barrage: 60,
  heal: 80,
};

export interface TdStats {
  damage: number;
  rate: number;
  range: number;
  crit: number;
  critMult: number;
  multishot: number;
  ricochet: number;
  maxHp: number;
  regen: number;
  block: number;
  thorns: number;
  lifesteal: number;
  knockback: number;
  ryoMult: number;
  interest: number;
  scrollMult: number;
  enemyHpMult: number;
  jutsuMult: number;
  jutsuCdMult: number;
  sentryMult: number;
  sealMult: number;
  maxChakra: number;
  chakraRegen: number;
  blinkTicks: number;
  subWindow: number;
  counterMult: number;
  trapCharges: number;
  trapMult: number;
  sentrySlots: number;
  perkChoices: number;
}

export interface TdState {
  config: TdRunConfig;
  rng: Rng;
  tick: number;
  wave: number;
  waveTick: number;
  eras: TdEra[];
  over: boolean;
  quit: boolean;
  hero: {
    x: number;
    y: number;
    hp: number;
    chakra: number;
    shotAcc: number;
    cloneAcc: number;
    shots: number;
    subUntil: number;
    subReadyAt: number;
    blinkReadyAt: number;
    domeUntil: number;
    rageUntil: number;
    counterUntil: number;
    silencedUntil: number;
    secondWindUsed: boolean;
    seals: TdSeal[];
    lastSealAt: number;
    trapCharges: number;
    trapReadyAt: number;
  };
  ryo: number;
  scrolls: number;
  kills: number;
  shop: Partial<Record<TdShopItem, number>>;
  perks: Partial<Record<TdPerk, number>>;
  offer: TdPerk[] | null;
  drafts: number;
  rerolls: number;
  jutsuReadyAt: Partial<Record<TdJutsu, number>>;
  ultReadyAt: Partial<Record<TdUltimate, number>>;
  autoUlt: boolean;
  clonesUntil: number;
  tsukuyomiUntil: number;
  vortices: TdVortex[];
  sentries: (TdSentrySlot | null)[];
  enemies: TdEnemy[];
  nextId: number;
  spawnQueue: {
    at: number;
    kind: TdEnemyKind;
    boss: boolean;
    titan: boolean;
    affixes: TdAffix[];
    camo: boolean;
  }[];
  hits: PendingHit[];
  shots: EnemyShot[];
  telegraphs: TdTelegraph[];
  traps: { id: number; x: number; y: number }[];
  loot: TdLoot[];
  focusId: number;
  aim: TdTargetMode;
  stats: TdStats;
  recordEvents: boolean;
  events: TdEvent[];
}

// ============================================
// Public helpers
// ============================================

const dojoLevel = (config: TdRunConfig, id: TdDojoUpgrade) =>
  Math.max(0, Math.min(TD_DOJO_INFO[id].max, Math.floor(config.dojo[id] ?? 0)));

/** Eras active for a wave; derived from the seed so upcoming blocks can be previewed. */
export const tdErasForWave = (seed: string, wave: number): TdEra[] => {
  if (wave < 21) return ["calm"];
  const block = Math.floor((wave - 1) / 10),
    blockStart = block * 10 + 1;
  const rng = createRng(`${seed}:era:${block}`);
  const pool = TD_ERAS.filter(
    (era) => era !== "calm" && TD_ERA_INFO[era].firstWave <= blockStart,
  );
  const count = wave > 450 ? 3 : wave > 300 ? 2 : 1;
  // Early blocks keep some calm stretches; later the arena is never quiet.
  if (count === 1 && wave <= 120 && rng.next() < 0.25) return ["calm"];
  const eras: TdEra[] = [];
  while (eras.length < count && eras.length < pool.length) {
    const era = rng.pick(pool);
    if (!eras.includes(era)) eras.push(era);
  }
  return eras;
};

/** Cost of the next level of a shop item in this run. */
export const tdShopCost = (state: TdState, item: TdShopItem) => {
  const info = TD_SHOP_INFO[item];
  return geometricCost(info.base, info.growth, state.shop[item] ?? 0);
};

/** Ryo to build a sentry (level 0) or to raise it to `level`. */
export const tdSentryCost = (type: TdSentry, level = 0) =>
  Math.floor(TD_SENTRY_INFO[type].cost * 2 * powi(1.6, level));

/** Scroll cost of the next Dojo level. */
export const tdDojoCost = (id: TdDojoUpgrade, level: number) => {
  const info = TD_DOJO_INFO[id];
  return geometricCost(info.base, info.growth, level);
};

/** Whether a Dojo level can be bought: unlocked by best wave and below max. */
export const tdDojoAvailable = (id: TdDojoUpgrade, level: number, bestWave: number) =>
  level < TD_DOJO_INFO[id].max && bestWave >= TD_DOJO_INFO[id].unlockWave;

export const tdSentryPosition = (slot: number) => {
  const offsets = [
    [1, 0],
    [0.5, SQRT3_2],
    [-0.5, SQRT3_2],
    [-1, 0],
    [-0.5, -SQRT3_2],
    [0.5, -SQRT3_2],
  ] as const;
  const [x, y] = offsets[slot % offsets.length] ?? [1, 0];
  return { x: x * TD_SENTRY_RING, y: y * TD_SENTRY_RING };
};

export const tdJutsuUnlocked = (config: TdRunConfig, jutsu: TdJutsu) =>
  dojoLevel(config, `jt_${jutsu}`) > 0;
export const tdUltimateUnlocked = (config: TdRunConfig, ultimate: TdUltimate) =>
  dojoLevel(config, `ul_${ultimate}`) > 0;
export const tdSealArtUnlocked = (config: TdRunConfig, art: TdSealArt) =>
  Math.max(config.bestWave, config.startWave) >= TD_SEAL_ART_INFO[art].firstWave;

/** Ticks until an ultimate is ready (0 when ready). */
export const tdUltimateCooldown = (state: TdState, ultimate: TdUltimate) =>
  Math.max(0, (state.ultReadyAt[ultimate] ?? 0) - state.tick);

/** A wave can be called early once everything it sent has been defeated. */
export const tdCanCallWave = (state: TdState) =>
  !state.over &&
  !state.offer &&
  (state.waveTick < 0 ||
    (state.waveTick >= 10 &&
      state.spawnQueue.length === 0 &&
      state.enemies.every((enemy) => enemy.dead)));

/** Scrolls a run ending now would pay out. */
export const tdRunPoints = (state: TdState) => Math.floor(state.scrolls);

// ============================================
// Creation
// ============================================

const SQRT3_2 = Math.sqrt(3) / 2;

export const createRun = (config: TdRunConfig, recordEvents = false): TdState => {
  const startWave = Math.max(1, Math.floor(config.startWave));
  const state: TdState = {
    config: { ...config, startWave },
    rng: createRng(`${config.seed}:run`),
    tick: 0,
    wave: startWave - 1,
    waveTick: 0,
    eras: ["calm"],
    over: false,
    quit: false,
    hero: {
      x: 0,
      y: 0,
      hp: 1,
      chakra: 0,
      shotAcc: 0,
      cloneAcc: 0,
      shots: 0,
      subUntil: -1,
      subReadyAt: 0,
      blinkReadyAt: 0,
      domeUntil: -1,
      rageUntil: -1,
      counterUntil: -1,
      silencedUntil: -1,
      secondWindUsed: false,
      seals: [],
      lastSealAt: -100,
      trapCharges: 0,
      trapReadyAt: 0,
    },
    ryo: tdStartingRyo(startWave, dojoLevel(config, "startryo")),
    scrolls: 0,
    kills: 0,
    shop: {},
    perks: {},
    offer: null,
    drafts: tdStartingDrafts(startWave),
    rerolls: dojoLevel(config, "perk_reroll"),
    jutsuReadyAt: {},
    ultReadyAt: {},
    autoUlt: false,
    clonesUntil: -1,
    tsukuyomiUntil: -1,
    vortices: [],
    sentries: Array.from({ length: TD_SENTRY_SLOTS }, () => null),
    enemies: [],
    nextId: 1,
    spawnQueue: [],
    hits: [],
    shots: [],
    telegraphs: [],
    traps: [],
    loot: [],
    focusId: 0,
    aim: "near",
    stats: undefined as unknown as TdStats,
    recordEvents,
    events: [],
  };
  state.stats = computeStats(state);
  state.hero.hp = state.stats.maxHp;
  state.hero.chakra = state.stats.maxChakra * 0.5;
  state.hero.trapCharges = state.stats.trapCharges;
  startWave_(state);
  // A quiet opening to spend starting ryo and answer drafts before the first enemies.
  const opening = startWave > 1 ? TD_CHECKPOINT_OPENING_TICKS : TD_OPENING_TICKS;
  for (const entry of state.spawnQueue) entry.at += opening;
  state.waveTick = -opening;
  openDraft(state);
  return state;
};

// ============================================
// Stats
// ============================================

const perk = (state: TdState, id: TdPerk) => state.perks[id] ?? 0;
const shop = (state: TdState, id: TdShopItem) => state.shop[id] ?? 0;

export const computeStats = (state: TdState): TdStats => {
  const d = (id: TdDojoUpgrade) => dojoLevel(state.config, id);
  const eras = state.eras;
  const glass = powi(1.9, perk(state, "glass_cannon"));
  const damage =
    TD_HERO_BASE.damage *
    powi(1.05, d("dmg")) *
    powi(1.08, shop(state, "damage")) *
    (1 + 0.3 * perk(state, "sharp_steel")) *
    glass;
  const rate = Math.min(
    15,
    TD_HERO_BASE.rate *
      (1 +
        0.03 * d("rate") +
        0.04 * shop(state, "rate") +
        0.2 * perk(state, "quick_hands") +
        0.5 * perk(state, "gale_hands")) *
      (perk(state, "fortress") ? 0.75 : 1),
  );
  const range = Math.max(
    2,
    (TD_HERO_BASE.range +
      0.05 * d("range") +
      0.1 * shop(state, "range") +
      0.8 * perk(state, "long_arm") -
      perk(state, "gale_hands")) *
      (eras.includes("fog") ? 0.75 : 1),
  );
  return {
    damage,
    rate,
    range,
    crit: Math.min(
      0.9,
      TD_HERO_BASE.crit +
        0.005 * d("crit") +
        0.01 * shop(state, "crit") +
        0.08 * perk(state, "keen_eye"),
    ),
    critMult:
      TD_HERO_BASE.critMult +
      0.1 * d("critdmg") +
      0.05 * shop(state, "crit") +
      0.5 * perk(state, "keen_eye"),
    multishot: d("multishot") + perk(state, "twin_throw"),
    ricochet: d("ricochet") + 2 * perk(state, "ricochet"),
    maxHp:
      TD_HERO_BASE.health *
      powi(1.05, d("hp")) *
      powi(1.08, shop(state, "health")) *
      (1 + 0.4 * perk(state, "iron_body")) *
      powi(0.6, perk(state, "glass_cannon")),
    regen:
      (TD_HERO_BASE.regen +
        0.0006 * d("regen") +
        0.001 * shop(state, "regen") +
        0.01 * perk(state, "second_breath")) *
      (perk(state, "berserker") ? 0.75 : 1) *
      (perk(state, "blood_pact") ? 0.5 : 1),
    block: Math.min(
      0.8,
      0.005 * d("block") +
        0.01 * shop(state, "block") +
        0.08 * perk(state, "stone_skin") +
        0.2 * perk(state, "fortress"),
    ),
    thorns: 0.002 * d("thorns"),
    lifesteal: 0.0002 * d("lifesteal") + 0.015 * perk(state, "blood_pact"),
    knockback: 0.01 * d("knockback"),
    ryoMult:
      powi(1.04, d("ryo")) *
      (1 +
        0.06 * shop(state, "ryo") +
        0.35 * perk(state, "fortune") +
        0.8 * perk(state, "greed")),
    interest: 0.005 * d("interest"),
    scrollMult: (1 + 0.01 * d("scrolls")) * (1 + 0.3 * perk(state, "greed")),
    enemyHpMult: 1 + 0.25 * perk(state, "greed"),
    jutsuMult: 1 + 0.3 * perk(state, "jutsu_focus"),
    jutsuCdMult: (1 - 0.01 * d("jt_cd")) * powi(0.88, perk(state, "fast_seals")),
    sentryMult: powi(1.05, d("st_power")) * (1 + 0.4 * perk(state, "engineer")),
    sealMult: powi(1.06, d("seal_power")),
    maxChakra: TD_HERO_BASE.chakra + 10 * d("chakra") + 50 * perk(state, "chakra_well"),
    chakraRegen:
      TD_HERO_BASE.chakraRegen *
      (1 + 0.05 * d("chakra") + 0.1 * shop(state, "chakra")) *
      (perk(state, "chakra_well") ? 2 : 1),
    blinkTicks: Math.max(
      10,
      Math.floor(TD_HERO_BASE.blinkTicks * (1 - 0.05 * d("blink"))),
    ),
    subWindow: TD_HERO_BASE.substitutionWindow + Math.floor(d("substitution") / 2),
    counterMult: 15 * powi(1.1, d("substitution")),
    trapCharges:
      TD_HERO_BASE.trapCharges +
      Math.floor(d("traps") / 5) +
      2 * perk(state, "trapper"),
    trapMult: powi(1.08, d("traps")) * (perk(state, "trapper") ? 2 : 1),
    sentrySlots: d("st_slots"),
    perkChoices: 3 + d("perk_choices"),
  };
};

const refreshStats = (state: TdState) => {
  const previous = state.stats.maxHp;
  state.stats = computeStats(state);
  if (state.stats.maxHp > previous) state.hero.hp += state.stats.maxHp - previous;
  state.hero.hp = Math.min(state.hero.hp, state.stats.maxHp);
  state.hero.chakra = Math.min(state.hero.chakra, state.stats.maxChakra);
};

const ultimatePower = (state: TdState, ultimate: TdUltimate) =>
  powi(1.1, Math.max(0, dojoLevel(state.config, `ul_${ultimate}`) - 1));
const ultimateCooldownTicks = (state: TdState, ultimate: TdUltimate) =>
  Math.floor(
    TD_ULTIMATE_INFO[ultimate].cooldown *
      TD_TPS *
      powi(0.98, Math.max(0, dojoLevel(state.config, `ul_${ultimate}`) - 1)),
  );

const jutsuLevel = (state: TdState, jutsu: TdJutsu) => shop(state, `jutsu_${jutsu}`);
const jutsuDamage = (state: TdState, jutsu: TdJutsu) =>
  state.stats.damage *
  TD_JUTSU_INFO[jutsu].power *
  state.stats.jutsuMult *
  powi(1.08, jutsuLevel(state, jutsu)) *
  powi(1.06, Math.max(0, dojoLevel(state.config, `jt_${jutsu}`) - 1));
const jutsuCooldownTicks = (state: TdState, jutsu: TdJutsu) =>
  Math.max(
    6,
    Math.floor(
      TD_JUTSU_INFO[jutsu].cooldown *
        TD_TPS *
        state.stats.jutsuCdMult *
        powi(0.98, Math.min(30, jutsuLevel(state, jutsu))),
    ),
  );
const evolved = (state: TdState, jutsu: TdJutsu) => perk(state, `evolve_${jutsu}`) > 0;

/** Damage multiplier the hero deals right now from temporary effects. */
const heroBoost = (state: TdState) => {
  let boost = 1;
  if (state.tick < state.hero.rageUntil) boost *= 2;
  if (state.tick < state.hero.counterUntil) boost *= 1.5;
  if (perk(state, "berserker"))
    boost *= 1 + 1.5 * (1 - state.hero.hp / state.stats.maxHp);
  return boost;
};

// ============================================
// Waves
// ============================================

const startWave_ = (state: TdState) => {
  const completed = state.wave;
  if (completed >= state.config.startWave && completed > 0) {
    state.scrolls += tdWaveScrolls(completed) * state.stats.scrollMult;
    state.ryo += Math.floor(tdWaveBonus(completed) * state.stats.ryoMult);
    if (state.stats.interest > 0) {
      const cap = 60 * tdWaveBonus(completed);
      state.ryo += Math.floor(Math.min(cap, state.ryo * state.stats.interest));
    }
    if (completed % 10 === 0) state.drafts += 1;
  }
  state.wave += 1;
  state.waveTick = 0;
  const wave = state.wave;
  state.eras = tdErasForWave(state.config.seed, wave);
  refreshStats(state);
  const eras = state.eras;
  const boss = wave % 10 === 0;
  const titan = wave % 50 === 0;
  let count = tdWaveCount(wave);
  if (eras.includes("swarm")) count *= 2;
  if (eras.includes("titans")) count = Math.ceil(count / 2);
  const unlocked = (Object.keys(TD_ENEMIES) as TdEnemyKind[]).filter(
    (kind) => TD_ENEMIES[kind].weight > 0 && TD_ENEMIES[kind].firstWave <= wave,
  );
  const weights = unlocked.map((kind) => {
    let weight = TD_ENEMIES[kind].weight;
    // Bandits thin out as the roster grows.
    if (kind === "grunt") weight = Math.max(2, weight - wave / 15);
    if (kind === "archer" && eras.includes("siege")) weight *= 3;
    return weight;
  });
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  for (let i = 0; i < count; i++) {
    let roll = state.rng.next() * totalWeight,
      kind: TdEnemyKind = "grunt";
    for (let k = 0; k < unlocked.length; k++) {
      roll -= weights[k] ?? 0;
      if (roll < 0) {
        kind = unlocked[k] ?? "grunt";
        break;
      }
    }
    const affixes =
      state.rng.next() < tdEliteChance(wave)
        ? rollAffixes(state, tdAffixCount(wave))
        : [];
    const at =
      state.tick + Math.floor((i * TD_SPAWN_WINDOW_TICKS) / Math.max(1, count));
    state.spawnQueue.push({
      at,
      kind,
      boss: false,
      titan: false,
      affixes,
      camo: eras.includes("fog") && i % 3 === 2,
    });
  }
  if (boss) {
    const affixes =
      wave >= 100 ? rollAffixes(state, Math.min(3, Math.floor(wave / 150) + 1)) : [];
    state.spawnQueue.push({
      at: state.tick + 40,
      kind: titan ? "titan" : "boss",
      boss: true,
      titan,
      affixes,
      camo: false,
    });
    // Late bosses bring company.
    if (wave >= 300)
      state.spawnQueue.push({
        at: state.tick + 60,
        kind: "boss",
        boss: true,
        titan: false,
        affixes: rollAffixes(state, 1),
        camo: false,
      });
  }
  state.spawnQueue.sort((a, b) => a.at - b.at);
  emit(state, { type: "wave", wave, boss, titan, eras: [...eras] });
};

const rollAffixes = (state: TdState, count: number) => {
  const affixes: TdAffix[] = [];
  while (affixes.length < count) {
    const affix = state.rng.pick(TD_AFFIXES);
    if (!affixes.includes(affix)) affixes.push(affix);
  }
  return affixes;
};

const spawnEnemy = (
  state: TdState,
  entry: {
    kind: TdEnemyKind;
    boss: boolean;
    titan: boolean;
    affixes: TdAffix[];
    camo: boolean;
  },
  position?: { x: number; y: number },
  scale = 1,
) => {
  const arch = TD_ENEMIES[entry.kind];
  const wave = Math.max(1, state.wave);
  const eras = state.eras;
  const elite = entry.affixes.length > 0 && !entry.boss;
  const has = (affix: TdAffix) => entry.affixes.includes(affix);
  let hpMult = state.stats.enemyHpMult * scale;
  if (eras.includes("swarm")) hpMult *= 0.45;
  if (eras.includes("titans")) hpMult *= 2.5;
  if (eras.includes("blitz")) hpMult *= 0.8;
  if (elite) hpMult *= 2.5;
  // Bosses beyond wave 100 grow a little faster than their escorts.
  if (entry.boss) hpMult *= 1 + Math.max(0, wave - 100) / 250;
  const maxHp = arch.hp * tdReferenceHealth(wave) * hpMult;
  let speed = arch.speed * tdSpeedBonus(wave);
  if (eras.includes("blitz")) speed *= 1.4;
  if (has("hasted")) speed *= 1.5;
  let direction = position ? null : state.rng.direction();
  const radius = eras.includes("rifts") ? TD_RIFT_SPAWN_RADIUS : TD_SPAWN_RADIUS;
  const size = arch.size * (elite ? 1.2 : 1) * (scale < 1 ? 0.8 : 1);
  const ranged = arch.range > 0;
  const stop = ranged
    ? arch.range +
      (eras.includes("siege") && entry.kind === "archer" ? 2 : 0) +
      state.rng.next()
    : 0.7 + state.rng.next() * 0.6 + size * 0.2;
  let ward: TdElement | null = null;
  if (has("warded") || eras.includes("elemental_storm"))
    ward = state.rng.pick(TD_ELEMENTS);
  const enemy: TdEnemy = {
    id: state.nextId++,
    kind: entry.kind,
    boss: entry.boss,
    titan: entry.titan,
    elite,
    affixes: entry.affixes,
    x: position ? position.x : (direction?.x ?? 1) * radius,
    y: position ? position.y : (direction?.y ?? 0) * radius,
    hp: maxHp,
    maxHp,
    shield: 0,
    maxShield: 0,
    armor:
      ((arch.armor ?? 0) +
        (eras.includes("iron_tide") ? 0.04 : 0) +
        (has("armored") ? 0.05 : 0)) *
      maxHp,
    regen:
      (arch.regen ?? 0) +
      (has("regenerating") ? 0.03 : 0) +
      (eras.includes("blood_moon") ? 0.015 : 0),
    damage: arch.damage * tdReferenceDamage(wave) * (elite ? 1.5 : 1) * scale,
    speed,
    attackTicks: Math.max(3, Math.floor(arch.attackEvery * TD_TPS)),
    attackReadyAt: 0,
    range: arch.range,
    stop,
    bounty: arch.bounty * tdReferenceBounty(wave) * (elite ? 4 : 1) * scale,
    ward,
    camo: !!arch.camo || entry.camo,
    ccImmune: !!arch.ccImmune || has("juggernaut") || eras.includes("titans"),
    canSplit: scale >= 1,
    lastHitAt: -100,
    chillUntil: -1,
    chillPct: 0,
    stunUntil: -1,
    frozenUntil: -1,
    burnUntil: -1,
    burnDps: 0,
    flameUntil: -1,
    flameDps: 0,
    dashUntil: -1,
    moveReadyAt: state.tick + 12,
    summonReadyAt: state.tick + 20,
    phaseOffset: state.rng.int(30),
    enraged: false,
    dead: false,
    size: entry.boss ? arch.size : size,
  };
  const shield = (arch.shield ?? 0) + (has("shielded") ? 1 : 0);
  enemy.maxShield = shield * maxHp;
  enemy.shield = enemy.maxShield;
  direction = null;
  state.enemies.push(enemy);
  emit(state, { type: "spawn", id: enemy.id });
  return enemy;
};

// ============================================
// Actions
// ============================================

const coord = (value: number) => Math.round(value) / TD_COORD_SCALE;
const clampToZone = (x: number, y: number, radius: number) => {
  const length = Math.sqrt(x * x + y * y);
  if (length <= radius) return { x, y };
  return { x: (x / length) * radius, y: (y / length) * radius };
};

/** Whether the run accepts combat input (not while a draft is open). */
const inCombat = (state: TdState) => !state.over && !state.offer;

/**
 * Apply an action at the current tick. Returns whether it changed the run; rejected
 * actions are not recorded by the client and are ignored identically on replay.
 */
export const applyAction = (state: TdState, action: TdAction): boolean => {
  if (state.over) return false;
  const tick = state.tick;
  switch (action[1]) {
    case "buy": {
      if (!buyItem(state, action[2])) return false;
      refreshStats(state);
      return true;
    }
    case "max": {
      let bought = 0;
      while (bought < 2000 && buyItem(state, action[2])) bought++;
      if (bought > 0) refreshStats(state);
      return bought > 0;
    }
    case "spend": {
      let bought = 0;
      for (; bought < 5000; bought++) {
        let best: TdShopItem | null = null,
          bestScore = Number.POSITIVE_INFINITY;
        for (const item of TD_SHOP) {
          const weight = TD_SPEND_WEIGHTS[item];
          if (!shopAvailable(state, item)) continue;
          const score = tdShopCost(state, item) / weight;
          if (score < bestScore) {
            best = item;
            bestScore = score;
          }
        }
        if (!best || !buyItem(state, best)) break;
      }
      if (bought > 0) refreshStats(state);
      return bought > 0;
    }
    case "build": {
      const [, , slot, type] = action;
      if (!TD_SENTRY_INFO[type] || !validSlot(state, slot) || state.sentries[slot])
        return false;
      const cost = tdSentryCost(type);
      if (state.ryo < cost) return false;
      state.ryo -= cost;
      state.sentries[slot] = { type, level: 0, spent: cost, readyAt: tick + 5 };
      return true;
    }
    case "upgrade": {
      const slot = action[2];
      const sentry = validSlot(state, slot) ? state.sentries[slot] : null;
      if (!sentry) return false;
      const cost = tdSentryCost(sentry.type, sentry.level + 1);
      if (state.ryo < cost) return false;
      state.ryo -= cost;
      sentry.level += 1;
      sentry.spent += cost;
      return true;
    }
    case "sell": {
      const slot = action[2];
      const sentry = validSlot(state, slot) ? state.sentries[slot] : null;
      if (!sentry) return false;
      state.ryo += Math.floor(sentry.spent * 0.5);
      state.sentries[slot] = null;
      return true;
    }
    case "aim": {
      if (!TD_TARGET_MODES.includes(action[2])) return false;
      state.aim = action[2];
      return true;
    }
    case "auto": {
      if (dojoLevel(state.config, "ul_auto") < 1) return false;
      state.autoUlt = action[2] === 1;
      return true;
    }
    case "perk": {
      const index = action[2];
      const choice = state.offer?.[index];
      if (!choice) return false;
      state.perks[choice] = perk(state, choice) + 1;
      state.offer = null;
      state.drafts = Math.max(0, state.drafts - 1);
      refreshStats(state);
      if (choice === "chakra_well") state.hero.chakra = state.stats.maxChakra;
      if (choice === "trapper") state.hero.trapCharges = state.stats.trapCharges;
      openDraft(state);
      return true;
    }
    case "reroll": {
      if (!state.offer || state.rerolls <= 0) return false;
      state.rerolls -= 1;
      state.offer = drawOffer(state);
      return true;
    }
    case "quit": {
      state.over = true;
      state.quit = true;
      emit(state, { type: "gameOver" });
      return true;
    }
  }
  if (!inCombat(state)) return false;
  switch (action[1]) {
    case "ult":
      return castUltimate(state, action[2], coord(action[3]), coord(action[4]));
    case "focus": {
      const target = state.enemies.find(
        (enemy) => enemy.id === action[2] && !enemy.dead,
      );
      if (!target) return false;
      state.focusId = target.id;
      return true;
    }
    case "blink": {
      if (tick < state.hero.blinkReadyAt) return false;
      const to = clampToZone(coord(action[2]), coord(action[3]), TD_HERO_ZONE);
      emit(state, {
        type: "blink",
        fromX: state.hero.x,
        fromY: state.hero.y,
        x: to.x,
        y: to.y,
      });
      state.hero.x = to.x;
      state.hero.y = to.y;
      state.hero.blinkReadyAt = tick + state.stats.blinkTicks;
      return true;
    }
    case "sub": {
      if (tick < state.hero.subReadyAt) return false;
      state.hero.subUntil = tick + state.stats.subWindow;
      state.hero.subReadyAt = tick + TD_HERO_BASE.substitutionTicks;
      return true;
    }
    case "seal":
      return castSeal(state, action[2], coord(action[3]), coord(action[4]));
    case "trap": {
      if (state.hero.trapCharges <= 0) return false;
      const at = clampToZone(coord(action[2]), coord(action[3]), TD_SPAWN_RADIUS - 2);
      state.hero.trapCharges -= 1;
      if (state.hero.trapReadyAt <= tick)
        state.hero.trapReadyAt = tick + TD_HERO_BASE.trapRechargeTicks;
      state.traps.push({ id: state.nextId++, x: at.x, y: at.y });
      return true;
    }
    case "loot": {
      const index = state.loot.findIndex((item) => item.id === action[2]);
      const item = state.loot[index];
      if (!item) return false;
      state.loot.splice(index, 1);
      collectLoot(state, item);
      return true;
    }
    case "call": {
      if (!tdCanCallWave(state)) return false;
      if (state.waveTick < 0) {
        // End the opening early: the first wave arrives now.
        const shift = -state.waveTick;
        for (const entry of state.spawnQueue) entry.at -= shift;
        state.waveTick = 0;
        return true;
      }
      const remaining = (TD_WAVE_TICKS - state.waveTick) / TD_WAVE_TICKS;
      state.ryo += Math.floor(
        tdWaveBonus(state.wave) * remaining * state.stats.ryoMult,
      );
      startWave_(state);
      openDraft(state);
      return true;
    }
  }
  return false;
};

const shopAvailable = (state: TdState, item: TdShopItem) => {
  const info = TD_SHOP_INFO[item];
  if (!info) return false;
  if (info.jutsu && !tdJutsuUnlocked(state.config, info.jutsu)) return false;
  return shop(state, item) < info.max;
};

/** Buy one level if available and affordable; the caller refreshes stats. */
const buyItem = (state: TdState, item: TdShopItem) => {
  if (!shopAvailable(state, item)) return false;
  const cost = tdShopCost(state, item);
  if (state.ryo < cost) return false;
  state.ryo -= cost;
  state.shop[item] = shop(state, item) + 1;
  return true;
};

const validSlot = (state: TdState, slot: number) =>
  Number.isInteger(slot) && slot >= 0 && slot < state.stats.sentrySlots;

const collectLoot = (state: TdState, item: TdLoot) => {
  switch (item.kind) {
    case "ryo":
      state.ryo += Math.floor(item.value);
      break;
    case "chakra":
      state.hero.chakra = Math.min(
        state.stats.maxChakra,
        state.hero.chakra + item.value,
      );
      break;
    case "scroll":
      state.scrolls += item.value * state.stats.scrollMult;
      break;
    case "rage":
      state.hero.rageUntil = state.tick + item.value;
      break;
  }
  emit(state, { type: "loot", id: item.id, kind: item.kind, collected: true });
};

// ============================================
// Perk drafts
// ============================================

const openDraft = (state: TdState) => {
  if (state.offer || state.drafts <= 0 || state.over) return;
  const offer = drawOffer(state);
  if (offer.length === 0) {
    state.drafts = 0;
    return;
  }
  state.offer = offer;
};

const drawOffer = (state: TdState): TdPerk[] => {
  const wave = Math.max(1, state.wave);
  const eligible = TD_PERKS.filter((id) => {
    const info = TD_PERK_INFO[id];
    if (info.firstWave > wave || perk(state, id) >= info.max) return false;
    if (info.jutsu)
      return (
        tdJutsuUnlocked(state.config, info.jutsu) &&
        jutsuLevel(state, info.jutsu) >= TD_EVOLUTION_LEVEL
      );
    return true;
  });
  const offer: TdPerk[] = [];
  const pool = [...eligible];
  while (offer.length < state.stats.perkChoices && pool.length > 0) {
    // Ready evolutions are three times as likely to show up.
    const weights = pool.map((id) => (TD_PERK_INFO[id].kind === "evolution" ? 3 : 1));
    let roll = state.rng.next() * weights.reduce((sum, weight) => sum + weight, 0);
    let index = 0;
    for (; index < pool.length - 1; index++) {
      roll -= weights[index] ?? 0;
      if (roll < 0) break;
    }
    const [chosen] = pool.splice(index, 1);
    if (chosen) offer.push(chosen);
  }
  return offer;
};

// ============================================
// Seal arts and ultimates
// ============================================

const castSeal = (state: TdState, seal: TdSeal, x: number, y: number) => {
  const hero = state.hero;
  if (state.tick - hero.lastSealAt > TD_SEAL_GAP_TICKS) hero.seals = [];
  hero.seals.push(seal);
  hero.lastSealAt = state.tick;
  emit(state, { type: "seal", seal, count: hero.seals.length });
  if (hero.seals.length < 3) return true;
  const sequence = hero.seals.join("-");
  hero.seals = [];
  const art = TD_SEAL_ARTS.find(
    (id) => TD_SEAL_ART_INFO[id].seals.join("-") === sequence,
  );
  const at = clampToZone(x, y, TD_SPAWN_RADIUS);
  if (
    !art ||
    !tdSealArtUnlocked(state.config, art) ||
    hero.chakra < TD_SEAL_ART_INFO[art].chakra
  ) {
    emit(state, { type: "art", art: "fizzle", x: at.x, y: at.y, radius: 0 });
    return true;
  }
  const info = TD_SEAL_ART_INFO[art];
  hero.chakra -= info.chakra;
  const power =
    state.stats.damage * heroBoost(state) * info.power * state.stats.sealMult;
  emit(state, { type: "art", art, x: at.x, y: at.y, radius: info.radius });
  switch (art) {
    case "dragon_flame":
      for (const enemy of enemiesWithin(state, at.x, at.y, info.radius)) {
        damageEnemy(state, enemy, power, "fire", { source: "art" });
        ignite(enemy, state.tick, 50, power * 0.4);
      }
      break;
    case "thunder_strike": {
      const target = strongestWithin(state, at.x, at.y, info.radius);
      if (target) {
        damageEnemy(state, target, power, "lightning", {
          source: "art",
          ignoreArmor: true,
        });
        stun(target, state.tick + 15);
        emit(state, {
          type: "explosion",
          x: target.x,
          y: target.y,
          radius: 0.8,
          element: "lightning",
        });
      }
      break;
    }
    case "water_prison":
      for (const enemy of enemiesWithin(state, at.x, at.y, info.radius)) {
        damageEnemy(state, enemy, power, "water", { source: "art" });
        if (!enemy.boss) enemy.frozenUntil = state.tick + 30;
      }
      break;
    case "cyclone":
      state.vortices.push({
        id: state.nextId++,
        x: at.x,
        y: at.y,
        radius: info.radius,
        until: state.tick + 30,
        damage: power,
        pull: 0.25,
        kind: "cyclone",
      });
      break;
    case "mystic_palm":
      hero.hp = Math.min(state.stats.maxHp, hero.hp + state.stats.maxHp * info.power);
      hero.silencedUntil = -1;
      break;
    case "earth_dome":
      hero.domeUntil = state.tick + 50;
      break;
  }
  return true;
};

const castUltimate = (state: TdState, ultimate: TdUltimate, x: number, y: number) => {
  if (!TD_ULTIMATE_INFO[ultimate] || !tdUltimateUnlocked(state.config, ultimate))
    return false;
  if (state.tick < (state.ultReadyAt[ultimate] ?? 0)) return false;
  const at = clampToZone(x, y, TD_SPAWN_RADIUS);
  const power = state.stats.damage * heroBoost(state) * ultimatePower(state, ultimate);
  state.ultReadyAt[ultimate] = state.tick + ultimateCooldownTicks(state, ultimate);
  emit(state, { type: "ultimate", ultimate, x: at.x, y: at.y });
  switch (ultimate) {
    case "clones":
      state.clonesUntil = state.tick + 100;
      break;
    case "tempest":
      state.vortices.push({
        id: state.nextId++,
        x: at.x,
        y: at.y,
        radius: 3.5,
        until: state.tick + 60,
        damage: power * 6,
        pull: 0.15,
        kind: "tempest",
      });
      break;
    case "amaterasu":
      for (const enemy of state.enemies) {
        if (enemy.dead) continue;
        enemy.flameUntil = state.tick + 50;
        enemy.flameDps = enemy.maxHp * (enemy.boss ? 0.006 : 0.03) + power * 5;
      }
      break;
    case "tsukuyomi":
      state.tsukuyomiUntil = state.tick + 50;
      break;
    case "cataclysm":
      state.telegraphs.push({
        id: state.nextId++,
        x: at.x,
        y: at.y,
        radius: 4,
        start: state.tick,
        due: state.tick + 10,
        damage: 0,
        enemyDamage: power * 150,
        sourceId: 0,
        kind: "cataclysm",
      });
      break;
  }
  return true;
};

// ============================================
// Damage
// ============================================

const emit = (state: TdState, event: TdEvent) => {
  if (state.recordEvents) state.events.push(event);
};

const distance = (ax: number, ay: number, bx: number, by: number) => {
  const dx = ax - bx,
    dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
};

const isPhased = (state: TdState, enemy: TdEnemy) =>
  TD_ENEMIES[enemy.kind].phase === true && (state.tick + enemy.phaseOffset) % 30 < 10;

const enemiesWithin = (state: TdState, x: number, y: number, radius: number) =>
  state.enemies.filter(
    (enemy) =>
      !enemy.dead && distance(enemy.x, enemy.y, x, y) <= radius + enemy.size * 0.3,
  );

const strongestWithin = (state: TdState, x: number, y: number, radius: number) => {
  let best: TdEnemy | undefined;
  for (const enemy of enemiesWithin(state, x, y, radius))
    if (!best || enemy.hp > best.hp) best = enemy;
  return best;
};

const sensorCovers = (state: TdState, enemy: TdEnemy) => {
  for (let slot = 0; slot < state.sentries.length; slot++) {
    const sentry = state.sentries[slot];
    if (sentry?.type !== "sensor") continue;
    const at = tdSentryPosition(slot);
    if (
      distance(at.x, at.y, enemy.x, enemy.y) <=
      TD_SENTRY_INFO.sensor.range + sentry.level * 0.25
    )
      return true;
  }
  return false;
};

const vulnerability = (state: TdState, enemy: TdEnemy) => {
  let multiplier = 1;
  if (state.tick < enemy.chillUntil) multiplier *= 1.2;
  if (state.tick < enemy.frozenUntil) multiplier *= 1.3;
  if (state.tick < state.tsukuyomiUntil) multiplier *= 1.5;
  if (enemy.id === state.focusId) multiplier *= 1.2;
  if (
    state.sentries.some((sentry) => sentry?.type === "sensor") &&
    sensorCovers(state, enemy)
  )
    multiplier *= 1.15;
  return multiplier;
};

/** Deal damage to an enemy through vulnerability, wards, shields and armor. */
const damageEnemy = (
  state: TdState,
  enemy: TdEnemy,
  raw: number,
  element: TdElement,
  options: {
    source: PendingHit["source"];
    crit?: boolean;
    ignoreArmor?: boolean;
    dot?: boolean;
  },
) => {
  if (enemy.dead || isPhased(state, enemy) || raw <= 0) return 0;
  let amount = raw * vulnerability(state, enemy);
  if (enemy.ward === element) amount *= 0.1;
  let shieldHit = false;
  if (!options.dot && enemy.shield > 0) {
    const shieldDamage = amount * (element === "lightning" ? 2 : 1);
    shieldHit = true;
    if (shieldDamage <= enemy.shield) {
      enemy.shield -= shieldDamage;
      amount = 0;
    } else {
      amount = (shieldDamage - enemy.shield) / (element === "lightning" ? 2 : 1);
      enemy.shield = 0;
    }
  }
  if (!options.dot && !options.ignoreArmor && element !== "lightning" && amount > 0)
    amount = Math.max(amount * 0.15, amount - enemy.armor);
  enemy.hp -= amount;
  enemy.lastHitAt = state.tick;
  if (state.stats.lifesteal > 0 && amount > 0) {
    const heal = Math.min(state.stats.maxHp * 0.02, amount * state.stats.lifesteal);
    state.hero.hp = Math.min(state.stats.maxHp, state.hero.hp + heal);
  }
  if (
    perk(state, "executioner") &&
    !enemy.boss &&
    enemy.hp > 0 &&
    enemy.hp < enemy.maxHp * 0.1
  )
    enemy.hp = 0;
  if (!options.dot)
    emit(state, {
      type: "hit",
      targetId: enemy.id,
      x: enemy.x,
      y: enemy.y,
      amount,
      crit: !!options.crit,
      element,
      shield: shieldHit && amount === 0,
    });
  return amount;
};

const ignite = (enemy: TdEnemy, tick: number, ticks: number, dps: number) => {
  enemy.burnUntil = Math.max(enemy.burnUntil, tick + ticks);
  enemy.burnDps = Math.max(enemy.burnDps, dps);
};
const chill = (enemy: TdEnemy, tick: number, ticks: number, pct: number) => {
  if (enemy.ccImmune) return;
  enemy.chillPct = tick < enemy.chillUntil ? Math.max(enemy.chillPct, pct) : pct;
  enemy.chillUntil = Math.max(enemy.chillUntil, tick + ticks);
};
const stun = (enemy: TdEnemy, until: number) => {
  if (enemy.ccImmune) return;
  enemy.stunUntil = Math.max(enemy.stunUntil, until);
};
const knockback = (state: TdState, enemy: TdEnemy, amount: number) => {
  if (enemy.ccImmune || amount <= 0) return;
  const scale = enemy.boss ? 0.3 : 1;
  const dx = enemy.x - state.hero.x,
    dy = enemy.y - state.hero.y;
  const length = Math.sqrt(dx * dx + dy * dy);
  if (length < 0.001) return;
  const pushed = Math.min(TD_SPAWN_RADIUS, length + amount * scale);
  enemy.x = state.hero.x + (dx / length) * pushed;
  enemy.y = state.hero.y + (dy / length) * pushed;
};

/** Damage the hero, honouring substitution, the earth dome and damage reduction. */
const damageHero = (
  state: TdState,
  raw: number,
  source: { enemy?: TdEnemy; telegraphed?: boolean; melee?: boolean },
) => {
  const hero = state.hero;
  if (state.over || raw <= 0) return;
  if (state.tick <= hero.subUntil) {
    hero.subUntil = -1;
    const perfect = !!source.telegraphed || !!source.enemy?.boss;
    const counter = source.enemy && !source.enemy.dead ? source.enemy : undefined;
    if (perfect) {
      hero.counterUntil = state.tick + 30;
      if (counter)
        damageEnemy(
          state,
          counter,
          state.stats.damage * state.stats.counterMult,
          "physical",
          { source: "hero", crit: true, ignoreArmor: true },
        );
    }
    emit(state, { type: "substitution", perfect, counterId: counter?.id ?? 0 });
    return;
  }
  let amount = raw * (1 - state.stats.block);
  if (state.tick < hero.domeUntil) amount *= 0.5;
  // Past wave 150 elite and boss hits pierce a share of max health, so piling up
  // health alone never makes the hero untouchable.
  if (source.enemy && (source.enemy.elite || source.enemy.boss))
    amount +=
      state.stats.maxHp * tdPiercingShare(state.wave) * (source.enemy.boss ? 2 : 1);
  hero.hp -= amount;
  emit(state, { type: "heroHit", amount, blocked: false });
  if (source.enemy && !source.enemy.dead) {
    const enemy = source.enemy;
    if (source.melee && state.stats.thorns > 0)
      damageEnemy(
        state,
        enemy,
        enemy.maxHp * state.stats.thorns * (enemy.boss ? 0.1 : 1),
        "physical",
        {
          source: "hero",
          dot: true,
        },
      );
    if (enemy.affixes.includes("vampiric") || state.eras.includes("blood_moon"))
      enemy.hp = Math.min(enemy.maxHp, enemy.hp + enemy.maxHp * 0.05);
  }
  if (hero.hp <= 0) {
    if (perk(state, "second_wind") && !hero.secondWindUsed) {
      hero.secondWindUsed = true;
      hero.hp = state.stats.maxHp * 0.5;
      emit(state, { type: "secondWind" });
      return;
    }
    hero.hp = 0;
    state.over = true;
    emit(state, { type: "gameOver" });
  }
};

// ============================================
// Targeting and attacks
// ============================================

const canSee = (state: TdState, enemy: TdEnemy, fromX: number, fromY: number) => {
  if (enemy.dead || isPhased(state, enemy)) return false;
  if (!enemy.camo || enemy.id === state.focusId) return true;
  return (
    distance(enemy.x, enemy.y, fromX, fromY) <= TD_CAMO_REVEAL_RANGE ||
    sensorCovers(state, enemy)
  );
};

const SUPPORT_KINDS: ReadonlySet<TdEnemyKind> = new Set([
  "medic",
  "summoner",
  "shieldbearer",
]);

/** Up to `count` distinct targets within range, ordered by the aim mode. */
const pickTargets = (
  state: TdState,
  fromX: number,
  fromY: number,
  range: number,
  count: number,
  mode: TdTargetMode,
) => {
  const candidates: { enemy: TdEnemy; dist: number; score: number }[] = [];
  for (const enemy of state.enemies) {
    if (!canSee(state, enemy, fromX, fromY)) continue;
    const dist = distance(enemy.x, enemy.y, fromX, fromY);
    if (dist > range + enemy.size * 0.3) continue;
    let score: number;
    switch (mode) {
      case "strong":
        score = -enemy.hp;
        break;
      case "weak":
        score = enemy.hp;
        break;
      case "fast":
        score = -enemy.speed;
        break;
      case "support":
        score = (SUPPORT_KINDS.has(enemy.kind) || enemy.boss ? 0 : 1000) + dist;
        break;
      default:
        score = dist;
    }
    if (enemy.id === state.focusId) score = Number.NEGATIVE_INFINITY;
    candidates.push({ enemy, dist, score });
  }
  candidates.sort((a, b) => a.score - b.score || a.enemy.id - b.enemy.id);
  return candidates.slice(0, count);
};

const throwShuriken = (
  state: TdState,
  fromX: number,
  fromY: number,
  target: TdEnemy,
  dist: number,
  damage: number,
  from: "hero" | "clone" | "sentry",
) => {
  const crit = state.rng.next() < state.stats.crit;
  const due = state.tick + Math.max(1, Math.round((dist / TD_SHURIKEN_SPEED) * TD_TPS));
  state.hits.push({
    due,
    targetId: target.id,
    x: target.x,
    y: target.y,
    radius: 0,
    damage: damage * (crit ? state.stats.critMult : 1),
    element: "physical",
    crit,
    shuriken: true,
    bounces: from === "sentry" ? 0 : state.stats.ricochet,
    hitIds: [],
    burn: perk(state, "burning_steel") ? 0.3 : 0,
    stun: 0,
    chill: perk(state, "frost_edge") ? 0.25 : 0,
    knockback: state.rng.next() < state.stats.knockback ? 0.6 : 0,
    source: from,
  });
  emit(state, {
    type: "throw",
    from,
    x: fromX,
    y: fromY,
    targetId: target.id,
    due,
    crit,
    element: "physical",
  });
};

const heroAttack = (state: TdState) => {
  const hero = state.hero;
  hero.shotAcc += state.stats.rate * TD_TICK_SECONDS;
  while (hero.shotAcc >= 1) {
    hero.shotAcc -= 1;
    const targets = pickTargets(
      state,
      hero.x,
      hero.y,
      state.stats.range,
      1 + state.stats.multishot,
      state.aim,
    );
    if (targets.length === 0) {
      // Hold the throw for the next enemy in range.
      hero.shotAcc = Math.min(hero.shotAcc + 1, 1);
      return;
    }
    const damage = state.stats.damage * heroBoost(state);
    for (const { enemy, dist } of targets)
      throwShuriken(state, hero.x, hero.y, enemy, dist, damage, "hero");
    hero.shots += 1;
    if (perk(state, "static_charge") && hero.shots % 8 === 0)
      chainLightning(state, hero.x, hero.y, 4, damage * 2, "hero");
  }
};

const clonesAttack = (state: TdState) => {
  if (state.tick >= state.clonesUntil) return;
  const hero = state.hero;
  state.hero.cloneAcc += 6 * state.stats.rate * TD_TICK_SECONDS;
  const damage =
    state.stats.damage * heroBoost(state) * 0.5 * ultimatePower(state, "clones");
  while (state.hero.cloneAcc >= 1) {
    state.hero.cloneAcc -= 1;
    const targets = pickTargets(
      state,
      hero.x,
      hero.y,
      state.stats.range + 2,
      6,
      "near",
    );
    if (targets.length === 0) {
      state.hero.cloneAcc = 0;
      return;
    }
    const choice = targets[state.rng.int(targets.length)];
    if (choice)
      throwShuriken(state, hero.x, hero.y, choice.enemy, choice.dist, damage, "clone");
  }
};

const chainLightning = (
  state: TdState,
  fromX: number,
  fromY: number,
  links: number,
  damage: number,
  source: PendingHit["source"],
  range = 6,
) => {
  const hit = new Set<number>();
  let x = fromX,
    y = fromY;
  const points: { x: number; y: number }[] = [{ x, y }];
  for (let link = 0; link < links; link++) {
    let best: TdEnemy | undefined,
      bestDist = link === 0 ? range : 3;
    for (const enemy of state.enemies) {
      if (hit.has(enemy.id) || !canSee(state, enemy, x, y)) continue;
      const dist = distance(enemy.x, enemy.y, x, y);
      if (dist <= bestDist) {
        best = enemy;
        bestDist = dist;
      }
    }
    if (!best) break;
    hit.add(best.id);
    damageEnemy(state, best, damage, "lightning", { source });
    x = best.x;
    y = best.y;
    points.push({ x, y });
  }
  return points;
};

/** Enemy with the most neighbours within `radius`, among those in `range`. */
const densest = (
  state: TdState,
  fromX: number,
  fromY: number,
  range: number,
  radius: number,
  exclude: ReadonlySet<number> = new Set(),
) => {
  let best: TdEnemy | undefined,
    bestCount = -1;
  const candidates = state.enemies.filter(
    (enemy) =>
      !enemy.dead &&
      !exclude.has(enemy.id) &&
      canSee(state, enemy, fromX, fromY) &&
      distance(enemy.x, enemy.y, fromX, fromY) <= range,
  );
  const sample = candidates.length > 60 ? candidates.slice(0, 60) : candidates;
  for (const enemy of sample) {
    let count = 0;
    for (const other of candidates)
      if (distance(enemy.x, enemy.y, other.x, other.y) <= radius) count++;
    if (count > bestCount || (count === bestCount && best && enemy.hp > best.hp)) {
      best = enemy;
      bestCount = count;
    }
  }
  return best;
};

const castJutsu = (state: TdState) => {
  if (state.tick < state.hero.silencedUntil) return;
  const hero = state.hero;
  for (const jutsu of TD_JUTSU) {
    if (!tdJutsuUnlocked(state.config, jutsu)) continue;
    if (state.tick < (state.jutsuReadyAt[jutsu] ?? 0)) continue;
    const info = TD_JUTSU_INFO[jutsu];
    const damage = jutsuDamage(state, jutsu) * heroBoost(state);
    const isEvolved = evolved(state, jutsu);
    const castRange = state.stats.range + 1.5;
    let cast = false;
    switch (jutsu) {
      case "fire": {
        const used = new Set<number>();
        const points: { x: number; y: number }[] = [];
        for (let i = 0; i < (isEvolved ? 5 : 1); i++) {
          const target = densest(state, hero.x, hero.y, castRange, info.radius, used);
          if (!target) break;
          used.add(target.id);
          const dist = distance(target.x, target.y, hero.x, hero.y);
          state.hits.push(
            areaHit(state, target.x, target.y, info.radius, damage, "fire", "jutsu", {
              due: state.tick + Math.max(1, Math.round((dist / 8) * TD_TPS)),
              burn: 0.3,
            }),
          );
          points.push({ x: target.x, y: target.y });
        }
        if (points.length > 0) {
          cast = true;
          const [first] = points;
          emit(state, {
            type: "jutsu",
            jutsu,
            x: first?.x ?? 0,
            y: first?.y ?? 0,
            radius: info.radius,
            evolved: isEvolved,
            points,
          });
        }
        break;
      }
      case "lightning": {
        const links = 4 + Math.floor(jutsuLevel(state, "lightning") / 3);
        const points = chainLightning(
          state,
          hero.x,
          hero.y,
          links,
          damage,
          "jutsu",
          castRange,
        );
        if (points.length > 1) {
          cast = true;
          if (isEvolved)
            for (const enemy of state.enemies)
              if (!enemy.dead)
                damageEnemy(state, enemy, damage * 0.6, "lightning", {
                  source: "jutsu",
                });
          emit(state, {
            type: "jutsu",
            jutsu,
            x: hero.x,
            y: hero.y,
            radius: 0,
            evolved: isEvolved,
            points,
          });
        }
        break;
      }
      case "water": {
        const targets = enemiesWithin(state, hero.x, hero.y, info.radius);
        if (targets.length > 0) {
          cast = true;
          for (const enemy of targets) {
            damageEnemy(state, enemy, damage, "water", { source: "jutsu" });
            chill(enemy, state.tick, 30, 0.45);
            if (isEvolved && !enemy.ccImmune)
              enemy.frozenUntil = Math.max(enemy.frozenUntil, state.tick + 15);
          }
          emit(state, {
            type: "jutsu",
            jutsu,
            x: hero.x,
            y: hero.y,
            radius: info.radius,
            evolved: isEvolved,
            points: [],
          });
        }
        break;
      }
      case "wind": {
        const [primary] = pickTargets(state, hero.x, hero.y, castRange, 1, "near");
        if (primary) {
          cast = true;
          const dx = primary.enemy.x - hero.x,
            dy = primary.enemy.y - hero.y;
          const length = Math.sqrt(dx * dx + dy * dy) || 1;
          const directions = [{ x: dx / length, y: dy / length }];
          if (isEvolved) {
            const base = directions[0] ?? { x: 1, y: 0 };
            directions.push(
              {
                x: base.x * -0.5 - base.y * SQRT3_2,
                y: base.x * SQRT3_2 + base.y * -0.5,
              },
              {
                x: base.x * -0.5 + base.y * SQRT3_2,
                y: -base.x * SQRT3_2 + base.y * -0.5,
              },
            );
          }
          const points: { x: number; y: number }[] = [];
          for (const direction of directions) {
            for (const enemy of state.enemies) {
              if (enemy.dead) continue;
              const ex = enemy.x - hero.x,
                ey = enemy.y - hero.y;
              const along = ex * direction.x + ey * direction.y;
              if (along < 0 || along > info.radius) continue;
              const across = Math.abs(ex * direction.y - ey * direction.x);
              if (across > 0.7 + enemy.size * 0.3) continue;
              damageEnemy(state, enemy, damage, "wind", { source: "jutsu" });
              if (!isEvolved) knockback(state, enemy, 0.5);
            }
            points.push({
              x: hero.x + direction.x * info.radius,
              y: hero.y + direction.y * info.radius,
            });
          }
          emit(state, {
            type: "jutsu",
            jutsu,
            x: hero.x,
            y: hero.y,
            radius: info.radius,
            evolved: isEvolved,
            points,
          });
        }
        break;
      }
      case "earth": {
        const targets = enemiesWithin(state, hero.x, hero.y, info.radius);
        if (targets.length > 0) {
          cast = true;
          const stunTicks = isEvolved ? 20 : 10;
          for (const enemy of targets) {
            damageEnemy(state, enemy, damage, "earth", { source: "jutsu" });
            stun(enemy, state.tick + stunTicks);
            knockback(state, enemy, 1.5);
          }
          if (isEvolved)
            for (const [delay, radius] of [
              [3, 5],
              [6, 7],
            ] as const)
              state.hits.push(
                areaHit(state, hero.x, hero.y, radius, damage, "earth", "jutsu", {
                  due: state.tick + delay,
                  stun: stunTicks,
                }),
              );
          emit(state, {
            type: "jutsu",
            jutsu,
            x: hero.x,
            y: hero.y,
            radius: info.radius,
            evolved: isEvolved,
            points: [],
          });
        }
        break;
      }
    }
    if (cast) state.jutsuReadyAt[jutsu] = state.tick + jutsuCooldownTicks(state, jutsu);
  }
};

const areaHit = (
  state: TdState,
  x: number,
  y: number,
  radius: number,
  damage: number,
  element: TdElement,
  source: PendingHit["source"],
  extra: Partial<PendingHit> = {},
): PendingHit => ({
  due: state.tick + 1,
  targetId: 0,
  x,
  y,
  radius,
  damage,
  element,
  crit: false,
  shuriken: false,
  bounces: 0,
  hitIds: [],
  burn: 0,
  stun: 0,
  chill: 0,
  knockback: 0,
  source,
  ...extra,
});

const sentriesAttack = (state: TdState) => {
  if (state.tick < state.hero.silencedUntil) return;
  for (let slot = 0; slot < state.sentries.length; slot++) {
    const sentry = state.sentries[slot];
    if (!sentry || slot >= state.stats.sentrySlots || state.tick < sentry.readyAt)
      continue;
    const info = TD_SENTRY_INFO[sentry.type];
    if (sentry.type === "sensor") continue;
    const at = tdSentryPosition(slot);
    const range = info.range + sentry.level * 0.25;
    const damage =
      state.stats.damage *
      info.power *
      state.stats.sentryMult *
      powi(1.15, sentry.level);
    let fired = false;
    switch (sentry.type) {
      case "kunai": {
        const [target] = pickTargets(state, at.x, at.y, range, 1, state.aim);
        if (target) {
          fired = true;
          throwShuriken(state, at.x, at.y, target.enemy, target.dist, damage, "sentry");
        }
        break;
      }
      case "mortar": {
        const target = densest(state, at.x, at.y, range, 1.2);
        if (target) {
          fired = true;
          const dist = distance(at.x, at.y, target.x, target.y);
          state.hits.push(
            areaHit(state, target.x, target.y, 1.2, damage, "fire", "sentry", {
              due: state.tick + Math.max(2, Math.round((dist / 6) * TD_TPS)),
            }),
          );
          emit(state, {
            type: "throw",
            from: "sentry",
            x: at.x,
            y: at.y,
            targetId: target.id,
            due: state.tick + Math.max(2, Math.round((dist / 6) * TD_TPS)),
            crit: false,
            element: "fire",
          });
        }
        break;
      }
      case "rod": {
        const points = chainLightning(
          state,
          at.x,
          at.y,
          3 + Math.floor(sentry.level / 4),
          damage,
          "sentry",
          range,
        );
        if (points.length > 1) {
          fired = true;
          emit(state, {
            type: "jutsu",
            jutsu: "lightning",
            x: at.x,
            y: at.y,
            radius: 0,
            evolved: false,
            points,
          });
        }
        break;
      }
      case "frost": {
        const targets = enemiesWithin(state, at.x, at.y, range);
        if (targets.length > 0) {
          fired = true;
          for (const enemy of targets) {
            damageEnemy(state, enemy, damage, "water", { source: "sentry" });
            chill(enemy, state.tick, 15, 0.3);
          }
        }
        break;
      }
    }
    if (fired)
      sentry.readyAt = state.tick + Math.max(2, Math.floor(info.attackEvery * TD_TPS));
  }
};

// ============================================
// Tick
// ============================================

/** Advance the run by one tick unless it is over or waiting on a perk draft. */
export const stepRun = (state: TdState) => {
  if (state.over || state.offer) return;
  state.tick += 1;
  state.waveTick += 1;
  const tick = state.tick;
  if (state.waveTick >= TD_WAVE_TICKS) startWave_(state);
  spawnDue(state);
  heroUpkeep(state);
  updateVortices(state);
  updateEnemies(state);
  if (state.over) return;
  heroAttack(state);
  clonesAttack(state);
  castJutsu(state);
  sentriesAttack(state);
  autoCastUltimates(state);
  resolveHits(state);
  resolveShots(state);
  resolveTelegraphs(state);
  resolveTraps(state);
  if (state.eras.includes("meteor_shower") && tick % 15 === 0) dropMeteor(state);
  cleanupDead(state);
  state.loot = state.loot.filter((item) => {
    if (item.expires > tick) return true;
    emit(state, { type: "loot", id: item.id, kind: item.kind, collected: false });
    return false;
  });
  if (state.focusId && !state.enemies.some((enemy) => enemy.id === state.focusId))
    state.focusId = 0;
  // Drafts open at the end of the tick that earned them, so an answer recorded on this
  // tick finds the same open draft when replayed.
  openDraft(state);
};

const spawnDue = (state: TdState) => {
  let alive = 0;
  for (const enemy of state.enemies) if (!enemy.dead) alive++;
  while (state.spawnQueue.length > 0 && alive < TD_MAX_ALIVE) {
    const next = state.spawnQueue[0];
    if (!next || next.at > state.tick) break;
    state.spawnQueue.shift();
    spawnEnemy(state, next);
    alive++;
  }
};

const heroUpkeep = (state: TdState) => {
  const hero = state.hero,
    stats = state.stats;
  hero.hp = Math.min(
    stats.maxHp,
    hero.hp + stats.maxHp * stats.regen * TD_TICK_SECONDS,
  );
  hero.chakra = Math.min(
    stats.maxChakra,
    hero.chakra + stats.chakraRegen * TD_TICK_SECONDS,
  );
  if (hero.trapCharges < stats.trapCharges && state.tick >= hero.trapReadyAt) {
    hero.trapCharges += 1;
    hero.trapReadyAt = state.tick + TD_HERO_BASE.trapRechargeTicks;
  }
};

const updateVortices = (state: TdState) => {
  state.vortices = state.vortices.filter((vortex) => vortex.until > state.tick);
  for (const vortex of state.vortices) {
    const pulse = state.tick % 3 === 0;
    for (const enemy of enemiesWithin(state, vortex.x, vortex.y, vortex.radius)) {
      if (!enemy.ccImmune || vortex.kind === "tempest") {
        const dx = vortex.x - enemy.x,
          dy = vortex.y - enemy.y;
        const length = Math.sqrt(dx * dx + dy * dy);
        if (length > 0.2) {
          const step = Math.min(length, vortex.pull * (enemy.boss ? 0.3 : 1));
          enemy.x += (dx / length) * step;
          enemy.y += (dy / length) * step;
        }
      }
      if (pulse)
        damageEnemy(state, enemy, vortex.damage, "wind", {
          source: vortex.kind === "tempest" ? "ultimate" : "art",
        });
    }
  }
};

const updateEnemies = (state: TdState) => {
  const tick = state.tick,
    hero = state.hero;
  const frozenWorld = tick < state.tsukuyomiUntil;
  for (const enemy of state.enemies) {
    if (enemy.dead) continue;
    const arch = TD_ENEMIES[enemy.kind];
    // Damage over time and healing
    const burning = tick < enemy.burnUntil || tick < enemy.flameUntil;
    if (tick < enemy.burnUntil)
      damageEnemy(state, enemy, enemy.burnDps * TD_TICK_SECONDS, "fire", {
        source: "jutsu",
        dot: true,
      });
    if (tick < enemy.flameUntil)
      damageEnemy(state, enemy, enemy.flameDps * TD_TICK_SECONDS, "fire", {
        source: "ultimate",
        dot: true,
      });
    if (!burning && enemy.regen > 0 && enemy.hp > 0)
      enemy.hp = Math.min(
        enemy.maxHp,
        enemy.hp + enemy.maxHp * enemy.regen * TD_TICK_SECONDS,
      );
    if (
      enemy.maxShield > 0 &&
      enemy.shield < enemy.maxShield &&
      tick - enemy.lastHitAt >= TD_SHIELD_REFILL_TICKS
    )
      enemy.shield = enemy.maxShield;
    if (enemy.hp <= 0) continue;
    if (arch.heal && tick % 10 === 0)
      for (const ally of enemiesWithin(state, enemy.x, enemy.y, arch.heal.radius))
        if (ally.id !== enemy.id && tick >= ally.burnUntil && tick >= ally.flameUntil)
          ally.hp = Math.min(ally.maxHp, ally.hp + ally.maxHp * arch.heal.pct);
    if (frozenWorld || tick < enemy.stunUntil || tick < enemy.frozenUntil) continue;
    // Bosses and berserkers escalate
    const lowHealth = enemy.hp < enemy.maxHp * 0.3;
    if (
      !enemy.enraged &&
      lowHealth &&
      (enemy.titan || (enemy.boss && state.wave >= 100))
    ) {
      enemy.enraged = true;
      enemy.speed *= 1.5;
      enemy.damage *= 1.5;
    }
    const berserk = enemy.affixes.includes("berserk") && enemy.hp < enemy.maxHp * 0.5;
    if (enemy.boss && tick >= enemy.moveReadyAt) bossMove(state, enemy);
    if (arch.summon && tick >= enemy.summonReadyAt) {
      enemy.summonReadyAt = tick + arch.summon.everySeconds * TD_TPS;
      for (let i = 0; i < arch.summon.count; i++)
        spawnEnemy(
          state,
          { kind: "grunt", boss: false, titan: false, affixes: [], camo: false },
          {
            x: enemy.x + (state.rng.next() - 0.5),
            y: enemy.y + (state.rng.next() - 0.5),
          },
          0.6,
        );
    }
    // Movement toward the hero
    const dx = hero.x - enemy.x,
      dy = hero.y - enemy.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > enemy.stop) {
      let speed = enemy.speed * (berserk ? 1.4 : 1);
      if (tick < enemy.chillUntil) speed *= 1 - enemy.chillPct;
      if (tick < enemy.dashUntil) speed *= 5;
      const step = Math.min(dist - enemy.stop, speed * TD_TICK_SECONDS);
      enemy.x += (dx / dist) * step;
      enemy.y += (dy / dist) * step;
      continue;
    }
    // Attacks
    if (arch.explode) {
      damageHero(state, enemy.damage * arch.explode, { enemy, melee: true });
      emit(state, {
        type: "explosion",
        x: enemy.x,
        y: enemy.y,
        radius: 1.2,
        element: "fire",
      });
      enemy.hp = 0;
      enemy.bounty *= 0.5;
      continue;
    }
    if (tick < enemy.attackReadyAt) continue;
    enemy.attackReadyAt = tick + Math.floor(enemy.attackTicks / (berserk ? 1.5 : 1));
    const damage = enemy.damage * (berserk ? 1.5 : 1);
    if (enemy.range > 0)
      state.shots.push({
        due: tick + Math.max(1, Math.round((dist / 7) * TD_TPS)),
        damage,
        sourceId: enemy.id,
        telegraphed: false,
      });
    else damageHero(state, damage, { enemy, melee: true });
    if (state.over) return;
  }
};

const bossMove = (state: TdState, boss: TdEnemy) => {
  const moves = TD_BOSS_MOVES.filter(
    (move) => boss.titan || BOSS_MOVE_WAVE[move] <= state.wave,
  );
  const move = state.rng.pick(moves);
  const cooldown =
    Math.max(25, 60 - Math.floor(state.wave / 20)) * (boss.enraged ? 0.5 : 1);
  boss.moveReadyAt = state.tick + Math.floor(cooldown);
  emit(state, { type: "bossMove", id: boss.id, move });
  switch (move) {
    case "slam":
      state.telegraphs.push({
        id: state.nextId++,
        x: state.hero.x,
        y: state.hero.y,
        radius: 2.2,
        start: state.tick,
        due: state.tick + 15,
        damage: boss.damage * 4,
        enemyDamage: 0,
        sourceId: boss.id,
        kind: "slam",
      });
      break;
    case "summon":
      for (let i = 0; i < 3 + Math.floor(state.wave / 100); i++)
        spawnEnemy(
          state,
          { kind: "grunt", boss: false, titan: false, affixes: [], camo: false },
          {
            x: boss.x + (state.rng.next() - 0.5) * 2,
            y: boss.y + (state.rng.next() - 0.5) * 2,
          },
          0.8,
        );
      break;
    case "roar":
      state.hero.silencedUntil = state.tick + 25;
      break;
    case "charge":
      boss.dashUntil = state.tick + 10;
      break;
    case "barrage":
      for (let i = 0; i < 5; i++)
        state.shots.push({
          due: state.tick + 6 + i * 3,
          damage: boss.damage * 0.8,
          sourceId: boss.id,
          telegraphed: true,
        });
      break;
    case "heal":
      if (state.tick >= boss.burnUntil && state.tick >= boss.flameUntil)
        boss.hp = Math.min(boss.maxHp, boss.hp + boss.maxHp * 0.08);
      break;
  }
};

const autoCastUltimates = (state: TdState) => {
  if (!state.autoUlt || state.enemies.length === 0) return;
  for (const ultimate of TD_ULTIMATES) {
    if (!tdUltimateUnlocked(state.config, ultimate)) continue;
    if (state.tick < (state.ultReadyAt[ultimate] ?? 0)) continue;
    const target = densest(state, state.hero.x, state.hero.y, TD_SPAWN_RADIUS, 3.5);
    if (!target) return;
    castUltimate(
      state,
      ultimate,
      Math.round(target.x * TD_COORD_SCALE),
      Math.round(target.y * TD_COORD_SCALE),
    );
  }
};

const resolveHits = (state: TdState) => {
  if (state.hits.length === 0) return;
  const due: PendingHit[] = [],
    later: PendingHit[] = [];
  for (const hit of state.hits) (hit.due <= state.tick ? due : later).push(hit);
  state.hits = later;
  for (const hit of due) {
    if (hit.radius > 0) {
      for (const enemy of enemiesWithin(state, hit.x, hit.y, hit.radius)) {
        damageEnemy(state, enemy, hit.damage, hit.element, {
          source: hit.source,
          crit: hit.crit,
        });
        if (hit.burn > 0) ignite(enemy, state.tick, 30, hit.damage * hit.burn);
        if (hit.stun > 0) stun(enemy, state.tick + hit.stun);
        if (hit.knockback > 0) knockback(state, enemy, hit.knockback);
      }
      emit(state, {
        type: "explosion",
        x: hit.x,
        y: hit.y,
        radius: hit.radius,
        element: hit.element,
      });
      continue;
    }
    const target = state.enemies.find((enemy) => enemy.id === hit.targetId);
    if (!target || target.dead) continue;
    damageEnemy(state, target, hit.damage, hit.element, {
      source: hit.source,
      crit: hit.crit,
    });
    if (hit.burn > 0) ignite(target, state.tick, 30, hit.damage * hit.burn);
    if (hit.chill > 0) chill(target, state.tick, 20, hit.chill);
    if (hit.knockback > 0) knockback(state, target, hit.knockback);
    if (hit.bounces > 0) {
      const visited = [...hit.hitIds, target.id];
      let next: TdEnemy | undefined,
        nextDist = 3;
      for (const enemy of state.enemies) {
        if (visited.includes(enemy.id) || !canSee(state, enemy, target.x, target.y))
          continue;
        const dist = distance(enemy.x, enemy.y, target.x, target.y);
        if (dist < nextDist) {
          next = enemy;
          nextDist = dist;
        }
      }
      if (next) {
        const nextDue =
          state.tick + Math.max(1, Math.round((nextDist / TD_SHURIKEN_SPEED) * TD_TPS));
        state.hits.push({
          ...hit,
          due: nextDue,
          targetId: next.id,
          damage: hit.damage * 0.8,
          bounces: hit.bounces - 1,
          hitIds: visited,
          knockback: 0,
        });
        emit(state, {
          type: "throw",
          from: "clone",
          x: target.x,
          y: target.y,
          targetId: next.id,
          due: nextDue,
          crit: hit.crit,
          element: "physical",
        });
      }
    }
  }
};

const resolveShots = (state: TdState) => {
  if (state.shots.length === 0) return;
  const remaining: EnemyShot[] = [];
  for (const shot of state.shots) {
    if (shot.due > state.tick) {
      remaining.push(shot);
      continue;
    }
    const source = state.enemies.find((enemy) => enemy.id === shot.sourceId);
    damageHero(state, shot.damage, { enemy: source, telegraphed: shot.telegraphed });
    if (state.over) break;
  }
  state.shots = state.over ? [] : remaining;
};

const resolveTelegraphs = (state: TdState) => {
  if (state.telegraphs.length === 0) return;
  const remaining: TdTelegraph[] = [];
  for (const telegraph of state.telegraphs) {
    if (telegraph.due > state.tick) {
      remaining.push(telegraph);
      continue;
    }
    const element: TdElement = telegraph.kind === "slam" ? "earth" : "fire";
    emit(state, {
      type: "explosion",
      x: telegraph.x,
      y: telegraph.y,
      radius: telegraph.radius,
      element,
    });
    if (telegraph.enemyDamage > 0) {
      for (const enemy of enemiesWithin(
        state,
        telegraph.x,
        telegraph.y,
        telegraph.radius,
      ))
        damageEnemy(state, enemy, telegraph.enemyDamage, element, {
          source: telegraph.kind === "cataclysm" ? "ultimate" : "kill",
        });
      if (telegraph.kind === "cataclysm")
        for (const enemy of state.enemies) {
          if (enemy.dead) continue;
          damageEnemy(state, enemy, telegraph.enemyDamage * 0.15, "fire", {
            source: "ultimate",
          });
          knockback(state, enemy, 3);
        }
    }
    if (
      telegraph.damage > 0 &&
      distance(state.hero.x, state.hero.y, telegraph.x, telegraph.y) <= telegraph.radius
    ) {
      const source = state.enemies.find((enemy) => enemy.id === telegraph.sourceId);
      damageHero(state, telegraph.damage, { enemy: source, telegraphed: true });
      if (state.over) return;
    }
  }
  state.telegraphs = remaining;
};

const resolveTraps = (state: TdState) => {
  if (state.traps.length === 0) return;
  const damage = state.stats.damage * 8 * state.stats.trapMult * heroBoost(state);
  state.traps = state.traps.filter((trap) => {
    const triggered = state.enemies.some(
      (enemy) =>
        !enemy.dead &&
        distance(enemy.x, enemy.y, trap.x, trap.y) <= 0.8 + enemy.size * 0.3,
    );
    if (!triggered) return true;
    for (const enemy of enemiesWithin(state, trap.x, trap.y, 1.6)) {
      damageEnemy(state, enemy, damage, "fire", { source: "trap" });
      ignite(enemy, state.tick, 20, damage * 0.1);
    }
    emit(state, {
      type: "explosion",
      x: trap.x,
      y: trap.y,
      radius: 1.6,
      element: "fire",
    });
    return false;
  });
};

const dropMeteor = (state: TdState) => {
  const direction = state.rng.direction();
  const reach = state.rng.next() * 8;
  state.telegraphs.push({
    id: state.nextId++,
    x: direction.x * reach,
    y: direction.y * reach,
    radius: 1.5,
    start: state.tick,
    due: state.tick + 15,
    damage: tdReferenceDamage(state.wave) * 3,
    enemyDamage: tdReferenceHealth(state.wave) * 0.6,
    sourceId: 0,
    kind: "meteor",
  });
};

const cleanupDead = (state: TdState) => {
  let anyDead = false;
  for (const enemy of state.enemies) {
    if (enemy.dead || enemy.hp > 0) continue;
    enemy.dead = true;
    anyDead = true;
    state.kills += 1;
    const hunter = perk(state, "bounty_hunter") > 0 && (enemy.elite || enemy.boss);
    state.ryo += Math.floor(enemy.bounty * state.stats.ryoMult * (hunter ? 3 : 1));
    state.hero.chakra = Math.min(
      state.stats.maxChakra,
      state.hero.chakra + (enemy.boss ? 25 : 1),
    );
    if (enemy.boss)
      state.scrolls += tdBossScrolls(state.wave, enemy.titan) * state.stats.scrollMult;
    emit(state, {
      type: "kill",
      id: enemy.id,
      x: enemy.x,
      y: enemy.y,
      boss: enemy.boss,
      elite: enemy.elite,
      kind: enemy.kind,
    });
    dropLoot(state, enemy);
    if (perk(state, "exploding_kunai")) {
      state.hits.push(
        areaHit(state, enemy.x, enemy.y, 1.5, enemy.maxHp * 0.4, "fire", "kill"),
      );
    }
    const arch = TD_ENEMIES[enemy.kind];
    if (enemy.canSplit) {
      const splits: { kind: TdEnemyKind; count: number; scale: number }[] = [];
      if (arch.split)
        splits.push({ kind: arch.split.kind, count: arch.split.count, scale: 1 });
      if (
        enemy.affixes.includes("splitting") ||
        (state.eras.includes("hydra") && !enemy.boss)
      )
        splits.push({
          kind: enemy.kind === "mini" ? "mini" : enemy.kind,
          count: 2,
          scale: 0.35,
        });
      for (const split of splits)
        for (let i = 0; i < split.count; i++)
          spawnEnemy(
            state,
            { kind: split.kind, boss: false, titan: false, affixes: [], camo: false },
            {
              x: enemy.x + (state.rng.next() - 0.5) * 0.8,
              y: enemy.y + (state.rng.next() - 0.5) * 0.8,
            },
            split.scale < 1 ? split.scale : 0.999,
          );
    }
  }
  if (anyDead) state.enemies = state.enemies.filter((enemy) => !enemy.dead);
};

const dropLoot = (state: TdState, enemy: TdEnemy) => {
  const hunter = perk(state, "bounty_hunter") ? 2 : 1;
  const drops = enemy.titan
    ? 3
    : enemy.boss
      ? 2
      : state.rng.next() < (enemy.elite ? 0.4 : 0.015) * hunter
        ? 1
        : 0;
  for (let i = 0; i < drops; i++) {
    const roll = state.rng.next();
    const kind: TdLoot["kind"] =
      roll < 0.4 ? "ryo" : roll < 0.65 ? "chakra" : roll < 0.85 ? "rage" : "scroll";
    const value =
      kind === "ryo"
        ? 10 * tdReferenceBounty(state.wave) * state.stats.ryoMult
        : kind === "chakra"
          ? 40
          : kind === "rage"
            ? 80
            : 1 + state.wave / 40;
    state.loot.push({
      id: state.nextId++,
      x: enemy.x + (state.rng.next() - 0.5) * 0.6,
      y: enemy.y + (state.rng.next() - 0.5) * 0.6,
      kind,
      value,
      expires: state.tick + TD_LOOT_TICKS,
    });
  }
};

// ============================================
// Replay
// ============================================

export interface TdReplayResult {
  state: TdState;
  /** Why the replay stopped. */
  stop: "over" | "end" | "stalled" | "limit";
  /** Index of the first action that could not be applied in order, if any. */
  invalidAt: number | null;
}

/**
 * Replay a recorded log up to `endTick`. Actions must be in non-decreasing tick order;
 * a run waiting on a draft with no further action at its tick stops as "stalled".
 */
export const replayRun = (
  config: TdRunConfig,
  actions: readonly TdAction[],
  endTick: number,
  options: {
    maxTicks?: number;
    recordEvents?: boolean;
    onTick?: (state: TdState) => void;
  } = {},
): TdReplayResult => {
  const state = createRun(config, options.recordEvents ?? false);
  const maxTicks = options.maxTicks ?? Number.POSITIVE_INFINITY;
  let index = 0;
  for (;;) {
    while (index < actions.length && (actions[index]?.[0] ?? 0) <= state.tick) {
      const action = actions[index];
      if (!action || action[0] < state.tick)
        return { state, stop: "end", invalidAt: index };
      applyAction(state, action);
      index++;
    }
    if (state.over) return { state, stop: "over", invalidAt: null };
    if (state.tick >= endTick)
      return { state, stop: "end", invalidAt: index < actions.length ? index : null };
    if (state.tick >= maxTicks) return { state, stop: "limit", invalidAt: null };
    const before = state.tick;
    stepRun(state);
    options.onTick?.(state);
    if (state.tick === before && !state.over) {
      // Waiting on a draft: only an action at this tick can continue the run.
      if ((actions[index]?.[0] ?? -1) !== state.tick)
        return {
          state,
          stop: "stalled",
          invalidAt: index < actions.length ? index : null,
        };
    }
  }
};

/** Compact fingerprint of everything that decides the rest of a run. */
export const tdStateHash = (state: TdState) => {
  const round = (value: number) => Math.round(value * 1e6) / 1e6;
  return JSON.stringify([
    state.tick,
    state.wave,
    state.over,
    round(state.hero.hp),
    round(state.hero.chakra),
    round(state.hero.x),
    round(state.hero.y),
    Math.floor(state.ryo),
    round(state.scrolls),
    state.kills,
    state.offer,
    state.nextId,
    state.enemies.map((enemy) => [
      enemy.id,
      round(enemy.x),
      round(enemy.y),
      round(enemy.hp),
      round(enemy.shield),
    ]),
    state.hits.length,
    state.shots.length,
    state.telegraphs.length,
    state.traps.length,
    state.loot.map((item) => item.id),
    state.sentries.map((sentry) => (sentry ? `${sentry.type}${sentry.level}` : "")),
    state.shop,
    state.perks,
  ]);
};
