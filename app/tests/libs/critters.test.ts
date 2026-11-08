import alea from "alea";
import { describe, expect, it } from "bun:test";
import {
  CRITTER_SPECIES,
  type CritterHabitat,
  type CritterSpot,
  critterFrame,
  planCritterGroups,
  stepCritterGroup,
} from "@/libs/critters";
import type { TerrainHex } from "@/libs/hexgrid";
import { critterSpots } from "@/libs/rendering/worldCritters";

const tile = { width: 40, height: 20 };
/** A square meadow of spots one tile apart, all of one habitat. */
const meadow = (habitat: CritterHabitat, size = 8): CritterSpot[] =>
  Array.from({ length: size * size }, (_, index) => ({
    x: (index % size) * tile.width,
    y: Math.floor(index / size) * tile.height,
    habitat,
  }));
const plan = (spots: CritterSpot[], seed = "a", maxGroups = 40, maxMembers = 200) =>
  planCritterGroups({ key: "724", spots, tile, maxGroups, maxMembers, random: alea(seed) });

describe("critter groups", () => {
  it("spawns only species that live in the habitat, and ice bears always alone", () => {
    const cold = plan(meadow("snow"));
    expect(cold.length).toBeGreaterThan(10);
    expect(new Set(cold.map((group) => group.species.id))).toEqual(new Set(["icebear", "reindeer"]));
    for (const group of cold.filter((entry) => entry.species.id === "icebear"))
      expect(group.members).toHaveLength(1);
    const desert = plan(meadow("dessert"));
    expect(desert.every((group) => group.species.id === "camel")).toBe(true);
  });

  it("gathers grassland deer in herds within their range and is reproducible per seed", () => {
    const groups = plan(meadow("ground"));
    const herds = groups.filter((group) => group.species.id === "deer");
    expect(herds.length).toBeGreaterThan(0);
    for (const herd of herds) {
      expect(herd.members.length).toBeGreaterThanOrEqual(CRITTER_SPECIES.deer.group[0]);
      expect(herd.members.length).toBeLessThanOrEqual(CRITTER_SPECIES.deer.group[1]);
      const home = herd.members[0]!;
      for (const spot of herd.spots)
        expect(Math.hypot(spot.x - home.x, spot.y - home.y)).toBeLessThanOrEqual(CRITTER_SPECIES.deer.range * tile.width + 1e-6);
    }
    expect(JSON.stringify(plan(meadow("ground"), "b"))).toBe(JSON.stringify(plan(meadow("ground"), "b")));
  });

  it("respects group and member caps and skips water or empty habitats", () => {
    const groups = plan(meadow("ground"), "c", 2, 3);
    expect(groups.length).toBeLessThanOrEqual(2);
    expect(groups.reduce((sum, group) => sum + group.members.length, 0)).toBeLessThanOrEqual(3);
    expect(plan([])).toEqual([]);
  });
});

describe("critter wandering", () => {
  it("walks the herd to a spot in formation, staggers departures, then rests facing its heading", () => {
    const random = alea("walk");
    const [herd] = plan(meadow("ground"), "deer").filter((group) => group.species.id === "deer");
    expect(herd).toBeDefined();
    const group = herd!;
    group.restUntil = 0;
    // A spot within half a tile is skipped for a second; step until the herd sets off.
    let now = 0;
    while (!group.members[0]!.moving && now < 30) stepCritterGroup(group, (now += 1), 0, tile, random);
    expect(group.members.every((member) => member.moving)).toBe(true);
    const [leader, ...followers] = group.members;
    expect(followers.every((member) => member.departAt > now)).toBe(true);
    const target = { x: leader!.targetX, y: leader!.targetY };
    expect(group.spots.some((spot) => spot.x === target.x && spot.y === target.y)).toBe(true);
    // Followers aim at the leader's spot plus their own offset.
    for (const member of followers)
      expect(Math.hypot(member.targetX - target.x - member.offsetX, member.targetY - target.y - member.offsetY)).toBeLessThan(1e-9);
    const start = now;
    while (group.members.some((member) => member.moving) && now < start + 60) {
      now += 0.05;
      stepCritterGroup(group, now, 0.05, tile, random);
    }
    expect(group.members.every((member) => !member.moving)).toBe(true);
    expect(leader!.x).toBe(target.x);
    expect(group.restUntil).toBeGreaterThanOrEqual(now + CRITTER_SPECIES.deer.rest[0] - 0.05);
  });

  it("holds still while resting and loops clip frames with a per-member phase", () => {
    const random = alea("rest");
    const group = plan(meadow("snow"), "rest")[0]!;
    group.restUntil = 100;
    const before = group.members.map((member) => [member.x, member.y]);
    for (let now = 0; now < 5; now += 0.1) stepCritterGroup(group, now, 0.1, tile, random);
    expect(group.members.map((member) => [member.x, member.y])).toEqual(before);
    const member = { ...group.members[0]!, phase: 0 };
    const clip = group.species.move;
    expect(critterFrame(member, clip, 0)).toBe(0);
    expect(critterFrame(member, clip, (1000 / clip.fps) * (clip.frameCount + 1))).toBe(1);
  });
});

describe("critter spots", () => {
  const hex = (patch: Partial<TerrainHex>) =>
    ({ center: { x: -40, y: -20 }, width: 40, height: 20, spec: { key: "ground", isWater: false }, ...patch }) as unknown as TerrainHex;
  it("keeps open, dry wilderness and drops water, structures, villages and roads", () => {
    const spots = critterSpots([
      hex({}),
      hex({ zone: "wilderness" }),
      hex({ spec: { key: "ocean", isWater: true } as never }),
      hex({ hasStructure: true }),
      hex({ zone: "village" }),
      hex({ zone: "road" }),
      hex({ spec: { key: "snow", isWater: false } as never }),
    ]);
    expect(spots.map((spot) => spot.habitat)).toEqual(["ground", "ground", "snow"]);
    expect(spots[0]).toEqual({ x: 60, y: 26, habitat: "ground" });
  });
});
