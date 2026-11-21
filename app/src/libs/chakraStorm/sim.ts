/**
 * The Chakra Storm simulation: a hero walks a bounded battlefield while raiders close in
 * from every side, and the hero's jutsu cast themselves. Chakra orbs fill a level bar,
 * each level opens a draft of three jutsu or passive arts, and scrolls from elites and
 * raid captains hold extra picks and awaken mastered jutsu.
 *
 * The engine is deterministic, like the tower-defense one: a run is its seed and config
 * plus the actions recorded at their ticks, so the same log replays to the same run in
 * any JavaScript engine. It therefore uses only exactly rounded arithmetic (no
 * `Math.pow`, `**`, `Math.hypot`, trigonometry, `Math.random` or clocks); directions come
 * from square roots.
 */
import {
  CS_ARENA_HALF,
  CS_BASE_REROLLS,
  CS_BOSS_BURST_SECONDS,
  CS_BOSS_CHARGE_SECONDS,
  CS_BOSS_DASH_SECONDS,
  CS_BOSS_DASH_SPEED,
  CS_BOSS_HP_PER_LEVEL,
  CS_BOSS_WINDUP_SECONDS,
  CS_CASTER_RANGE,
  CS_CASTER_SECONDS,
  CS_COMET_SPEED,
  CS_CONTACT_SECONDS,
  CS_ELITE_EVERY_SECONDS,
  CS_ELITE_EXPERIENCE,
  CS_ELITE_FIRST_SECONDS,
  CS_ELITE_HEALTH,
  CS_ELITE_SIZE,
  CS_ENEMIES,
  CS_FIELD_INTERVAL,
  CS_FIELD_SECONDS,
  CS_HERO,
  CS_HERO_GUARD_SECONDS,
  CS_JUTSU,
  CS_JUTSU_INFO,
  CS_MAX_ENEMIES,
  CS_MAX_ORBS,
  CS_ONIGIRI_CHANCE,
  CS_ONIGIRI_HEAL,
  CS_ORB_SPEED,
  CS_PASSIVE_INFO,
  CS_PASSIVES,
  CS_ROCK_RADIUS,
  CS_SCROLL_ODDS,
  CS_SHURIKEN_RANGE,
  CS_SHURIKEN_SPEED,
  CS_SICKLE_REHIT_SECONDS,
  CS_SLOTS,
  CS_SPAWN_DISTANCE,
  CS_STAGE_INFO,
  CS_SWARM_SECONDS,
  CS_TALISMAN_CHANCE,
  CS_TARGET_RANGE,
  CS_TIDAL_SPEED,
  CS_TPS,
  CS_TRAINING_EFFECT,
  CS_TREE_RADIUS,
  CS_WADE_SPEED,
  CS_WISP_SECONDS,
  CS_WISP_SPEED,
  type CsEnemyKind,
  type CsJutsu,
  type CsJutsuStats,
  type CsPassive,
  type CsStage,
  type CsTrainingLevels,
  csBossSeconds,
  csLevelCost,
  csNoTraining,
  csPaced,
  csPacedKills,
  csRunSeconds,
  csSpawnPressure,
  csSpawnTable,
  csStageFactor,
  csSwarmSeconds,
  csToughness,
} from "@/libs/chakraStorm/content";
import type { TdElement } from "@/libs/towerDefense/content";
import { createRng, type Rng } from "@/libs/towerDefense/rng";

/** Bumped whenever a change would replay an existing log differently. */
export const CS_SIM_VERSION = 4;

/** Sixteen unit directions, counterclockwise from east, built from square roots. */
export const CS_DIRECTIONS: readonly { x: number; y: number }[] = (() => {
  const c1 = Math.sqrt(2 + Math.SQRT2) / 2,
    s1 = Math.sqrt(2 - Math.SQRT2) / 2,
    c2 = Math.SQRT1_2;
  const quarter = [
    { x: 1, y: 0 },
    { x: c1, y: s1 },
    { x: c2, y: c2 },
    { x: s1, y: c1 },
  ];
  const all: { x: number; y: number }[] = [];
  for (let turn = 0; turn < 4; turn++)
    // Each quarter turn maps (x, y) to (-y, x).
    for (const { x, y } of quarter)
      all.push(
        turn === 0
          ? { x, y }
          : turn === 1
            ? { x: -y, y: x }
            : turn === 2
              ? { x: -x, y: -y }
              : { x: y, y: -x },
      );
  return all;
})();

/** Sixty-four orbit steps, halving the sixteen directions twice. */
const ORBIT: readonly { x: number; y: number }[] = (() => {
  let ring = [...CS_DIRECTIONS];
  for (let pass = 0; pass < 2; pass++) {
    const next: { x: number; y: number }[] = [];
    ring.forEach((a, index) => {
      const b = ring[(index + 1) % ring.length] ?? a;
      const mx = a.x + b.x,
        my = a.y + b.y,
        length = Math.sqrt(mx * mx + my * my);
      next.push(a, { x: mx / length, y: my / length });
    });
    ring = next;
  }
  return ring;
})();
/** Orbit steps a sickle moves per tick: one turn every 1.6 seconds. */
const ORBIT_STEPS_PER_TICK = 2;
/** Raiders the field refills by per tick when it is below the run's minimum. */
const REFILL_PER_TICK = 1;

/** What a run is played with: its stage and the player's Training Hall levels. */
export interface CsRunConfig {
  stage: CsStage;
  training: CsTrainingLevels;
  /** A quest challenge: the run is won once the hero has survived `seconds`. */
  challenge?: { seconds: number };
}

/** Seconds a run lasts at most: a challenge's survival time, or the region's full run. */
export const csRunLength = (config: CsRunConfig) =>
  config.challenge?.seconds ?? csRunSeconds(config.stage);

export type CsAction =
  /** Walk in one of the sixteen directions, or stand still with -1. */
  | ["move", number]
  /** Take a card from the open draft. */
  | ["pick", number]
  /** Spend a reroll for three new cards. */
  | ["reroll"]
  /** Close the draft without taking a card. */
  | ["skip"]
  /** Give up the run. */
  | ["quit"];

export type CsDraftOption =
  | { type: "jutsu"; id: CsJutsu; level: number }
  | { type: "passive"; id: CsPassive; level: number }
  | { type: "heal" };

export type CsEvent =
  | {
      type: "hit";
      id: number;
      x: number;
      y: number;
      amount: number;
      element: TdElement;
      crit: boolean;
    }
  | {
      type: "kill";
      id: number;
      x: number;
      y: number;
      kind: CsEnemyKind;
      elite: boolean;
    }
  | { type: "cast"; jutsu: CsJutsu; x: number; y: number }
  | { type: "chain"; points: { x: number; y: number }[]; awakened: boolean }
  | { type: "burst"; x: number; y: number; radius: number; awakened: boolean }
  | { type: "bloom"; x: number; y: number; radius: number }
  | { type: "hurt"; amount: number }
  | { type: "pickup"; kind: CsOrb["kind"]; x: number; y: number; value: number }
  | { type: "level"; level: number }
  | { type: "awaken"; jutsu: CsJutsu }
  | { type: "boss"; id: number; name: string }
  | { type: "bossWindup"; id: number; x: number; y: number; dx: number; dy: number }
  | { type: "bossBurst"; x: number; y: number }
  | { type: "elite"; id: number }
  | { type: "swarm" }
  | { type: "revive"; x: number; y: number }
  | { type: "over"; won: boolean };

export interface CsEnemy {
  id: number;
  kind: CsEnemyKind;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  radius: number;
  speed: number;
  damage: number;
  experience: number;
  elite: boolean;
  /** A raid captain's name; empty for everyone else. */
  name: string;
  /** Tick from which it can strike the hero again. */
  strikeAt: number;
  /** Tick of a caster's next orb or a captain's next ring. */
  castAt: number;
  /** A captain's next charge, its wind-up and its dash. */
  chargeAt: number;
  windupUntil: number;
  dashUntil: number;
  dashX: number;
  dashY: number;
  stunUntil: number;
  frozenUntil: number;
  slowUntil: number;
  /** Tick from which sickles can cut it again. */
  bladeAt: number;
  /** Knockback velocity, units per tick; it fades each tick. */
  kx: number;
  ky: number;
}

export interface CsProjectile {
  id: number;
  kind: "shuriken" | "comet" | "wisp" | "orb";
  x: number;
  y: number;
  /** Units per tick. */
  vx: number;
  vy: number;
  damage: number;
  radius: number;
  /** Raiders a shuriken or wisp can still pass through. */
  pierce: number;
  /** Ticks left before it falls or bursts. */
  life: number;
  /** Raiders it already hit. */
  hits: number[];
  /** A wisp's current quarry. */
  targetId: number;
  /** Cast by an awakened jutsu. */
  awakened: boolean;
}

export interface CsOrb {
  id: number;
  kind: "experience" | "onigiri" | "scroll" | "talisman";
  x: number;
  y: number;
  /** Experience, health, or the picks a scroll holds. */
  value: number;
  /** Pulled toward the hero once within pickup range, until collected. */
  flying: boolean;
}

export interface CsField {
  id: number;
  kind: "stone" | "fire";
  x: number;
  y: number;
  radius: number;
  damage: number;
  until: number;
  strikeAt: number;
  /** Mountain Maw's fields drag raiders toward their centre. */
  pull: boolean;
}

export interface CsPulse {
  id: number;
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  damage: number;
  push: number;
  hits: number[];
  /** Maelstrom mends the hero for each raider it strikes. */
  mends: boolean;
}

export interface CsJutsuEntry {
  id: CsJutsu;
  level: number;
  readyAt: number;
  awakened: boolean;
}

/** A tree or rock on the field; nobody walks through it. */
export interface CsObstacle {
  x: number;
  y: number;
  radius: number;
  kind: "tree" | "rock";
}

/** A pond on the field; anyone wading through it slows down. */
export interface CsPond {
  x: number;
  y: number;
  radius: number;
}

/** The field a run is played on, laid out from its seed and region. */
export interface CsGround {
  ponds: CsPond[];
  obstacles: CsObstacle[];
  /** Obstacles by two-unit cell, for collision lookups. */
  cells: Map<number, CsObstacle[]>;
}

export interface CsState {
  seed: string;
  config: CsRunConfig;
  ground: CsGround;
  tick: number;
  rng: Rng;
  nextId: number;
  hero: {
    x: number;
    y: number;
    hp: number;
    maxHp: number;
    /** Walking direction index, or -1 standing. */
    move: number;
    /** Last direction walked, which the hero faces. */
    facing: number;
    level: number;
    experience: number;
    /** Experience the current level needs. */
    next: number;
    revives: number;
    rerolls: number;
  };
  jutsu: CsJutsuEntry[];
  passives: { id: CsPassive; level: number }[];
  enemies: CsEnemy[];
  projectiles: CsProjectile[];
  orbs: CsOrb[];
  fields: CsField[];
  pulses: CsPulse[];
  /** The open draft; time stands still until a card is taken or the draft is skipped. */
  draft: CsDraftOption[] | null;
  /** Drafts earned but not opened yet. */
  draftsQueued: number;
  kills: number;
  bossesKilled: number;
  /** Fractional raiders owed by the trickle. */
  spawnCarry: number;
  /** The hero cannot be struck again before this tick. */
  guardUntil: number;
  nextEliteAt: number;
  swarmsDone: number;
  bossesDone: number;
  over: boolean;
  won: boolean;
  /** Events since the renderer last drained them. */
  events: CsEvent[];
}

const ticks = (seconds: number) => Math.max(1, Math.round(seconds * CS_TPS));

/** A new run for a seed and config: the hero alone with a Shuriken Volley. */
export const createCsRun = (
  seed: string,
  config: CsRunConfig = { stage: "horizon", training: csNoTraining() },
): CsState => {
  const maxHp = CS_HERO.hp + CS_TRAINING_EFFECT.vitality * config.training.vitality;
  return {
    seed,
    config,
    ground: csGroundLayout(seed, config.stage),
    tick: 0,
    rng: createRng(`${seed}:${config.stage}`),
    nextId: 1,
    hero: {
      x: 0,
      y: 0,
      hp: maxHp,
      maxHp,
      move: -1,
      facing: 12,
      level: 1,
      experience: 0,
      next: csLevelCost(config.stage, 1),
      revives: config.training.revival,
      rerolls: CS_BASE_REROLLS + config.training.reroll,
    },
    jutsu: [{ id: "shuriken", level: 1, readyAt: ticks(0.5), awakened: false }],
    passives: [],
    enemies: [],
    projectiles: [],
    orbs: [],
    fields: [],
    pulses: [],
    draft: null,
    draftsQueued: 0,
    kills: 0,
    bossesKilled: 0,
    spawnCarry: 0,
    guardUntil: 0,
    nextEliteAt: ticks(CS_ELITE_FIRST_SECONDS),
    swarmsDone: 0,
    bossesDone: 0,
    over: false,
    won: false,
    events: [],
  };
};

/** Seconds of the run simulated so far. */
export const csSeconds = (state: CsState) => state.tick / CS_TPS;

/** Whether the simulation can advance: the run is live and no draft waits for a pick. */
export const csCanStep = (state: CsState) => !state.over && !state.draft;

/**
 * Apply an action at the current tick, before the tick advances. Returns false when the
 * action does not apply, which a replay treats as a forged log.
 */
export const applyCsAction = (state: CsState, action: CsAction): boolean => {
  if (state.over) return false;
  switch (action[0]) {
    case "move": {
      const direction = action[1];
      if (!Number.isInteger(direction) || direction < -1 || direction > 15)
        return false;
      state.hero.move = direction;
      if (direction >= 0) state.hero.facing = direction;
      return true;
    }
    case "pick": {
      const option = state.draft?.[action[1]];
      if (!option) return false;
      takeOption(state, option);
      state.draft = null;
      openDraft(state);
      return true;
    }
    case "reroll":
      if (!state.draft || state.hero.rerolls <= 0) return false;
      state.hero.rerolls--;
      state.draft = draftOptions(state);
      return true;
    case "skip":
      if (!state.draft) return false;
      state.draft = null;
      openDraft(state);
      return true;
    case "quit":
      endRun(state, false);
      return true;
  }
};

/** Advance one tick. Does nothing while a draft is open or after the run ends. */
export const stepCs = (state: CsState) => {
  if (!csCanStep(state)) return;
  moveHero(state);
  spawnRaiders(state);
  castJutsu(state);
  moveProjectiles(state);
  updateFields(state);
  updatePulses(state);
  updateSickles(state);
  moveEnemies(state);
  collectOrbs(state);
  regenerate(state);
  state.enemies = state.enemies.filter((enemy) => enemy.hp > 0);
  state.tick++;
  if (state.hero.hp <= 0) fall(state);
  else if (state.tick >= csRunLength(state.config) * CS_TPS) endRun(state, true);
  // A draft earned this tick opens at its end, so a pick recorded now replays against it.
  if (!state.over) openDraft(state);
};

/** Gale Sickle positions around the hero at a tick, one per sickle. */
export const csSicklePositions = (state: CsState, tick = state.tick) => {
  const entry = state.jutsu.find((jutsu) => jutsu.id === "gale");
  if (!entry) return [];
  const stats = jutsuStats(state, entry);
  const positions: { x: number; y: number }[] = [];
  for (let i = 0; i < stats.count; i++) {
    const step = ORBIT[
      (tick * ORBIT_STEPS_PER_TICK + Math.floor((i * ORBIT.length) / stats.count)) %
        ORBIT.length
    ] ?? { x: 1, y: 0 };
    positions.push({
      x: state.hero.x + step.x * stats.radius,
      y: state.hero.y + step.y * stats.radius,
    });
  }
  return positions;
};

/** A jutsu's stats at its level or awakening, with passive arts and training applied. */
export const jutsuStats = (
  state: CsState,
  entry: Pick<CsJutsuEntry, "id" | "level" | "awakened">,
): CsJutsuStats => {
  const info = CS_JUTSU_INFO[entry.id];
  const base = entry.awakened
    ? info.awakening.stats
    : (info.levels[entry.level - 1] ?? info.levels[0]);
  if (!base) throw new Error(`Jutsu ${entry.id} has no levels`);
  const { training } = state.config;
  const echo = entry.id === "tidal" ? 0 : passiveLevel(state, "echoSeal");
  return {
    cooldown:
      base.cooldown *
      (1 - 0.05 * passiveLevel(state, "chakraControl")) *
      (1 - CS_TRAINING_EFFECT.haste * training.haste),
    damage:
      base.damage *
      (1 +
        0.08 * passiveLevel(state, "battleFocus") +
        CS_TRAINING_EFFECT.might * training.might),
    count: base.count + echo,
    radius: base.radius * (1 + 0.06 * passiveLevel(state, "expansion")),
    extra: base.extra,
  };
};

export const passiveLevel = (state: CsState, id: CsPassive) =>
  state.passives.find((entry) => entry.id === id)?.level ?? 0;

/** The hero's pickup range with the Magnet Seal and training applied. */
export const csPickupRange = (state: CsState) =>
  CS_HERO.pickup *
  (1 +
    0.3 * passiveLevel(state, "magnetSeal") +
    CS_TRAINING_EFFECT.reach * state.config.training.reach);

/** Jutsu a scroll would awaken now: mastered, partner held, not yet awakened. */
export const csAwakenable = (state: Pick<CsState, "jutsu" | "passives">) =>
  state.jutsu.filter((entry) => {
    const info = CS_JUTSU_INFO[entry.id];
    return (
      !entry.awakened &&
      entry.level >= info.levels.length &&
      state.passives.some((passive) => passive.id === info.awakening.partner)
    );
  });

// Hero

/** Units the hero walks in one tick. */
export const csHeroStep = (state: CsState) =>
  (CS_HERO.speed *
    (1 +
      0.08 * passiveLevel(state, "swiftFeet") +
      CS_TRAINING_EFFECT.swiftness * state.config.training.swiftness)) /
  CS_TPS;

const moveHero = (state: CsState) => {
  const { hero } = state;
  const direction = CS_DIRECTIONS[hero.move];
  if (!direction) return;
  const speed =
    csHeroStep(state) * (csInPond(state, hero.x, hero.y) ? CS_WADE_SPEED : 1);
  const next = resolveObstacles(
    state,
    clampArena(hero.x + direction.x * speed),
    clampArena(hero.y + direction.y * speed),
    CS_HERO.radius * 0.8,
  );
  hero.x = next.x;
  hero.y = next.y;
};

/** Whether a point stands in one of the field's ponds. */
export const csInPond = (state: Pick<CsState, "ground">, x: number, y: number) =>
  state.ground.ponds.some((pond) => {
    const dx = x - pond.x,
      dy = y - pond.y;
    return dx * dx + dy * dy < pond.radius * pond.radius;
  });

/** Push a body of `radius` at (x, y) out of every tree and rock it overlaps. */
const resolveObstacles = (state: CsState, x: number, y: number, radius: number) => {
  let px = x,
    py = y;
  const cx = Math.floor(x / 2),
    cy = Math.floor(y / 2);
  for (let gx = cx - 1; gx <= cx + 1; gx++)
    for (let gy = cy - 1; gy <= cy + 1; gy++)
      for (const obstacle of state.ground.cells.get(cellIndex(gx, gy)) ?? []) {
        const dx = px - obstacle.x,
          dy = py - obstacle.y;
        const reach = radius + obstacle.radius;
        const squared = dx * dx + dy * dy;
        if (squared >= reach * reach) continue;
        const length = Math.sqrt(squared);
        if (length < 0.0001) {
          px = obstacle.x + reach;
          continue;
        }
        px = obstacle.x + (dx / length) * reach;
        py = obstacle.y + (dy / length) * reach;
      }
  return { x: clampArena(px), y: clampArena(py) };
};

/**
 * The field for a seed and region: ponds away from the start, then trees and rocks spaced
 * so there is always a way between them, none on the starting clearing or in a pond.
 */
export const csGroundLayout = (seed: string, stage: CsStage): CsGround => {
  const rng = createRng(`${seed}:${stage}:ground`);
  const plan = CS_STAGE_INFO[stage].field;
  const ponds: CsPond[] = [];
  const obstacles: CsObstacle[] = [];
  const within = (margin: number) => (rng.next() * 2 - 1) * (CS_ARENA_HALF - margin);
  for (let i = 0; i < plan.ponds; i++)
    for (let attempt = 0; attempt < 40; attempt++) {
      const radius = 1.8 + rng.next() * 1.6;
      const x = within(radius + 1.5),
        y = within(radius + 1.5);
      const clearOfStart = x * x + y * y >= (5 + radius) * (5 + radius);
      const apart = ponds.every((pond) => {
        const gap = pond.radius + radius + 3;
        return (pond.x - x) * (pond.x - x) + (pond.y - y) * (pond.y - y) >= gap * gap;
      });
      if (!clearOfStart || !apart) continue;
      ponds.push({ x, y, radius });
      break;
    }
  const place = (kind: CsObstacle["kind"], count: number) => {
    const radius = kind === "tree" ? CS_TREE_RADIUS : CS_ROCK_RADIUS;
    for (let i = 0; i < count; i++)
      for (let attempt = 0; attempt < 30; attempt++) {
        const x = within(1),
          y = within(1);
        if (x * x + y * y < 4.5 * 4.5) continue;
        const dry = ponds.every((pond) => {
          const gap = pond.radius + 1.2;
          return (pond.x - x) * (pond.x - x) + (pond.y - y) * (pond.y - y) >= gap * gap;
        });
        const spaced = obstacles.every(
          (other) =>
            (other.x - x) * (other.x - x) + (other.y - y) * (other.y - y) >= 2.4 * 2.4,
        );
        if (!dry || !spaced) continue;
        obstacles.push({ x, y, radius, kind });
        break;
      }
  };
  place("tree", plan.trees);
  place("rock", plan.rocks);
  const cells = new Map<number, CsObstacle[]>();
  for (const obstacle of obstacles) {
    const key = cellIndex(Math.floor(obstacle.x / 2), Math.floor(obstacle.y / 2));
    const cell = cells.get(key);
    if (cell) cell.push(obstacle);
    else cells.set(key, [obstacle]);
  }
  return { ponds, obstacles, cells };
};

const regenerate = (state: CsState) => {
  const perSecond =
    0.4 * passiveLevel(state, "ironBody") +
    CS_TRAINING_EFFECT.recovery * state.config.training.recovery;
  if (perSecond === 0 || state.hero.hp <= 0) return;
  state.hero.hp = Math.min(state.hero.maxHp, state.hero.hp + perSecond / CS_TPS);
};

const hurtHero = (state: CsState, amount: number) => {
  if (state.tick < state.guardUntil) return;
  state.guardUntil = state.tick + ticks(CS_HERO_GUARD_SECONDS);
  const damage = Math.round(
    amount *
      csStageFactor(state.config.stage, "damage", csSeconds(state)) *
      (1 + csPaced(state.config.stage, csSeconds(state)) / 600),
  );
  state.hero.hp = Math.max(0, state.hero.hp - damage);
  state.events.push({ type: "hurt", amount: damage });
};

/** Down to no health: Second Wind raises the hero once, else the run ends. */
const fall = (state: CsState) => {
  const { hero } = state;
  if (hero.revives <= 0) {
    endRun(state, false);
    return;
  }
  hero.revives--;
  hero.hp = hero.maxHp / 2;
  // The rising hero throws back everything close enough to strike.
  for (const enemy of enemiesWithin(state, hero.x, hero.y, 6)) {
    const dx = enemy.x - hero.x,
      dy = enemy.y - hero.y;
    const length = Math.sqrt(dx * dx + dy * dy) || 1;
    enemy.kx += (dx / length) * 0.8;
    enemy.ky += (dy / length) * 0.8;
    enemy.stunUntil = Math.max(enemy.stunUntil, state.tick + ticks(1.5));
  }
  state.events.push({ type: "revive", x: hero.x, y: hero.y });
};

const endRun = (state: CsState, won: boolean) => {
  state.over = true;
  state.won = won;
  state.draft = null;
  state.events.push({ type: "over", won });
};

// Raiders

const spawnRaiders = (state: CsState) => {
  const seconds = csSeconds(state);
  const stage = CS_STAGE_INFO[state.config.stage];
  // Raid captains
  const bossAt = csBossSeconds(state.config.stage, state.bossesDone);
  if (bossAt !== null && state.tick >= bossAt * CS_TPS) {
    const name = stage.bosses[state.bossesDone % stage.bosses.length] ?? "Raid Captain";
    state.bossesDone++;
    const boss = spawnEnemy(state, "boss", seconds, false);
    boss.name = name;
    boss.castAt = state.tick + ticks(CS_BOSS_BURST_SECONDS);
    boss.chargeAt = state.tick + ticks(CS_BOSS_CHARGE_SECONDS / 2);
    state.events.push({ type: "boss", id: boss.id, name });
  }
  // Swarms close in as a ring from every side at once.
  const swarm = csSwarmSeconds(state.config.stage, state.swarmsDone);
  if (swarm !== null && state.tick >= swarm * CS_TPS) {
    state.swarmsDone++;
    const count = 16 + 8 * Math.min(state.swarmsDone, CS_SWARM_SECONDS.length);
    for (let i = 0; i < count; i++) {
      const enemy = spawnEnemy(state, "grunt", seconds, false);
      const step = ORBIT[Math.floor((i * ORBIT.length) / count)] ?? { x: 1, y: 0 };
      enemy.x = clampArena(state.hero.x + step.x * (CS_SPAWN_DISTANCE - 2));
      enemy.y = clampArena(state.hero.y + step.y * (CS_SPAWN_DISTANCE - 2));
    }
    state.events.push({ type: "swarm" });
  }
  // Elites
  const paced = csPaced(state.config.stage, seconds);
  const table = csSpawnTable(paced, state.config.stage);
  if (state.tick >= state.nextEliteAt) {
    state.nextEliteAt += ticks(CS_ELITE_EVERY_SECONDS);
    const kind =
      weightedPick(
        state.rng,
        table.filter(([kind]) => kind !== "runner"),
      ) ?? "grunt";
    const elite = spawnEnemy(state, kind, seconds, true);
    state.events.push({ type: "elite", id: elite.id });
  }
  // The field refills to the run's minimum at once, and a trickle comes on top.
  const pressure = csSpawnPressure(paced, state.config.stage);
  const minimum = Math.min(CS_MAX_ENEMIES, Math.round(pressure.minimum * stage.spawns));
  let owed = Math.min(REFILL_PER_TICK, minimum - state.enemies.length);
  state.spawnCarry += stage.spawns / (pressure.interval * CS_TPS);
  while (state.spawnCarry >= 1) {
    state.spawnCarry -= 1;
    owed = Math.max(owed, 0) + 1;
  }
  for (; owed > 0 && state.enemies.length < CS_MAX_ENEMIES; owed--)
    spawnEnemy(state, weightedPick(state.rng, table) ?? "grunt", seconds, false);
};

const spawnEnemy = (
  state: CsState,
  kind: CsEnemyKind,
  seconds: number,
  elite: boolean,
): CsEnemy => {
  const info = CS_ENEMIES[kind];
  const stage = CS_STAGE_INFO[state.config.stage];
  const { hero } = state;
  // Just beyond the camera, on the battlefield: try a few directions before clamping.
  let x = 0,
    y = 0;
  for (let attempt = 0; attempt < 6; attempt++) {
    const direction = state.rng.direction();
    x = hero.x + direction.x * CS_SPAWN_DISTANCE;
    y = hero.y + direction.y * CS_SPAWN_DISTANCE;
    if (Math.abs(x) <= CS_ARENA_HALF && Math.abs(y) <= CS_ARENA_HALF) break;
  }
  // Captains scale with the hero's level, so a strong build still meets a fight.
  const hp = Math.round(
    (kind === "boss"
      ? CS_BOSS_HP_PER_LEVEL * hero.level
      : info.hp *
        csToughness(
          csPaced(state.config.stage, seconds),
          csPacedKills(state.config.stage, seconds, state.kills),
        ) *
        (elite ? CS_ELITE_HEALTH : 1)) *
      csStageFactor(state.config.stage, "health", seconds),
  );
  const enemy: CsEnemy = {
    id: state.nextId++,
    kind,
    x: clampArena(x),
    y: clampArena(y),
    hp,
    maxHp: hp,
    radius: info.radius * (elite ? CS_ELITE_SIZE : 1),
    speed: info.speed * stage.speed * (elite ? 0.9 : 1),
    damage: info.damage * (elite ? 1.5 : 1),
    experience: info.experience + (elite ? CS_ELITE_EXPERIENCE : 0),
    elite,
    name: "",
    strikeAt: 0,
    castAt: state.tick + ticks(CS_CASTER_SECONDS * (0.5 + state.rng.next())),
    chargeAt: 0,
    windupUntil: 0,
    dashUntil: 0,
    dashX: 0,
    dashY: 0,
    stunUntil: 0,
    frozenUntil: 0,
    slowUntil: 0,
    bladeAt: 0,
    kx: 0,
    ky: 0,
  };
  const free = resolveObstacles(state, enemy.x, enemy.y, enemy.radius * 0.8);
  enemy.x = free.x;
  enemy.y = free.y;
  state.enemies.push(enemy);
  return enemy;
};

/** Raiders walk at the hero and shove each other apart; casters hold their distance. */
const moveEnemies = (state: CsState) => {
  const { hero } = state;
  const grid = new Map<number, CsEnemy[]>();
  for (const enemy of state.enemies) {
    if (enemy.hp <= 0) continue;
    const key = cellKey(enemy.x, enemy.y);
    const cell = grid.get(key);
    if (cell) cell.push(enemy);
    else grid.set(key, [enemy]);
  }
  for (const enemy of state.enemies) {
    if (enemy.hp <= 0) continue;
    const dx = hero.x - enemy.x,
      dy = hero.y - enemy.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const reach = enemy.radius + CS_HERO.radius;
    // Knockback carries it whatever it does, and fades.
    enemy.x += enemy.kx;
    enemy.y += enemy.ky;
    enemy.kx *= 0.75;
    enemy.ky *= 0.75;
    const held = state.tick < enemy.stunUntil || state.tick < enemy.frozenUntil;
    if (enemy.kind === "boss" && !held) bossCharge(state, enemy, dx, dy, distance);
    const charging = state.tick < enemy.windupUntil || state.tick < enemy.dashUntil;
    if (state.tick < enemy.dashUntil) {
      enemy.x += enemy.dashX;
      enemy.y += enemy.dashY;
    } else if (!held && !charging && distance > 0.001) {
      const slowed =
        (state.tick < enemy.slowUntil ? 0.5 : 1) *
        (csInPond(state, enemy.x, enemy.y) ? CS_WADE_SPEED : 1);
      const holding = enemy.kind === "caster" && distance < CS_CASTER_RANGE;
      if (!holding && distance > reach * 0.9) {
        const step = Math.min(distance - reach * 0.9, (enemy.speed * slowed) / CS_TPS);
        enemy.x += (dx / distance) * step;
        enemy.y += (dy / distance) * step;
      }
    }
    // Strikes and thrown orbs; frozen raiders do neither.
    if (state.tick >= enemy.frozenUntil) {
      if (distance <= reach && state.tick >= enemy.strikeAt) {
        enemy.strikeAt = state.tick + ticks(CS_CONTACT_SECONDS);
        hurtHero(state, enemy.damage);
      }
      if (
        (enemy.kind === "caster" || enemy.kind === "boss") &&
        state.tick >= enemy.castAt &&
        !held &&
        !charging
      )
        enemyCast(state, enemy, dx, dy, distance);
    }
    // Separation from the raiders in the cells around it
    const cx = Math.floor(enemy.x),
      cy = Math.floor(enemy.y);
    for (let gx = cx - 1; gx <= cx + 1; gx++)
      for (let gy = cy - 1; gy <= cy + 1; gy++)
        for (const other of grid.get(cellIndex(gx, gy)) ?? []) {
          if (other.id <= enemy.id || other.hp <= 0) continue;
          const ox = other.x - enemy.x,
            oy = other.y - enemy.y;
          const gap = enemy.radius + other.radius;
          const squared = ox * ox + oy * oy;
          if (squared >= gap * gap) continue;
          const length = Math.sqrt(squared) || 0.001;
          const push = ((gap - length) / length) * 0.5;
          // Heavier raiders give way less.
          const share = other.radius / gap;
          enemy.x -= ox * push * share;
          enemy.y -= oy * push * share;
          other.x += ox * push * (1 - share);
          other.y += oy * push * (1 - share);
        }
    const free = resolveObstacles(state, enemy.x, enemy.y, enemy.radius * 0.8);
    enemy.x = free.x;
    enemy.y = free.y;
  }
};

/** A captain winds up, telegraphing its line, then charges along it. */
const bossCharge = (
  state: CsState,
  boss: CsEnemy,
  dx: number,
  dy: number,
  distance: number,
) => {
  if (boss.windupUntil > 0 && state.tick === boss.windupUntil) {
    boss.dashUntil = state.tick + ticks(CS_BOSS_DASH_SECONDS);
    return;
  }
  if (state.tick < boss.chargeAt || state.tick < boss.dashUntil || distance < 0.001)
    return;
  boss.chargeAt = state.tick + ticks(CS_BOSS_CHARGE_SECONDS);
  boss.windupUntil = state.tick + ticks(CS_BOSS_WINDUP_SECONDS);
  boss.dashX = ((dx / distance) * CS_BOSS_DASH_SPEED) / CS_TPS;
  boss.dashY = ((dy / distance) * CS_BOSS_DASH_SPEED) / CS_TPS;
  state.events.push({
    type: "bossWindup",
    id: boss.id,
    x: boss.x,
    y: boss.y,
    dx: dx / distance,
    dy: dy / distance,
  });
};

const enemyCast = (
  state: CsState,
  enemy: CsEnemy,
  dx: number,
  dy: number,
  distance: number,
) => {
  if (enemy.kind === "boss") {
    enemy.castAt = state.tick + ticks(CS_BOSS_BURST_SECONDS);
    for (const direction of CS_DIRECTIONS)
      state.projectiles.push(
        enemyOrb(state, enemy, direction.x, direction.y, enemy.damage * 0.6),
      );
    state.events.push({ type: "bossBurst", x: enemy.x, y: enemy.y });
    return;
  }
  enemy.castAt = state.tick + ticks(CS_CASTER_SECONDS);
  if (distance > CS_TARGET_RANGE || distance < 0.001) return;
  state.projectiles.push(
    enemyOrb(state, enemy, dx / distance, dy / distance, enemy.damage),
  );
};

const enemyOrb = (
  state: CsState,
  enemy: CsEnemy,
  dx: number,
  dy: number,
  damage: number,
): CsProjectile => ({
  id: state.nextId++,
  kind: "orb",
  x: enemy.x,
  y: enemy.y + 0.5,
  vx: (dx * CS_ORB_SPEED) / CS_TPS,
  vy: (dy * CS_ORB_SPEED) / CS_TPS,
  damage,
  radius: 0.25,
  pierce: 0,
  life: ticks(4),
  hits: [],
  targetId: 0,
  awakened: false,
});

// Jutsu

const castJutsu = (state: CsState) => {
  for (const entry of state.jutsu) {
    if (state.tick < entry.readyAt || entry.id === "gale") continue;
    const stats = jutsuStats(state, entry);
    if (!CASTS[entry.id](state, stats, entry.awakened)) continue;
    entry.readyAt = state.tick + ticks(stats.cooldown);
    state.events.push({
      type: "cast",
      jutsu: entry.id,
      x: state.hero.x,
      y: state.hero.y,
    });
  }
};

/** Each jutsu's cast; false when it found nothing to aim at and waits. */
const CASTS: Record<
  CsJutsu,
  (state: CsState, stats: CsJutsuStats, awakened: boolean) => boolean
> = {
  shuriken: (state, stats, awakened) => {
    const { hero } = state;
    const targets = nearestEnemies(state, hero.x, hero.y, stats.count, CS_TARGET_RANGE);
    if (targets.length === 0) return false;
    for (let i = 0; i < stats.count; i++) {
      const target = targets[i % targets.length];
      if (!target) continue;
      const dx = target.x - hero.x,
        dy = target.y + 0.4 - hero.y;
      const length = Math.sqrt(dx * dx + dy * dy) || 1;
      // Extra shuriken at the same raider fan out a little.
      const spread = i < targets.length ? 0 : (i - targets.length + 1) * 0.12;
      const vx = dx / length - (dy / length) * spread,
        vy = dy / length + (dx / length) * spread;
      const norm = Math.sqrt(vx * vx + vy * vy);
      state.projectiles.push({
        id: state.nextId++,
        kind: "shuriken",
        x: hero.x,
        y: hero.y + 0.4,
        vx: ((vx / norm) * CS_SHURIKEN_SPEED) / CS_TPS,
        vy: ((vy / norm) * CS_SHURIKEN_SPEED) / CS_TPS,
        damage: stats.damage,
        radius: awakened ? 0.4 : 0.3,
        pierce: stats.extra,
        life: ticks(CS_SHURIKEN_RANGE / CS_SHURIKEN_SPEED),
        hits: [],
        targetId: 0,
        awakened,
      });
    }
    return true;
  },
  ember: (state, stats, awakened) => {
    const { hero } = state;
    const candidates = enemiesWithin(state, hero.x, hero.y, CS_TARGET_RANGE);
    if (candidates.length === 0) return false;
    for (let i = 0; i < stats.count; i++) {
      const target = state.rng.pick(candidates);
      const dx = target.x - hero.x,
        dy = target.y + 0.4 - hero.y;
      const length = Math.sqrt(dx * dx + dy * dy) || 1;
      state.projectiles.push({
        id: state.nextId++,
        kind: "comet",
        x: hero.x,
        y: hero.y + 0.4,
        vx: ((dx / length) * CS_COMET_SPEED) / CS_TPS,
        vy: ((dy / length) * CS_COMET_SPEED) / CS_TPS,
        damage: stats.damage,
        radius: stats.radius,
        pierce: 0,
        life: Math.max(1, Math.round((length / CS_COMET_SPEED) * CS_TPS)),
        hits: [],
        targetId: 0,
        awakened,
      });
    }
    return true;
  },
  gale: () => false,
  thunder: (state, stats, awakened) => {
    const { hero } = state;
    const candidates = enemiesWithin(state, hero.x, hero.y, CS_TARGET_RANGE);
    if (candidates.length === 0) return false;
    // Storm Crown calls three bolts at once.
    for (let bolt = 0; bolt < (awakened ? 3 : 1); bolt++) {
      let current = state.rng.pick(candidates);
      const struck = new Set<number>();
      const points = [{ x: hero.x, y: hero.y + 0.6 }];
      for (let jump = 0; jump <= stats.count; jump++) {
        struck.add(current.id);
        points.push({ x: current.x, y: current.y + 0.5 });
        damageEnemy(state, current, stats.damage, "lightning");
        current.stunUntil = Math.max(
          current.stunUntil,
          state.tick + ticks(stats.extra),
        );
        const next = nearestEnemies(
          state,
          current.x,
          current.y,
          1,
          stats.radius,
          struck,
        )[0];
        if (!next) break;
        current = next;
      }
      state.events.push({ type: "chain", points, awakened });
    }
    return true;
  },
  tidal: (state, stats, awakened) => {
    if (enemiesWithin(state, state.hero.x, state.hero.y, stats.radius + 2).length === 0)
      return false;
    state.pulses.push({
      id: state.nextId++,
      x: state.hero.x,
      y: state.hero.y,
      radius: 0,
      maxRadius: stats.radius,
      damage: stats.damage,
      push: stats.extra,
      hits: [],
      mends: awakened,
    });
    return true;
  },
  stonefang: (state, stats, awakened) => {
    const { hero } = state;
    const candidates = enemiesWithin(state, hero.x, hero.y, CS_TARGET_RANGE * 0.8);
    if (candidates.length === 0) return false;
    for (let i = 0; i < stats.count; i++) {
      const target = state.rng.pick(candidates);
      state.fields.push({
        id: state.nextId++,
        kind: "stone",
        x: target.x,
        y: target.y,
        radius: stats.radius,
        damage: stats.damage,
        until: state.tick + ticks(CS_FIELD_SECONDS),
        strikeAt: state.tick,
        pull: awakened,
      });
    }
    return true;
  },
  frost: (state, stats) => {
    const { hero } = state;
    const candidates = enemiesWithin(state, hero.x, hero.y, CS_TARGET_RANGE);
    if (candidates.length === 0) return false;
    for (let i = 0; i < stats.count; i++) {
      const target = state.rng.pick(candidates);
      const { x, y } = target;
      for (const enemy of enemiesWithin(state, x, y, stats.radius)) {
        damageEnemy(state, enemy, stats.damage, "water");
        // Captains shake off the ice four times faster.
        const freeze = enemy.kind === "boss" ? stats.extra / 4 : stats.extra;
        enemy.frozenUntil = Math.max(enemy.frozenUntil, state.tick + ticks(freeze));
      }
      state.events.push({ type: "bloom", x, y, radius: stats.radius });
    }
    return true;
  },
  wisps: (state, stats, awakened) => {
    const { hero } = state;
    const targets = nearestEnemies(state, hero.x, hero.y, stats.count, CS_TARGET_RANGE);
    if (targets.length === 0) return false;
    for (let i = 0; i < stats.count; i++) {
      const target = targets[i % targets.length];
      // Wisps leave in a fan before turning toward their quarry.
      const direction = CS_DIRECTIONS[(i * 5 + state.tick) % 16] ?? { x: 0, y: 1 };
      state.projectiles.push({
        id: state.nextId++,
        kind: "wisp",
        x: hero.x,
        y: hero.y + 0.6,
        vx: (direction.x * CS_WISP_SPEED) / CS_TPS,
        vy: (direction.y * CS_WISP_SPEED) / CS_TPS,
        damage: stats.damage,
        radius: 0.35,
        pierce: stats.extra,
        life: ticks(CS_WISP_SECONDS * (awakened ? 1.5 : 1)),
        hits: [],
        targetId: target?.id ?? 0,
        awakened,
      });
    }
    return true;
  },
};

const moveProjectiles = (state: CsState) => {
  const { hero } = state;
  const kept: CsProjectile[] = [];
  for (const projectile of state.projectiles) {
    if (projectile.kind === "wisp") steerWisp(state, projectile);
    projectile.x += projectile.vx;
    projectile.y += projectile.vy;
    projectile.life--;
    let spent = projectile.life <= 0;
    if (projectile.kind === "orb") {
      const dx = hero.x - projectile.x,
        dy = hero.y + 0.5 - projectile.y;
      const reach = CS_HERO.radius + projectile.radius;
      if (dx * dx + dy * dy <= reach * reach) {
        hurtHero(state, projectile.damage);
        spent = true;
      }
    } else if (projectile.kind === "shuriken" || projectile.kind === "wisp") {
      for (const enemy of state.enemies) {
        if (enemy.hp <= 0 || projectile.hits.includes(enemy.id)) continue;
        if (!touches(projectile, enemy)) continue;
        projectile.hits.push(enemy.id);
        damageEnemy(
          state,
          enemy,
          projectile.damage,
          projectile.kind === "wisp" ? "wind" : "physical",
        );
        if (projectile.pierce-- <= 0) {
          spent = true;
          break;
        }
      }
    } else {
      const hit = state.enemies.some(
        (enemy) => enemy.hp > 0 && touches({ ...projectile, radius: 0.35 }, enemy),
      );
      if (hit || spent) {
        spent = true;
        for (const enemy of enemiesWithin(
          state,
          projectile.x,
          projectile.y,
          projectile.radius,
        ))
          damageEnemy(state, enemy, projectile.damage, "fire");
        // Sunfall scorches the ground where it lands.
        if (projectile.awakened)
          state.fields.push({
            id: state.nextId++,
            kind: "fire",
            x: projectile.x,
            y: projectile.y,
            radius: projectile.radius * 0.45,
            damage: projectile.damage * 0.15,
            until: state.tick + ticks(2),
            strikeAt: state.tick + ticks(0.4),
            pull: false,
          });
        state.events.push({
          type: "burst",
          x: projectile.x,
          y: projectile.y,
          radius: projectile.radius,
          awakened: projectile.awakened,
        });
      }
    }
    if (!spent) kept.push(projectile);
  }
  state.projectiles = kept;
};

/** A wisp turns toward its quarry, or the nearest raider it has not passed through. */
const steerWisp = (state: CsState, wisp: CsProjectile) => {
  let target = state.enemies.find(
    (enemy) => enemy.id === wisp.targetId && enemy.hp > 0,
  );
  if (!target || wisp.hits.includes(target.id)) {
    target = nearestEnemies(state, wisp.x, wisp.y, 1, 9, new Set(wisp.hits))[0];
    wisp.targetId = target?.id ?? 0;
  }
  if (!target) return;
  const dx = target.x - wisp.x,
    dy = target.y + target.radius - wisp.y;
  const length = Math.sqrt(dx * dx + dy * dy) || 1;
  const speed = CS_WISP_SPEED / CS_TPS;
  const vx = wisp.vx * 0.82 + (dx / length) * speed * 0.18,
    vy = wisp.vy * 0.82 + (dy / length) * speed * 0.18;
  const norm = Math.sqrt(vx * vx + vy * vy) || 1;
  wisp.vx = (vx / norm) * speed;
  wisp.vy = (vy / norm) * speed;
};

const updateFields = (state: CsState) => {
  state.fields = state.fields.filter((field) => field.until > state.tick);
  for (const field of state.fields) {
    if (field.pull)
      for (const enemy of enemiesWithin(state, field.x, field.y, field.radius * 1.8)) {
        if (enemy.kind === "boss") continue;
        const dx = field.x - enemy.x,
          dy = field.y - enemy.y;
        const length = Math.sqrt(dx * dx + dy * dy);
        if (length < 0.2) continue;
        enemy.kx += (dx / length) * 0.03;
        enemy.ky += (dy / length) * 0.03;
      }
    if (state.tick < field.strikeAt) continue;
    field.strikeAt = state.tick + ticks(CS_FIELD_INTERVAL);
    for (const enemy of enemiesWithin(state, field.x, field.y, field.radius)) {
      damageEnemy(state, enemy, field.damage, field.kind === "fire" ? "fire" : "earth");
      if (field.kind === "stone")
        enemy.slowUntil = Math.max(enemy.slowUntil, field.strikeAt + 2);
    }
  }
};

const updatePulses = (state: CsState) => {
  const kept: CsPulse[] = [];
  for (const pulse of state.pulses) {
    pulse.radius = Math.min(pulse.maxRadius, pulse.radius + CS_TIDAL_SPEED / CS_TPS);
    let mended = 0;
    for (const enemy of enemiesWithin(state, pulse.x, pulse.y, pulse.radius)) {
      if (pulse.hits.includes(enemy.id)) continue;
      pulse.hits.push(enemy.id);
      damageEnemy(state, enemy, pulse.damage, "water");
      const dx = enemy.x - pulse.x,
        dy = enemy.y - pulse.y;
      const length = Math.sqrt(dx * dx + dy * dy) || 1;
      // Captains barely budge.
      const push = (pulse.push * 0.25) / (enemy.kind === "boss" ? 6 : 1);
      enemy.kx += (dx / length) * push;
      enemy.ky += (dy / length) * push;
      if (pulse.mends && mended < 10) mended++;
    }
    if (mended > 0)
      state.hero.hp = Math.min(state.hero.maxHp, state.hero.hp + mended * 0.5);
    if (pulse.radius < pulse.maxRadius) kept.push(pulse);
  }
  state.pulses = kept;
};

const updateSickles = (state: CsState) => {
  const entry = state.jutsu.find((jutsu) => jutsu.id === "gale");
  if (!entry) return;
  const stats = jutsuStats(state, entry);
  const rehit = ticks(CS_SICKLE_REHIT_SECONDS * (entry.awakened ? 0.6 : 1));
  for (const sickle of csSicklePositions(state))
    for (const enemy of state.enemies) {
      if (enemy.hp <= 0 || state.tick < enemy.bladeAt) continue;
      if (!touches({ x: sickle.x, y: sickle.y - 0.3, radius: 0.5 }, enemy)) continue;
      enemy.bladeAt = state.tick + rehit;
      damageEnemy(state, enemy, stats.damage, "wind");
    }
};

/** Deal damage, with a chance of a critical double, and drop loot on a kill. */
const damageEnemy = (
  state: CsState,
  enemy: CsEnemy,
  base: number,
  element: TdElement,
) => {
  if (enemy.hp <= 0) return;
  const critChance =
    CS_HERO.crit +
    0.03 * passiveLevel(state, "fortune") +
    CS_TRAINING_EFFECT.luck * state.config.training.luck;
  const crit = state.rng.next() < critChance;
  const amount = Math.max(1, Math.round(base * (crit ? 2 : 1)));
  enemy.hp -= amount;
  state.events.push({
    type: "hit",
    id: enemy.id,
    x: enemy.x,
    y: enemy.y,
    amount,
    element,
    crit,
  });
  if (enemy.hp > 0) return;
  state.kills++;
  if (enemy.kind === "boss") state.bossesKilled++;
  state.events.push({
    type: "kill",
    id: enemy.id,
    x: enemy.x,
    y: enemy.y,
    kind: enemy.kind,
    elite: enemy.elite,
  });
  dropOrb(state, "experience", enemy.x, enemy.y, enemy.experience);
  if (enemy.elite || enemy.kind === "boss")
    dropOrb(
      state,
      "scroll",
      enemy.x + 0.4,
      enemy.y,
      rollScroll(state.rng, enemy.kind === "boss" ? "boss" : "elite"),
    );
  const luck = 1 + 0.2 * passiveLevel(state, "fortune");
  if (
    enemy.kind === "boss" ||
    (enemy.kind === "brute" && state.rng.next() < 0.08 * luck) ||
    state.rng.next() < CS_ONIGIRI_CHANCE * luck
  )
    dropOrb(state, "onigiri", enemy.x - 0.4, enemy.y, CS_ONIGIRI_HEAL);
  if (enemy.elite || state.rng.next() < CS_TALISMAN_CHANCE * luck)
    dropOrb(state, "talisman", enemy.x, enemy.y - 0.4, 1);
};

/** Picks a scroll holds, drawn from its odds. */
const rollScroll = (rng: Rng, source: keyof typeof CS_SCROLL_ODDS) => {
  let roll = rng.next();
  for (const [picks, chance] of CS_SCROLL_ODDS[source]) {
    roll -= chance;
    if (roll < 0) return picks;
  }
  return 1;
};

const dropOrb = (
  state: CsState,
  kind: CsOrb["kind"],
  x: number,
  y: number,
  value: number,
) => {
  // A crowded field folds new experience into the oldest orb on the ground.
  if (kind === "experience" && state.orbs.length >= CS_MAX_ORBS) {
    const oldest = state.orbs.find((orb) => orb.kind === "experience" && !orb.flying);
    if (oldest) {
      oldest.value += value;
      return;
    }
  }
  state.orbs.push({ id: state.nextId++, kind, x, y, value, flying: false });
};

const collectOrbs = (state: CsState) => {
  const { hero } = state;
  const range = csPickupRange(state);
  const speed = 12 / CS_TPS;
  const kept: CsOrb[] = [];
  for (const orb of state.orbs) {
    const dx = hero.x - orb.x,
      dy = hero.y + 0.3 - orb.y;
    const squared = dx * dx + dy * dy;
    if (!orb.flying && squared <= range * range) orb.flying = true;
    if (orb.flying) {
      const length = Math.sqrt(squared);
      if (length <= Math.max(0.5, speed)) {
        pickUp(state, orb);
        continue;
      }
      orb.x += (dx / length) * speed;
      orb.y += (dy / length) * speed;
    }
    kept.push(orb);
  }
  state.orbs = kept;
};

const pickUp = (state: CsState, orb: CsOrb) => {
  const { hero } = state;
  state.events.push({
    type: "pickup",
    kind: orb.kind,
    x: orb.x,
    y: orb.y,
    value: orb.value,
  });
  if (orb.kind === "onigiri") {
    hero.hp = Math.min(hero.maxHp, hero.hp + orb.value);
    return;
  }
  if (orb.kind === "talisman") {
    // A gust gathers every orb on the field.
    for (const other of state.orbs)
      if (other.kind === "experience") other.flying = true;
    return;
  }
  if (orb.kind === "scroll") {
    // An awakening takes the scroll's first pick; the rest open drafts.
    let picks = orb.value;
    const ready = csAwakenable(state)[0];
    if (ready) {
      ready.awakened = true;
      ready.readyAt = state.tick;
      state.events.push({ type: "awaken", jutsu: ready.id });
      picks--;
    }
    state.draftsQueued += picks;
    return;
  }
  hero.experience += orb.value;
  while (hero.experience >= hero.next) {
    hero.experience -= hero.next;
    hero.level++;
    hero.next = csLevelCost(state.config.stage, hero.level);
    state.draftsQueued++;
    state.events.push({ type: "level", level: hero.level });
  }
};

// Drafts

const openDraft = (state: CsState) => {
  if (state.draft || state.draftsQueued <= 0) return;
  state.draftsQueued--;
  state.draft = draftOptions(state);
};

/**
 * Three different cards: upgrades of what the hero holds, weighted above new arts, and
 * new arts while slots last. A passive that completes an awakening pair weighs double.
 */
export const draftOptions = (state: CsState): CsDraftOption[] => {
  const weighted: [CsDraftOption, number][] = [];
  const partners = new Set(
    state.jutsu.map((entry) => CS_JUTSU_INFO[entry.id].awakening.partner),
  );
  for (const id of CS_JUTSU) {
    const held = state.jutsu.find((entry) => entry.id === id);
    if (held && held.level < CS_JUTSU_INFO[id].levels.length)
      weighted.push([{ type: "jutsu", id, level: held.level + 1 }, 3]);
    else if (!held && state.jutsu.length < CS_SLOTS)
      weighted.push([{ type: "jutsu", id, level: 1 }, 2]);
  }
  for (const id of CS_PASSIVES) {
    const held = state.passives.find((entry) => entry.id === id);
    if (held && held.level < CS_PASSIVE_INFO[id].maxLevel)
      weighted.push([{ type: "passive", id, level: held.level + 1 }, 2]);
    else if (!held && state.passives.length < CS_SLOTS)
      weighted.push([{ type: "passive", id, level: 1 }, partners.has(id) ? 3 : 1.5]);
  }
  const options: CsDraftOption[] = [];
  while (options.length < 3 && weighted.length > 0) {
    const total = weighted.reduce((sum, [, weight]) => sum + weight, 0);
    let roll = state.rng.next() * total;
    const index = weighted.findIndex(([, weight]) => {
      roll -= weight;
      return roll < 0;
    });
    const [option] =
      weighted.splice(index < 0 ? weighted.length - 1 : index, 1)[0] ?? [];
    if (option) options.push(option);
  }
  // Everything trained: the hero can still mend.
  if (options.length === 0) options.push({ type: "heal" });
  return options;
};

const takeOption = (state: CsState, option: CsDraftOption) => {
  if (option.type === "heal") {
    state.hero.hp = Math.min(state.hero.maxHp, state.hero.hp + 40);
    return;
  }
  if (option.type === "jutsu") {
    const held = state.jutsu.find((entry) => entry.id === option.id);
    if (held) held.level = option.level;
    else
      state.jutsu.push({
        id: option.id,
        level: 1,
        readyAt: state.tick,
        awakened: false,
      });
    return;
  }
  const held = state.passives.find((entry) => entry.id === option.id);
  if (held) held.level = option.level;
  else state.passives.push({ id: option.id, level: 1 });
  if (option.id === "ironBody") {
    state.hero.maxHp += 20;
    state.hero.hp += 20;
  }
};

// Helpers

const clampArena = (value: number) =>
  Math.max(-CS_ARENA_HALF, Math.min(CS_ARENA_HALF, value));

/** Grid cells are one unit square; keys pack both coordinates into one number. */
const cellIndex = (gx: number, gy: number) => (gx + 512) * 1024 + (gy + 512);
const cellKey = (x: number, y: number) => cellIndex(Math.floor(x), Math.floor(y));

const touches = (shape: { x: number; y: number; radius: number }, enemy: CsEnemy) => {
  // A raider's body stands above its feet.
  const dx = shape.x - enemy.x,
    dy = shape.y - (enemy.y + enemy.radius);
  const reach = shape.radius + enemy.radius;
  return dx * dx + dy * dy <= reach * reach;
};

const enemiesWithin = (state: CsState, x: number, y: number, radius: number) =>
  state.enemies.filter((enemy) => {
    if (enemy.hp <= 0) return false;
    const dx = enemy.x - x,
      dy = enemy.y - y;
    const reach = radius + enemy.radius;
    return dx * dx + dy * dy <= reach * reach;
  });

/** The `count` nearest living raiders within `range`, nearest first. */
const nearestEnemies = (
  state: CsState,
  x: number,
  y: number,
  count: number,
  range: number,
  exclude?: Set<number>,
) => {
  const found: { enemy: CsEnemy; squared: number }[] = [];
  for (const enemy of state.enemies) {
    if (enemy.hp <= 0 || exclude?.has(enemy.id)) continue;
    const dx = enemy.x - x,
      dy = enemy.y - y;
    const squared = dx * dx + dy * dy;
    if (squared > range * range) continue;
    found.push({ enemy, squared });
  }
  found.sort((a, b) => a.squared - b.squared || a.enemy.id - b.enemy.id);
  return found.slice(0, count).map((entry) => entry.enemy);
};

const weightedPick = <T>(rng: Rng, table: [T, number][]): T | undefined => {
  const total = table.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = rng.next() * total;
  for (const [item, weight] of table) {
    roll -= weight;
    if (roll < 0) return item;
  }
  return table[table.length - 1]?.[0];
};

/** A replay in progress: a run, its log and how far through both it has come. */
export interface CsReplay {
  state: CsState;
  actions: readonly [tick: number, action: CsAction][];
  index: number;
  /** Why the log stopped replaying, if it did not fit the run. */
  invalid: string | null;
}

export const createCsReplay = (
  seed: string,
  config: CsRunConfig,
  actions: readonly [tick: number, action: CsAction][],
): CsReplay => ({ state: createCsRun(seed, config), actions, index: 0, invalid: null });

/**
 * Advance a replay by up to `maxTicks` toward `endTick`, applying each action at its
 * tick. Returns true once it has stopped: at `endTick`, when the run ends, or when the
 * log does not fit the run (`invalid` says why). Slicing never changes the result.
 */
export const advanceCsReplay = (
  replay: CsReplay,
  endTick: number,
  maxTicks: number,
) => {
  const { state, actions } = replay;
  for (let stepped = 0; ; stepped++) {
    while (replay.index < actions.length && actions[replay.index]?.[0] === state.tick) {
      const entry = actions[replay.index++];
      if (entry && !applyCsAction(state, entry[1])) {
        replay.invalid = `Action ${replay.index - 1} does not apply at tick ${state.tick}`;
        return true;
      }
    }
    state.events.length = 0;
    if (state.tick >= endTick || state.over) {
      if (replay.index < actions.length)
        replay.invalid = "The log runs past the run's end";
      return true;
    }
    if (!csCanStep(state)) {
      replay.invalid = `The log leaves a draft open at tick ${state.tick}`;
      return true;
    }
    if ((actions[replay.index]?.[0] ?? Number.POSITIVE_INFINITY) < state.tick) {
      replay.invalid = "The log runs backwards in time";
      return true;
    }
    if (stepped >= maxTicks) return false;
    stepCs(state);
  }
};

/** Replay a log in one go; throws when the log does not fit the run. */
export const replayCs = (
  seed: string,
  config: CsRunConfig,
  actions: [tick: number, action: CsAction][],
  endTick: number,
) => {
  const replay = createCsReplay(seed, config, actions);
  advanceCsReplay(replay, endTick, Number.POSITIVE_INFINITY);
  if (replay.invalid) throw new Error(replay.invalid);
  return replay.state;
};
