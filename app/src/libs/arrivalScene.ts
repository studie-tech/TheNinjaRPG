import {
  ARRIVAL_PUP_AI_ID,
  BLACKSTEEL_COURIER_AI_ID,
  BLACKSTEEL_DOUBLE_AI_ID,
} from "@/drizzle/constants";
import { oddQHexDistance } from "@/libs/hexgrid";
import { getNeighborCoordinates, getSectorTileKey } from "@/libs/sector-map/validation";
import type { NpcWalk, SectorUser } from "@/libs/sector-map/world-types";
import type { CharacterAnimation } from "@/libs/spriteAnimations";
import type { SpriteAppearance } from "@/validators/lpc";

/** Where the player stands in the opening of the Academy Trials, as the map stages it. */
export type ArrivalSceneKind = "greeting" | "ambush" | "standoff";

/** A hex tile of the sector the scene plays in. */
type Tile = { x: number; y: number };

/** The figures of the opening: Lemu, the pup, its hunter and the hunter's double. */
export type CastRole = "lemu" | "pup" | "courier" | "double";

/** One figure: when it is on the map, and the walk or tile it keeps there. */
type CastEntry = { role: CastRole; from: number; until: number; walk: NpcWalk };

/** A figure's words, which the scene says and when; the lesson supplies Lemu's. */
export type ArrivalLineId = "greeting" | "warning" | "yelp" | "order" | "challenge";
export type ArrivalLine = {
  id: ArrivalLineId;
  role: CastRole;
  from: number;
  until: number;
};

export type ArrivalScene = {
  kind: ArrivalSceneKind;
  cast: CastEntry[];
  lines: ArrivalLine[];
  /** Tile the lesson points at: the ground beside Lemu, or where the double appears. */
  marker: Tile;
  /** Milliseconds from the start: the smoke, and the moment the player answers. */
  smokeAt: number;
  endsAt: number;
};

/** Milliseconds a fleeing pup, its hunter and Lemu take for one tile. */
const PUP_STEP_MS = 220;
const COURIER_STEP_MS = 230;
const FLIGHT_STEP_MS = 180;
const LEMU_STEP_MS = 260;
/** Lemu speaks up once the flash has swelled. */
const WARNING_AT = 400;
/** The pup yelps while it crosses in front of the player. */
const YELP_FROM = 1200;
const YELP_UNTIL = 3600;
/** The flash comes first; then the pup, and its hunter close behind. */
const PUP_STARTS_AT = 700;
const COURIER_STARTS_AT = 1900;
/** The hunter stops for one breath to raise the double. */
const COURIER_PAUSE_MS = 1400;
const SMOKE_DELAY_MS = 350;
const DOUBLE_DELAY_MS = 600;
/** Tiles from the player that the chase comes from and leaves to, past the map's edge of view. */
const CHASE_TILES = 11;

/**
 * Stages the opening around the player on tiles that are open ground: a greeting with
 * Lemu a short walk away, the chase past the player that leaves the double in their way,
 * or the double waiting for a rematch. Figures stand where no scenery covers them, as far
 * as there are such tiles. Undefined where there is no room for the scene.
 */
export const planArrivalScene = (info: {
  kind: ArrivalSceneKind;
  player: Tile;
  isOpen: (tile: Tile) => boolean;
  isCovered: (tile: Tile) => boolean;
  startAt: number;
  previousLemu?: Tile;
}): ArrivalScene | undefined => {
  const { kind, player, isOpen, isCovered, startAt, previousLemu } = info;
  const key = (tile: Tile) => getSectorTileKey(tile.x, tile.y);
  const distance = (a: Tile, b: Tile) => oddQHexDistance(a.x, a.y, b.x, b.y);
  // Reachable open ground by walking distance from the player.
  const reach = walkFrom(player, isOpen, CHASE_TILES);
  const tiles = [...reach.values()].map((entry) => entry.tile);
  const best = (
    candidates: readonly Tile[],
    score: (tile: Tile) => number,
  ): Tile | undefined =>
    candidates.reduce<Tile | undefined>(
      (found, tile) => (!found || score(tile) < score(found) ? tile : found),
      undefined,
    );
  /** Extra cost of a standing tile: scenery over it, and rows away from the player's. */
  const standing = (tile: Tile) =>
    (isCovered(tile) ? 20 : 0) + Math.abs(tile.y - player.y) * 3;
  const still = (tile: Tile): NpcWalk => ({ tiles: [tile], startAt, stepMs: 1 });
  const always = (role: CastRole, tile: Tile): CastEntry => ({
    role,
    from: 0,
    until: Number.POSITIVE_INFINITY,
    walk: still(tile),
  });

  const says = (
    role: CastRole,
    id: ArrivalLineId,
    from = 0,
    until = Number.POSITIVE_INFINITY,
  ): ArrivalLine => ({ id, role, from, until });

  if (kind === "greeting") {
    const lemu = best(
      tiles.filter((tile) => distance(tile, player) === 3),
      standing,
    );
    const marker =
      lemu &&
      best(
        getNeighborCoordinates(lemu).filter(
          (tile) => reach.has(key(tile)) && distance(tile, player) === 2,
        ),
        standing,
      );
    if (!marker || !lemu) return undefined;
    return {
      kind,
      cast: [always("lemu", lemu)],
      lines: [says("lemu", "greeting")],
      marker,
      smokeAt: 0,
      endsAt: 0,
    };
  }

  // The double stands two tiles away, to the east if it can: between player and ridge.
  const double = best(
    tiles.filter((tile) => distance(tile, player) === 2),
    (tile) => standing(tile) - (tile.x - player.x),
  );
  if (!double) return undefined;
  // Lemu keeps at the player's side, away from the double.
  const sides = getNeighborCoordinates(player).filter(
    (tile) => reach.has(key(tile)) && distance(tile, double) >= 2,
  );
  const lemu =
    previousLemu && sides.some((tile) => key(tile) === key(previousLemu))
      ? previousLemu
      : best(sides, (tile) => standing(tile) + (tile.x - player.x));
  if (!lemu) return undefined;

  if (kind === "standoff") {
    return {
      kind,
      cast: [always("lemu", lemu), always("double", double)],
      lines: [says("lemu", "challenge")],
      marker: double,
      smokeAt: 0,
      endsAt: 0,
    };
  }

  // The chase crosses in front of the player and Lemu, from the east edge to the west.
  const isFree = (tile: Tile) =>
    isOpen(tile) && key(tile) !== key(player) && key(tile) !== key(lemu);
  const ground = walkFrom(double, isFree, CHASE_TILES + 2);
  const far = (direction: 1 | -1) =>
    best(
      [...ground.values()].map((entry) => entry.tile),
      (tile) => -direction * (tile.x - player.x) * 4 + Math.abs(tile.y - player.y),
    );
  const east = far(1);
  const west = far(-1);
  const arrival = east && pathTo(ground, east).reverse();
  const flight = west && pathTo(ground, west);
  if (!arrival || !flight || arrival.length < 3 || flight.length < 3) return undefined;

  const pupPath = [...arrival, ...flight.slice(1)];
  const pupWalk = {
    tiles: pupPath,
    startAt: startAt + PUP_STARTS_AT,
    stepMs: PUP_STEP_MS,
  };
  const courierWalk = {
    tiles: arrival,
    startAt: startAt + COURIER_STARTS_AT,
    stepMs: COURIER_STEP_MS,
  };
  const reached = COURIER_STARTS_AT + (arrival.length - 1) * COURIER_STEP_MS;
  const leaves = reached + COURIER_PAUSE_MS;
  const flightEnds = leaves + (flight.length - 1) * FLIGHT_STEP_MS;
  const lemuPath =
    previousLemu && reach.has(key(previousLemu))
      ? pathTo(walkFrom(previousLemu, isOpen, CHASE_TILES), lemu)
      : [];
  return {
    kind,
    cast: [
      {
        role: "lemu",
        from: 0,
        until: Number.POSITIVE_INFINITY,
        walk: lemuPath.length
          ? { tiles: lemuPath, startAt: startAt + PUP_STARTS_AT, stepMs: LEMU_STEP_MS }
          : still(lemu),
      },
      {
        role: "pup",
        from: 0,
        until: PUP_STARTS_AT + (pupPath.length - 1) * PUP_STEP_MS,
        walk: pupWalk,
      },
      { role: "courier", from: 0, until: leaves, walk: courierWalk },
      {
        role: "courier",
        from: leaves,
        until: flightEnds,
        walk: { tiles: flight, startAt: startAt + leaves, stepMs: FLIGHT_STEP_MS },
      },
      {
        role: "double",
        from: reached + DOUBLE_DELAY_MS,
        until: Number.POSITIVE_INFINITY,
        walk: still(double),
      },
    ],
    lines: [
      says("lemu", "warning", WARNING_AT, reached - 200),
      says("pup", "yelp", PUP_STARTS_AT + YELP_FROM, PUP_STARTS_AT + YELP_UNTIL),
      says("courier", "order", reached, leaves + 100),
      says("lemu", "challenge", leaves + 400),
    ],
    marker: double,
    smokeAt: reached + SMOKE_DELAY_MS,
    endsAt: leaves + 400,
  };
};

/** Where an actor on a walk stands at `now`, between two of its tiles. */
export const npcWalkPose = (walk: NpcWalk, now: number) => {
  const last = walk.tiles.length - 1;
  const progress = Math.max(0, Math.min(last, (now - walk.startAt) / walk.stepMs));
  const index = Math.min(Math.max(0, last - 1), Math.floor(progress));
  const from = walk.tiles[index];
  const to = walk.tiles[Math.min(last, index + 1)];
  if (!from || !to) return null;
  return {
    from,
    to,
    progress: from === to ? 0 : progress - index,
    isMoving: progress > 0 && progress < last,
  };
};

/** What the figures other than Lemu say. */
export const ARRIVAL_LINES = {
  yelp: "Yip! Yip!",
  order: "Hold them here.",
} as const;

/** The map actor key of a scene's figure, which speech and lessons hold on to. */
export const arrivalActorKey = (role: CastRole) => `npc:story-${role}:0:0`;

/** The artwork one figure wears on the map. */
export type ArrivalCastArt = {
  avatar: string | null;
  sheets?: { idle?: CharacterAnimation; move?: CharacterAnimation };
};

/**
 * The scene's figures on the map at `elapsed` milliseconds, as map actors only this
 * player sees: scenery without controls, drawn whatever the map's filters hide. Reduced
 * motion shows only how the scene ends.
 */
export const arrivalSceneActors = (
  scene: ArrivalScene,
  elapsed: number,
  art: Partial<Record<string, ArrivalCastArt>>,
  sector: number,
): SectorUser[] =>
  scene.cast.flatMap((entry) => {
    if (elapsed < entry.from || elapsed >= entry.until) return [];
    const aiId = CAST_AI_IDS[entry.role];
    const look = aiId ? art[aiId] : undefined;
    if (aiId && !look) return [];
    // Every figure is anchored where the scene happens: the renderer culls by the anchor, and
    // a chase ends out of view.
    return [
      {
        userId: `story-${entry.role}`,
        username: CAST_NAMES[entry.role],
        curHealth: 1,
        maxHealth: 1,
        avatar: look?.avatar ?? null,
        avatarLight: null,
        sector,
        longitude: scene.marker.x,
        latitude: scene.marker.y,
        location: null,
        villageId: null,
        level: 1,
        rank: "STUDENT" as const,
        isOutlaw: false,
        isBanned: false,
        immunityUntil: NEVER,
        robImmunityUntil: NEVER,
        updatedAt: NEVER,
        allianceStatus: "NEUTRAL" as const,
        status: "AWAKE" as const,
        battleId: null,
        isNpc: true,
        isStoryActor: true,
        npcPlacementId: `story-${entry.role}`,
        npcInteractionType: "AMBIENT" as const,
        npcWalk: entry.walk,
        ...(look?.sheets ? { npcSheets: look.sheets } : {}),
        ...(entry.role === "lemu" ? { spriteAppearance: LEMU_APPEARANCE } : {}),
        ...(entry.role === "pup" ? { npcScale: 0.65 } : {}),
      },
    ];
  });

const NEVER = new Date(0);

/** AI whose map artwork each figure wears; Lemu is a layered character. */
const CAST_AI_IDS: Record<CastRole, string | undefined> = {
  lemu: undefined,
  pup: ARRIVAL_PUP_AI_ID,
  courier: BLACKSTEEL_COURIER_AI_ID,
  double: BLACKSTEEL_DOUBLE_AI_ID,
};

export const CAST_NAMES: Record<CastRole, string> = {
  lemu: "Lemu",
  pup: "Frightened pup",
  courier: "Masked figure",
  double: "Smoke double",
};

/** Lemu as a map character, after the portrait; her violet is a tint over white hair. */
const LEMU_APPEARANCE: SpriteAppearance = {
  version: 1,
  body: "female",
  layers: [
    { slot: "body", profile: "body", color: "light" },
    { slot: "shirt", profile: "leather", color: "purple" },
    { slot: "legs", profile: "leggings", color: "black" },
    { slot: "feet", profile: "boots", color: "black" },
    { slot: "head", profile: "head-soft", color: "light", eyes: "blue" },
    { slot: "hair", profile: "hair-long", color: "white", tint: 0x8a55d8 },
    { slot: "gloves", profile: "gloves", color: "red" },
    { slot: "armarmour", profile: "armarmour", color: "red" },
    { slot: "belt", profile: "belt", color: "red" },
    { slot: "mask", profile: "mask", color: "black" },
  ],
};

/** Open tiles within `range` steps of `start`, each with the tile it was reached from. */
const walkFrom = (start: Tile, isOpen: (tile: Tile) => boolean, range: number) => {
  const key = (tile: Tile) => getSectorTileKey(tile.x, tile.y);
  const reached = new Map<string, { tile: Tile; from?: Tile }>([
    [key(start), { tile: start }],
  ]);
  let edge = [start];
  for (let step = 0; step < range && edge.length; step++) {
    const next: Tile[] = [];
    for (const tile of edge)
      for (const neighbor of getNeighborCoordinates(tile)) {
        if (reached.has(key(neighbor)) || !isOpen(neighbor)) continue;
        reached.set(key(neighbor), { tile: neighbor, from: tile });
        next.push(neighbor);
      }
    edge = next;
  }
  return reached;
};

/** The tiles from the start of a `walkFrom` to one of the tiles it reached. */
const pathTo = (reached: ReturnType<typeof walkFrom>, target: Tile): Tile[] => {
  const path: Tile[] = [];
  let entry = reached.get(getSectorTileKey(target.x, target.y));
  while (entry) {
    path.unshift(entry.tile);
    entry = entry.from && reached.get(getSectorTileKey(entry.from.x, entry.from.y));
  }
  return path;
};
