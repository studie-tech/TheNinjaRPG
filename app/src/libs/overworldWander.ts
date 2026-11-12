import { oddQHexDistance, oddQLineStep } from "@/libs/hexgrid";
import { BUILTIN_TERRAINS_BY_KEY } from "@/libs/sector-map/terrains";
import type {
  NormalizedSectorMap,
  NormalizedSectorTile,
} from "@/libs/sector-map/types";
import { getSectorTile } from "@/libs/sector-map/validation";

/**
 * Overworld AIs roam on a timeline derived only from their seed and the clock, so the server
 * and every client agree where an AI stands without storing or broadcasting positions.
 */

/** Milliseconds an AI takes to cross one hex. */
export const WANDER_STEP_MS = 650;
/** Fixed rest each cycle; the walk and a random pause fill the rest of it. */
const WANDER_REST_MS = 6000;
/** Members of a group set off up to this long after their leader. */
const WANDER_FOLLOW_MS = 900;
/** Members keep within this many hexes of their leader's spot. */
const MEMBER_SPREAD = [0.45, 0.9] as const;

export type WanderTile = { x: number; y: number };
type WanderMap = Pick<NormalizedSectorMap, "width" | "height" | "tiles"> &
  Partial<Pick<NormalizedSectorMap, "anchors" | "objects">>;

/**
 * Columns either side of a structure and rows behind and in front of its entrance that roaming
 * AIs keep clear of. Buildings are drawn as one plane at their entrance, so an AI on the
 * stairs or plaza would be drawn behind the building it stands on.
 */
const STRUCTURE_CLEARANCE = { columns: 2, behind: 3, front: 2 } as const;

/**
 * An open land tile a roaming AI may stand on; `wildOnly` keeps it out of villages and roads.
 * Authored water is usually zoned as wilderness, so water terrain is excluded by its kind.
 */
export const isWanderTile = (
  tile: NormalizedSectorTile | undefined,
  wildOnly: boolean,
) =>
  !!tile &&
  !tile.blocked &&
  tile.zone !== "structure" &&
  tile.zone !== "water" &&
  !BUILTIN_TERRAINS_BY_KEY.get(tile.terrain)?.isWater &&
  tile.zone !== "shrine" &&
  (!wildOnly || tile.zone === "wilderness");

const structureTileCache = new WeakMap<WanderMap, Set<number>>();
/**
 * Tiles around authored buildings and any rendered structures supplied by the navigation view.
 */
const structureTiles = (map: WanderMap) => {
  let tiles = structureTileCache.get(map);
  if (tiles) return tiles;
  tiles = new Set();
  const entrances = [
    ...(map.anchors ?? []).filter(
      (anchor) =>
        anchor.key.startsWith("shrine.") || anchor.key.startsWith("structure."),
    ),
    ...(map.objects ?? []).filter((object) =>
      ["shrine", "structure", "landmark"].includes(object.type),
    ),
  ];
  const { columns, behind, front } = STRUCTURE_CLEARANCE;
  for (const entrance of entrances)
    for (let x = entrance.x - columns; x <= entrance.x + columns; x++)
      for (let y = entrance.y - behind; y <= entrance.y + front; y++)
        if (x >= 0 && y >= 0 && x < map.width && y < map.height)
          tiles.add(y * map.width + x);
  structureTileCache.set(map, tiles);
  return tiles;
};

/** An open tile on this map that is clear of its buildings. */
export const isOpenWanderTile = (
  map: WanderMap,
  x: number,
  y: number,
  wildOnly: boolean,
) =>
  isWanderTile(getSectorTile(map, { x, y }), wildOnly) &&
  !structureTiles(map).has(y * map.width + x);

/**
 * Tiles within `radius` of the anchor that are reachable from it in a straight line, so every
 * walk can pass through the anchor without crossing a building. The anchor comes first.
 */
export const wanderSpots = (
  map: WanderMap,
  anchor: WanderTile,
  radius: number,
  wildOnly: boolean,
  villageOnly = false,
): WanderTile[] => {
  const open = (x: number, y: number) =>
    (isOpenWanderTile(map, x, y, wildOnly) &&
      (!villageOnly || getSectorTile(map, { x, y })?.zone === "village")) ||
    (x === anchor.x && y === anchor.y);
  const spots: WanderTile[] = [{ x: anchor.x, y: anchor.y }];
  if (radius < 1) return spots;
  for (let x = anchor.x - radius; x <= anchor.x + radius; x++)
    for (let y = anchor.y - radius; y <= anchor.y + radius; y++) {
      if (x === anchor.x && y === anchor.y) continue;
      const distance = oddQHexDistance(anchor.x, anchor.y, x, y);
      if (distance > radius || !open(x, y)) continue;
      let clear = true;
      for (let step = 1; step < distance && clear; step++) {
        const tile = oddQLineStep(
          { col: anchor.x, row: anchor.y },
          { col: x, row: y },
          step,
        );
        clear = open(tile.col, tile.row);
      }
      if (clear) spots.push({ x, y });
    }
  return spots;
};

/** The nearest tile a roaming AI may stand on, clear of buildings, or null when the map has none. */
export const snapToWanderTile = (
  map: WanderMap,
  position: WanderTile,
  wildOnly: boolean,
): WanderTile | null => {
  let best: WanderTile | null = null,
    bestDistance = Number.POSITIVE_INFINITY;
  for (const tile of map.tiles) {
    if (!isOpenWanderTile(map, tile.x, tile.y, wildOnly)) continue;
    const distance = oddQHexDistance(position.x, position.y, tile.x, tile.y);
    if (distance < bestDistance) {
      best = { x: tile.x, y: tile.y };
      bestDistance = distance;
      if (distance === 0) break;
    }
  }
  return best;
};

export type WanderConfig = {
  seed: string;
  anchor: WanderTile;
  radius: number;
  /** From {@link wanderSpots}; computed once per anchor. */
  spots: readonly WanderTile[];
};

/** Which wander cycle the clock is in, and how far into it. Cheap enough for every frame. */
export const wanderClock = (
  config: Pick<WanderConfig, "seed" | "radius">,
  timeMs: number,
) => {
  const base = seedHash(config.seed);
  const cycleMs = WANDER_REST_MS + 2 * Math.max(1, config.radius) * WANDER_STEP_MS * 2;
  const shifted = timeMs + (base % cycleMs);
  const cycle = Math.floor(shifted / cycleMs);
  return { cycle, into: shifted - cycle * cycleMs };
};

/**
 * One member's walk during a cycle. A walk goes straight between spots, or through the anchor
 * when the direct line is blocked. Offsets are in hexes and move each member to its own place
 * around the leader's spot, so a herd never stacks on one tile. It only changes with the cycle,
 * so renderers keep it until {@link wanderClock} moves on.
 */
export const wanderLeg = (config: WanderConfig, member: number, cycle: number) => {
  const { anchor, radius, spots } = config;
  const base = seedHash(config.seed);
  const cycleMs = WANDER_REST_MS + 2 * Math.max(1, radius) * WANDER_STEP_MS * 2;
  const from = spotFor(spots, base, cycle - 1),
    to = spotFor(spots, base, cycle);
  const via = clearLine(spots, from, to) ? null : anchor;
  const steps = via
    ? oddQHexDistance(from.x, from.y, via.x, via.y) +
      oddQHexDistance(via.x, via.y, to.x, to.y)
    : oddQHexDistance(from.x, from.y, to.x, to.y);
  const walkMs = steps * WANDER_STEP_MS;
  const slack = Math.max(0, cycleMs - walkMs - WANDER_FOLLOW_MS - WANDER_REST_MS);
  return {
    from,
    to,
    via,
    departAt:
      unit(mix(base, cycle, 7)) * slack +
      (member
        ? 250 + unit(mix(base, cycle, member + 11)) * (WANDER_FOLLOW_MS - 250)
        : 0),
    walkMs: walkMs * memberPace(base, member),
    fromOffset: memberOffset(base, cycle - 1, member),
    toOffset: memberOffset(base, cycle, member),
  };
};

export type WanderLeg = ReturnType<typeof wanderLeg>;

/** Share of a leg walked `into` its cycle. */
export const wanderProgress = (leg: WanderLeg, into: number) =>
  leg.walkMs ? Math.min(1, Math.max(0, (into - leg.departAt) / leg.walkMs)) : 1;

/** Where one member of a roaming group is at `timeMs`. */
export const wanderPose = (config: WanderConfig, member: number, timeMs: number) => {
  const { cycle, into } = wanderClock(config, timeMs);
  const leg = wanderLeg(config, member, cycle);
  const progress = wanderProgress(leg, into);
  return { ...leg, progress, moving: progress > 0 && progress < 1 };
};

export type WanderPose = ReturnType<typeof wanderPose>;

/** The hex a pose stands on, stepping along the walk's straight line (or its two legs). */
export const wanderPoseTile = (pose: WanderPose): WanderTile => {
  const along = (from: WanderTile, to: WanderTile, steps: number) => {
    const tile = oddQLineStep(
      { col: from.x, row: from.y },
      { col: to.x, row: to.y },
      steps,
    );
    return { x: tile.col, y: tile.row };
  };
  const { from, to, via, progress } = pose;
  if (!via) {
    const distance = oddQHexDistance(from.x, from.y, to.x, to.y);
    return along(from, to, Math.round(progress * distance));
  }
  const first = oddQHexDistance(from.x, from.y, via.x, via.y);
  const second = oddQHexDistance(via.x, via.y, to.x, to.y);
  const steps = Math.round(progress * (first + second));
  return steps <= first ? along(from, via, steps) : along(via, to, steps - first);
};

/** Size of one group, fixed per copy so a herd keeps its members all day. */
export const wanderGroupSize = (
  seed: string,
  groupMin: number,
  groupMax: number,
): number => {
  const low = Math.max(1, Math.min(groupMin, groupMax));
  const high = Math.max(low, groupMax);
  return low + (mix(hashString(seed), 0, 3) % (high - low + 1));
};

/** Per-copy seed; it changes with the placement's daily reroll so herds start fresh. */
export const wanderSeed = (
  placementId: string,
  positionVersion: number,
  copy: number,
) => `${placementId}:${positionVersion}:${copy}`;

const spotFor = (spots: readonly WanderTile[], base: number, cycle: number) =>
  spots[mix(base, cycle, 1) % spots.length] as WanderTile;

/** Whether every hex between two spots is itself a spot, so the walk crosses open ground. */
const clearLine = (spots: readonly WanderTile[], from: WanderTile, to: WanderTile) => {
  const distance = oddQHexDistance(from.x, from.y, to.x, to.y);
  for (let step = 1; step < distance; step++) {
    const tile = oddQLineStep(
      { col: from.x, row: from.y },
      { col: to.x, row: to.y },
      step,
    );
    if (!spots.some((spot) => spot.x === tile.col && spot.y === tile.row)) return false;
  }
  return true;
};

const memberOffset = (base: number, cycle: number, member: number) => {
  if (!member) return { x: 0, y: 0 };
  // Golden-angle steps spread followers around the leader without stacking.
  const angle = member * 2.39996 + (unit(mix(base, cycle, member + 31)) - 0.5) * 0.9;
  const radius =
    MEMBER_SPREAD[0] +
    unit(mix(base, cycle, member + 53)) * (MEMBER_SPREAD[1] - MEMBER_SPREAD[0]);
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius * 0.6 };
};

/** Followers walk a little slower or faster, so a herd strings out on the way. */
const memberPace = (base: number, member: number) =>
  member ? 0.9 + unit(mix(base, member, 71)) * 0.25 : 1;

const seedHashes = new Map<string, number>();
/** {@link hashString} of a seed, remembered since renderers ask for it every frame. */
const seedHash = (seed: string) => {
  let hash = seedHashes.get(seed);
  if (hash === undefined) {
    hash = hashString(seed);
    if (seedHashes.size > 4096) seedHashes.clear();
    seedHashes.set(seed, hash);
  }
  return hash;
};

/** FNV-1a; deterministic across server and browsers. */
const hashString = (value: string) => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

/** Integer mix of a seed, a cycle and a salt (a murmur3 finaliser). */
const mix = (base: number, cycle: number, salt: number) => {
  let hash = (base ^ Math.imul(cycle, 0x9e3779b1) ^ Math.imul(salt, 0x85ebca6b)) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
  return (hash ^ (hash >>> 16)) >>> 0;
};

const unit = (value: number) => value / 0x100000000;
