/**
 * A scripted player for tower-defense tests: buys upgrades, drafts perks, dodges
 * telegraphs, casts seal arts and ultimates, places tags and grabs loot. It exercises
 * every recorded action kind so replay tests cover them, and gives balance tests a
 * reasonable stand-in for a player.
 */
import alea from "alea";
import { TD_COORD_SCALE, TD_HERO_ZONE } from "@/libs/towerDefense/balance";
import {
  TD_DOJO,
  TD_DOJO_INFO,
  type TD_JUTSU,
  TD_SEAL_ART_INFO,
  TD_SEALS,
  TD_SENTRIES,
  TD_ULTIMATES,
  type TdDojoLevels,
  type TdPerk,
  type TdSealArt,
  type TdSentry,
  type TdShopItem,
} from "@/libs/towerDefense/content";
import { appendToLog, createLogWriter, encodedLog } from "@/libs/towerDefense/savedRun";
import {
  advanceReplay,
  applyAction,
  createReplay,
  createRun,
  stepRun,
  TD_TARGET_MODES,
  type TdAction,
  type TdCommand,
  type TdReplayOptions,
  type TdReplayResult,
  type TdRunConfig,
  type TdState,
  tdJutsuUnlocked,
  tdSealArtUnlocked,
  tdSentryCost,
  tdShopCost,
  tdUltimateUnlocked,
} from "@/libs/towerDefense/sim";

interface BotOptions {
  /** Chance per tick of acting on actives at all (lower = lazier player). */
  attention?: number;
  /** Extra random noise actions, for fuzzing. */
  chaos?: number;
  rng?: () => number;
}

const SHOP_WEIGHTS: Partial<Record<TdShopItem, number>> = {
  damage: 3,
  health: 2.2,
  rate: 1.6,
  regen: 1,
  crit: 1,
  block: 0.8,
  range: 0.6,
  ryo: 0.8,
  chakra: 0.3,
  jutsu_fire: 1.2,
  jutsu_lightning: 1.2,
  jutsu_water: 1,
  jutsu_wind: 1,
  jutsu_earth: 1,
};

const PERK_PRIORITY: TdPerk[] = [
  "evolve_fire",
  "evolve_lightning",
  "evolve_earth",
  "evolve_water",
  "evolve_wind",
  "sharp_steel",
  "glass_cannon",
  "iron_body",
  "jutsu_focus",
  "quick_hands",
  "keen_eye",
  "second_wind",
  "exploding_kunai",
  "executioner",
  "twin_throw",
  "ricochet",
  "engineer",
];

const SENTRY_ORDER: TdSentry[] = ["kunai", "mortar", "rod", "frost", "sensor", "kunai"];

/** Decide and apply this tick's actions; returns them stamped with the tick. */
export const botAct = (state: TdState, options: BotOptions = {}): TdAction[] => {
  const random = options.rng ?? Math.random;
  const attention = options.attention ?? 1;
  const taken: TdAction[] = [];
  const act = (command: TdCommand) => {
    const action = [state.tick, ...command] as TdAction;
    if (applyAction(state, action)) taken.push(action);
  };
  const point = (x: number, y: number) =>
    [Math.round(x * TD_COORD_SCALE), Math.round(y * TD_COORD_SCALE)] as const;

  if (options.chaos && random() < options.chaos) act(randomCommand(state, random));

  if (state.offer) {
    let index = 0;
    for (const id of PERK_PRIORITY) {
      const found = state.offer.indexOf(id);
      if (found >= 0) {
        index = found;
        break;
      }
    }
    if (
      state.rerolls > 0 &&
      index === 0 &&
      !PERK_PRIORITY.includes(state.offer[0] as TdPerk)
    )
      act(["reroll"]);
    else act(["perk", index]);
    if (state.offer) act(["perk", 0]);
  }

  // Spread big windfalls at once, then shop a few times per second
  if (state.tick % 97 === 0) act(["spend"]);
  if (state.tick % 131 === 0) act(["max", "health"]);
  if (state.tick % 5 === 0) {
    for (let guard = 0; guard < 25; guard++) {
      let best: TdCommand | null = null,
        bestScore = Number.POSITIVE_INFINITY,
        bestCost = 0;
      for (const [item, weight] of Object.entries(SHOP_WEIGHTS) as [
        TdShopItem,
        number,
      ][]) {
        if (item.startsWith("jutsu_")) {
          const jutsu = item.slice(6) as (typeof TD_JUTSU)[number];
          if (!tdJutsuUnlocked(state.config, jutsu)) continue;
        }
        const cost = tdShopCost(state, item);
        if (cost / weight < bestScore) {
          best = ["buy", item];
          bestScore = cost / weight;
          bestCost = cost;
        }
      }
      for (let slot = 0; slot < state.stats.sentrySlots; slot++) {
        const sentry = state.sentries[slot];
        const cost = sentry
          ? tdSentryCost(sentry.type, sentry.level + 1)
          : tdSentryCost(SENTRY_ORDER[slot] ?? "kunai");
        const score = cost / (sentry ? 1.5 : 4);
        if (score < bestScore) {
          best = sentry
            ? ["upgrade", slot]
            : ["build", slot, SENTRY_ORDER[slot] ?? "kunai"];
          bestScore = score;
          bestCost = cost;
        }
      }
      if (!best || bestCost > state.ryo) break;
      act(best);
    }
  }

  if (state.over || state.offer || random() > attention) return taken;
  const hero = state.hero;

  // Dodge: blink out of telegraphs, or substitute when a hit is imminent.
  const threat = state.telegraphs.find(
    (telegraph) =>
      telegraph.damage > 0 &&
      telegraph.due - state.tick <= 4 &&
      Math.hypot(hero.x - telegraph.x, hero.y - telegraph.y) <= telegraph.radius,
  );
  if (threat) {
    const dx = hero.x - threat.x || 1,
      dy = hero.y - threat.y;
    const length = Math.hypot(dx, dy) || 1;
    const target = { x: (dx / length) * TD_HERO_ZONE, y: (dy / length) * TD_HERO_ZONE };
    if (state.tick >= hero.blinkReadyAt) act(["blink", ...point(target.x, target.y)]);
    else if (threat.due - state.tick <= 2) act(["sub"]);
  }
  const bomber = state.enemies.some(
    (enemy) =>
      enemy.kind === "bomber" && Math.hypot(enemy.x - hero.x, enemy.y - hero.y) < 1.6,
  );
  if (
    bomber ||
    state.shots.some((shot) => shot.telegraphed && shot.due - state.tick <= 1)
  )
    act(["sub"]);

  // Grab loot and mark the toughest support enemy.
  for (const item of [...state.loot]) act(["loot", item.id]);
  if (!state.focusId) {
    const medic = state.enemies.find((enemy) => enemy.kind === "medic" || enemy.boss);
    if (medic) act(["focus", medic.id]);
  }

  const crowd = densestPoint(state);
  if (crowd) {
    for (const ultimate of TD_ULTIMATES)
      if (
        tdUltimateUnlocked(state.config, ultimate) &&
        state.tick >= (state.ultReadyAt[ultimate] ?? 0)
      )
        act(["ult", ultimate, ...point(crowd.x, crowd.y)]);
    if (hero.trapCharges > 0 && state.tick % 20 === 0)
      act(["trap", ...point(crowd.x * 0.7, crowd.y * 0.7)]);
    const art = chooseArt(state);
    if (art && hero.seals.length === 0)
      for (const seal of TD_SEAL_ART_INFO[art].seals)
        act(["seal", seal, ...point(crowd.x, crowd.y)]);
  }
  if (
    state.hero.hp < state.stats.maxHp * 0.35 &&
    tdSealArtUnlocked(state.config, "mystic_palm")
  )
    for (const seal of TD_SEAL_ART_INFO.mystic_palm.seals) act(["seal", seal, 0, 0]);
  if (state.waveTick > 200 && state.enemies.length < 3 && state.spawnQueue.length === 0)
    act(["call"]);
  return taken;
};

const chooseArt = (state: TdState): TdSealArt | null => {
  const order: TdSealArt[] = [
    "thunder_strike",
    "dragon_flame",
    "cyclone",
    "water_prison",
  ];
  for (const art of order)
    if (
      tdSealArtUnlocked(state.config, art) &&
      state.hero.chakra >= TD_SEAL_ART_INFO[art].chakra + 15
    )
      return art;
  return null;
};

const densestPoint = (state: TdState) => {
  let best: { x: number; y: number } | null = null,
    bestCount = 0;
  for (const enemy of state.enemies.slice(0, 40)) {
    let count = 0;
    for (const other of state.enemies)
      if (Math.hypot(enemy.x - other.x, enemy.y - other.y) < 2.5) count++;
    if (count > bestCount) {
      best = { x: enemy.x, y: enemy.y };
      bestCount = count;
    }
  }
  return best;
};

/** A random, possibly invalid, command for fuzzing. */
const randomCommand = (state: TdState, random: () => number): TdCommand => {
  const coordinate = () => Math.round((random() * 24 - 12) * TD_COORD_SCALE);
  const pick = <T>(items: readonly T[]) =>
    items[Math.floor(random() * items.length)] as T;
  const enemyId =
    state.enemies.length > 0 ? pick(state.enemies).id : Math.floor(random() * 50);
  const options: (() => TdCommand)[] = [
    () => ["buy", pick(Object.keys(SHOP_WEIGHTS) as TdShopItem[])],
    () => ["max", pick(Object.keys(SHOP_WEIGHTS) as TdShopItem[])],
    () => ["spend"],
    () => ["build", Math.floor(random() * 7), pick(TD_SENTRIES)],
    () => ["upgrade", Math.floor(random() * 7)],
    () => ["sell", Math.floor(random() * 7)],
    () => ["ult", pick(TD_ULTIMATES), coordinate(), coordinate()],
    () => ["perk", Math.floor(random() * 5)],
    () => ["reroll"],
    () => ["aim", pick(TD_TARGET_MODES)],
    () => ["focus", enemyId],
    () => ["blink", coordinate(), coordinate()],
    () => ["sub"],
    () => ["seal", pick(TD_SEALS), coordinate(), coordinate()],
    () => ["trap", coordinate(), coordinate()],
    () => ["loot", state.loot[0]?.id ?? Math.floor(random() * 100)],
    () => ["call"],
    () => ["auto", random() < 0.5 ? 0 : 1],
  ];
  return pick(options)();
};

/** Every Dojo upgrade at the same share of its maximum level. */
export const veteranDojo = (scale: number): TdDojoLevels =>
  Object.fromEntries(
    TD_DOJO.map((id) => [
      id,
      Math.min(TD_DOJO_INFO[id].max, Math.ceil(TD_DOJO_INFO[id].max * scale)),
    ]),
  );

/**
 * Play a run with the bot until the hero falls or `ticks` pass, then retreat if asked
 * to; returns the final state and the log of accepted actions.
 */
export const playBotRun = (
  config: TdRunConfig,
  options: { seed: number; ticks: number; attention?: number; retreat?: boolean },
) => {
  const state = createRun(config);
  const rng = alea(options.seed);
  const log: TdAction[] = [];
  while (!state.over && state.tick < options.ticks) {
    log.push(...botAct(state, { rng, attention: options.attention }));
    stepRun(state);
  }
  if (options.retreat && !state.over) {
    const quit: TdAction = [state.tick, "quit"];
    applyAction(state, quit);
    log.push(quit);
  }
  return { state, log };
};

/** A log in its claim encoding, written the way the page records it. */
export const encodeLog = (actions: readonly TdAction[]) => {
  const log = createLogWriter();
  for (const action of actions) appendToLog(log, action);
  return encodedLog(log);
};

/**
 * Replay a recorded log up to `endTick`. Actions must be in non-decreasing tick order;
 * a run waiting on a draft with no further action at its tick stops short of it.
 */
export const replayRun = (
  config: TdRunConfig,
  actions: readonly TdAction[],
  endTick: number,
  options: TdReplayOptions = {},
) => advanceReplay(createReplay(config, actions), endTick, options) as TdReplayResult;

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
