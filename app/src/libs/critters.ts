/**
 * Wildlife that wanders the travel map. Simulation is client-side and visual only: each
 * sector seeds its own groups from its habitats, so no request or shared state is needed.
 */

/** One left-facing sheet drawn row-major, as Sprite Studio prepares them. */
export type CritterClip = {
  url: string;
  columns: number;
  rows: number;
  frameCount: number;
  fps: number;
};

export type CritterSpecies = {
  id: CritterSpeciesId;
  /** Terrain keys whose open tiles the species spawns on and wanders across. */
  habitats: readonly CritterHabitat[];
  /** Relative chance among species sharing a habitat. */
  weight: number;
  /** Inclusive group size; herds move together, loners keep to themselves. */
  group: readonly [number, number];
  /** Rendered height in tile heights, feet to top of the sheet cell. */
  height: number;
  /** Cruising speed in tile widths per second. */
  speed: number;
  /** Seconds spent idling between walks. */
  rest: readonly [number, number];
  /** How far from its home the group wanders, in tile widths. */
  range: number;
  move: CritterClip;
  idle: CritterClip;
};

export const CRITTER_HABITATS = ["ground", "snow", "ice", "dessert"] as const;
export const CRITTER_SPECIES_IDS = [
  "deer",
  "boar",
  "rabbit",
  "fox",
  "camel",
  "icebear",
  "reindeer",
] as const;
export type CritterSpeciesId = (typeof CRITTER_SPECIES_IDS)[number];
export type CritterHabitat = (typeof CRITTER_HABITATS)[number];

const MOVE_GRID = { columns: 8, rows: 2, frameCount: 16, fps: 12.5 } as const;
const IDLE_GRID = { columns: 8, rows: 3, frameCount: 24, fps: 12.5 } as const;
const sheets = (move: string, idle: string) => ({
  move: { url: move, ...MOVE_GRID },
  idle: { url: idle, ...IDLE_GRID },
});

export const CRITTER_SPECIES: Record<CritterSpeciesId, CritterSpecies> = {
  deer: {
    id: "deer",
    habitats: ["ground"],
    weight: 3,
    group: [3, 5],
    height: 0.95,
    speed: 0.9,
    rest: [4, 10],
    range: 5,
    ...sheets(
      "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJvBeeXxEmSnXwslYEpV1yOeNL8gMtqhjPdf36",
      "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJOWB6MbVHevxIThUauQkGJEBY3D2cPqy8f5sp",
    ),
  },
  boar: {
    id: "boar",
    habitats: ["ground"],
    weight: 2,
    group: [2, 3],
    height: 0.55,
    speed: 0.75,
    rest: [3, 8],
    range: 4,
    ...sheets(
      "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJtPakwnUYJDfpFXWm3nrcPluEtIZqyLkaSV1j",
      "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJoYVBsNQZ9MPZpHJ7VliuEWDfATdxhv62SXnm",
    ),
  },
  rabbit: {
    id: "rabbit",
    habitats: ["ground"],
    weight: 3,
    group: [1, 2],
    height: 0.32,
    speed: 1.1,
    rest: [2, 6],
    range: 3,
    ...sheets(
      "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJvI2J2jEmSnXwslYEpV1yOeNL8gMtqhjPdf36",
      "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJcIIB4CSnxBpQqGNDcTHbLmYz8uXAl3oa54ti",
    ),
  },
  fox: {
    id: "fox",
    habitats: ["ground"],
    weight: 2,
    group: [1, 1],
    height: 0.5,
    speed: 1,
    rest: [3, 7],
    range: 6,
    ...sheets(
      "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJA2bLR1oZUC4muiGcQNzjfEndY5y1w20B8hTW",
      "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJPyc5HHpKeUGyX2kj6u45AOQiSa1zYH0mqZoc",
    ),
  },
  camel: {
    id: "camel",
    habitats: ["dessert"],
    weight: 3,
    group: [2, 4],
    height: 1.1,
    speed: 0.6,
    rest: [5, 11],
    range: 5,
    ...sheets(
      "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJ2ZQuVznMXlcRpYmJ5do0zKw4Qx6PVEtBa9b8",
      "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJXnYklaqIOpAoLKbZ4nW9Rsil2V67yuFwQhqv",
    ),
  },
  icebear: {
    id: "icebear",
    habitats: ["snow", "ice"],
    weight: 2,
    group: [1, 1],
    height: 1.1,
    speed: 0.55,
    rest: [5, 12],
    range: 6,
    ...sheets(
      "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJtxfxceUYJDfpFXWm3nrcPluEtIZqyLkaSV1j",
      "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJ4MkZ2elYIif5CL8BKvMsOh2ZnmS7yHt0jTD3",
    ),
  },
  reindeer: {
    id: "reindeer",
    habitats: ["snow", "ice"],
    weight: 3,
    group: [3, 5],
    height: 0.95,
    speed: 0.8,
    rest: [4, 10],
    range: 5,
    ...sheets(
      "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJmscIt3HE4IMO5Goa7cgLxPJ0VC6lU8vbt1Ap",
      "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJMLxYXGtsO4cexqW2RDgkE3zZbNXSFGitmnar",
    ),
  },
};

/**
 * Seed a sector's groups on open tiles. Each group keeps a home and wanders only among the
 * spots within its range, so herds stay in their meadow instead of drifting through villages.
 */
export const planCritterGroups = (options: {
  key: string;
  spots: readonly CritterSpot[];
  tile: { width: number; height: number };
  maxGroups: number;
  maxMembers: number;
  random: () => number;
}): CritterGroup[] => {
  const { spots, tile, random } = options;
  const groups: CritterGroup[] = [];
  let members = 0;
  const open = spots.filter((spot) => spot.habitat in HABITAT_SPECIES);
  for (let index = 0; index < options.maxGroups && open.length; index++) {
    const home = open[Math.floor(random() * open.length)] as CritterSpot;
    const species = pickSpecies(HABITAT_SPECIES[home.habitat], random);
    if (!species) continue;
    const reach = species.range * tile.width;
    const range = open.filter(
      (spot) =>
        spot.habitat === home.habitat &&
        Math.hypot(spot.x - home.x, spot.y - home.y) <= reach,
    );
    const [min, max] = species.group;
    const size = Math.min(
      options.maxMembers - members,
      min + Math.floor(random() * (max - min + 1)),
    );
    if (size < 1 || range.length < 2) continue;
    members += size;
    groups.push({
      key: `${options.key}:${index}`,
      species,
      spots: range,
      restUntil: random() * species.rest[1],
      members: Array.from({ length: size }, (_, member) => {
        const offset = herdOffset(member, tile, random);
        return {
          x: home.x + offset.x,
          y: home.y + offset.y,
          targetX: home.x + offset.x,
          targetY: home.y + offset.y,
          offsetX: offset.x,
          offsetY: offset.y,
          departAt: 0,
          pace: 0.9 + random() * 0.2,
          moving: false,
          facing: random() < 0.5 ? 1 : -1,
          phase: random() * 10_000,
        };
      }),
    });
  }
  return groups;
};

/**
 * Advance one group by `delta` seconds at clock `now` (seconds). The leader picks a spot and
 * the herd follows in formation, each member setting off a moment later at its own pace.
 */
export const stepCritterGroup = (
  group: CritterGroup,
  now: number,
  delta: number,
  tile: { width: number; height: number },
  random: () => number,
) => {
  const leader = group.members[0];
  if (!leader) return;
  const resting = group.members.every((member) => !member.moving);
  if (resting && now >= group.restUntil) {
    const spot = group.spots[Math.floor(random() * group.spots.length)];
    if (spot && Math.hypot(spot.x - leader.x, spot.y - leader.y) > tile.width * 0.5) {
      for (const [index, member] of group.members.entries()) {
        // A new formation each trip keeps herds from marching as a rigid block.
        const offset = index === 0 ? { x: 0, y: 0 } : herdOffset(index, tile, random);
        member.offsetX = offset.x;
        member.offsetY = offset.y;
        member.targetX = spot.x + offset.x;
        member.targetY = spot.y + offset.y;
        member.departAt = now + (index === 0 ? 0 : 0.2 + random() * 0.9);
        member.moving = true;
      }
    } else group.restUntil = now + 1;
  }
  const cruise = group.species.speed * tile.width;
  for (const member of group.members) {
    if (!member.moving || now < member.departAt) continue;
    const dx = member.targetX - member.x,
      dy = member.targetY - member.y;
    const distance = Math.hypot(dx, dy);
    const travel = cruise * member.pace * delta;
    if (Math.abs(dx) > tile.width * 0.05) member.facing = dx < 0 ? 1 : -1;
    if (distance <= travel) {
      member.x = member.targetX;
      member.y = member.targetY;
      member.moving = false;
      if (group.members.every((other) => !other.moving)) {
        const [min, max] = group.species.rest;
        group.restUntil = now + min + random() * (max - min);
      }
    } else {
      member.x += (dx / distance) * travel;
      member.y += (dy / distance) * travel;
    }
  }
};

/** Frame of a member's clip: walking loops while moving, the idle clip plays at rest. */
export const critterFrame = (member: Critter, clip: CritterClip, nowMs: number) =>
  Math.floor(((nowMs + member.phase) / 1000) * clip.fps) % clip.frameCount;

const HABITAT_SPECIES = Object.fromEntries(
  CRITTER_HABITATS.map((habitat) => [
    habitat,
    Object.values(CRITTER_SPECIES).filter((species) =>
      species.habitats.includes(habitat),
    ),
  ]),
) as Record<CritterHabitat, CritterSpecies[]>;

const pickSpecies = (candidates: readonly CritterSpecies[], random: () => number) => {
  const total = candidates.reduce((sum, species) => sum + species.weight, 0);
  let roll = random() * total;
  for (const species of candidates) {
    roll -= species.weight;
    if (roll < 0) return species;
  }
  return candidates.at(-1);
};

/** Followers spread around the leader within about one tile; the leader stays on the spot. */
const herdOffset = (
  index: number,
  tile: { width: number; height: number },
  random: () => number,
) => {
  if (index === 0) return { x: 0, y: 0 };
  // Golden-angle steps keep followers from stacking on one another.
  const angle = index * 2.39996 + (random() - 0.5) * 0.8,
    radius = 0.55 + random() * 0.55;
  return {
    x: Math.cos(angle) * radius * tile.width,
    y: Math.sin(angle) * radius * tile.height * 0.6,
  };
};

/** An open tile's foot point in sector-local world units. */
export type CritterSpot = { x: number; y: number; habitat: CritterHabitat };

export type Critter = {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  offsetX: number;
  offsetY: number;
  /** Clock second when this member starts its current walk. */
  departAt: number;
  /** Personal speed factor so followers spread out on the way. */
  pace: number;
  moving: boolean;
  /** 1 faces left like the sheets, -1 mirrors to face right. */
  facing: 1 | -1;
  /** Milliseconds added to the animation clock so herds do not move in lockstep. */
  phase: number;
};

export type CritterGroup = {
  key: string;
  species: CritterSpecies;
  spots: readonly CritterSpot[];
  /** Clock second when a resting group sets off again. */
  restUntil: number;
  members: Critter[];
};
