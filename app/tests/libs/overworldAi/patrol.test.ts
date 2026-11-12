import { expect, it } from "bun:test";
import { oddQHexDistance, oddQLineStep } from "@/libs/hexgrid";
import {
  isOpenWanderTile,
  WANDER_STEP_MS,
  wanderClock,
  wanderLeg,
  wanderPose,
  wanderPoseTile,
  wanderSpots,
} from "@/libs/overworldWander";
import { sectorMap } from "../../setup/sectorMap";

const map = sectorMap(12, 12, (x, y) => ({
  zone: "village",
  blocked: x === 6 && y >= 4 && y <= 8,
}));
const config = {
  seed: "duty:protector",
  anchor: { x: 4, y: 6 },
  radius: 5,
  villageOnly: true,
  spots: wanderSpots(map, { x: 4, y: 6 }, 5, false, true),
};

it("joins every patrol destination into a closed circuit with brief pauses and the shared hex pace", () => {
  const legs = config.spots.map((_, cycle) => wanderLeg(config, 0, cycle));
  expect(legs.length).toBeGreaterThan(1);
  expect(legs.some((leg) => leg.via)).toBe(true);
  for (const [index, leg] of legs.entries()) {
    expect(leg.from).not.toEqual(leg.to);
    expect(leg.to).toEqual(legs[(index + 1) % legs.length]!.from);
    expect(leg.departAt).toBeGreaterThanOrEqual(600);
    expect(leg.departAt).toBeLessThanOrEqual(1000);
    const path = leg.via ? [leg.from, leg.via, leg.to] : [leg.from, leg.to];
    let distance = 0;
    for (let part = 1; part < path.length; part++) {
      const from = path[part - 1]!;
      const to = path[part]!;
      const steps = oddQHexDistance(from.x, from.y, to.x, to.y);
      distance += steps;
      for (let step = 0; step <= steps; step++) {
        const tile = oddQLineStep(
          { col: from.x, row: from.y },
          { col: to.x, row: to.y },
          step,
        );
        expect(isOpenWanderTile(map, tile.col, tile.row, false)).toBe(true);
      }
    }
    expect(leg.walkMs).toBe(distance * WANDER_STEP_MS);
    expect(wanderLeg(config, 0, index + legs.length)).toBe(leg);
  }
});

it("remains continuous across destinations and circuit wraps, with deterministic random-access poses", () => {
  let now = 0;
  let previous = wanderPoseTile(wanderPose(config, 0, now));
  for (let tick = 0; tick < 2400; tick++) {
    now += 100;
    const pose = wanderPose(config, 0, now);
    const tile = wanderPoseTile(pose);
    expect(oddQHexDistance(previous.x, previous.y, tile.x, tile.y)).toBeLessThanOrEqual(
      1,
    );
    previous = tile;
  }
  now = 0;
  for (let index = 0; index < config.spots.length * 3; index++) {
    const { cycle, into } = wanderClock(config, now);
    const leg = wanderLeg(config, 0, cycle);
    const boundary = now + leg.departAt + leg.walkMs - into;
    const before = wanderPose(config, 0, boundary - 0.001);
    const after = wanderPose(config, 0, boundary);
    expect(before.progress).toBeCloseTo(1, 5);
    expect(after.progress).toBe(0);
    expect(before.to).toEqual(after.from);
    expect(wanderClock(config, boundary).into).toBe(0);
    now = boundary;
  }
  for (const at of [0, 12_345, 987_654_321, -50_000])
    expect(wanderPose(config, 0, at)).toEqual(
      wanderPose({ ...config, spots: [...config.spots] }, 0, at),
    );
});

it("caches patrol spots and legs until their map, anchor, radius, habitat or seed changes", () => {
  expect(wanderSpots(map, config.anchor, 5, false, true)).toBe(config.spots);
  expect(wanderSpots({ ...map }, config.anchor, 5, false, true)).not.toBe(config.spots);
  expect(wanderSpots(map, { x: 3, y: 6 }, 5, false, true)).not.toBe(config.spots);
  expect(wanderSpots(map, config.anchor, 3, false, true)).not.toBe(config.spots);
  expect(wanderSpots(map, config.anchor, 5, true, true)).not.toBe(config.spots);
  const leg = wanderLeg(config, 0, 0);
  expect(wanderLeg({ ...config }, 0, 0)).toBe(leg);
  expect(wanderLeg({ ...config, seed: "duty:other" }, 0, 0)).not.toBe(leg);
  expect(wanderLeg({ ...config, spots: [...config.spots] }, 0, 0)).not.toBe(leg);
});

it("keeps a single reachable spot stationary", () => {
  const still = { ...config, spots: [config.anchor] };
  for (const now of [0, 800, 12_345, 987_654_321]) {
    const pose = wanderPose(still, 0, now);
    expect(pose.moving).toBe(false);
    expect(wanderPoseTile(pose)).toEqual(config.anchor);
  }
});

it("preserves ordinary NPC cycle timing, destinations and member offsets", () => {
  const ordinary = {
    seed: "ordinary-npc",
    anchor: { x: 1, y: 1 },
    radius: 2,
    spots: [
      { x: 1, y: 1 },
      { x: 1, y: 2 },
      { x: 1, y: 3 },
    ],
  };
  expect([0, 12_345, 987_654_321].map((now) => wanderPose(ordinary, 0, now))).toEqual([
    {
      from: { x: 1, y: 1 },
      to: { x: 1, y: 2 },
      via: null,
      departAt: 3011.164817784447,
      walkMs: 650,
      fromOffset: { x: 0, y: 0 },
      toOffset: { x: 0, y: 0 },
      progress: 1,
      moving: false,
    },
    {
      from: { x: 1, y: 2 },
      to: { x: 1, y: 2 },
      via: null,
      departAt: 3572.151664015837,
      walkMs: 0,
      fromOffset: { x: 0, y: 0 },
      toOffset: { x: 0, y: 0 },
      progress: 1,
      moving: false,
    },
    {
      from: { x: 1, y: 3 },
      to: { x: 1, y: 3 },
      via: null,
      departAt: 476.9590651150793,
      walkMs: 0,
      fromOffset: { x: 0, y: 0 },
      toOffset: { x: 0, y: 0 },
      progress: 1,
      moving: false,
    },
  ]);
  expect(wanderPose({ ...ordinary, villageOnly: false }, 2, 12_345)).toEqual(
    wanderPose(ordinary, 2, 12_345),
  );
});
