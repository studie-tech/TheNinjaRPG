import { expect, it } from "bun:test";
import { buildVillageDutyPatrolUpdate } from "@/deltas/villageDuty";
import { VILLAGE_DUTY_PRESENCE_SECONDS } from "@/drizzle/constants";
import { type VillageStructure, villageStructure } from "@/drizzle/schema";
import { oddQHexDistance } from "@/libs/hexgrid";
import {
  isOpenWanderTile,
  WANDER_STEP_MS,
  wanderPose,
  wanderPoseTile,
  wanderSpots,
} from "@/libs/overworldWander";
import { planVillageWalls } from "@/libs/sector-map/village-walls";
import {
  planVillageDutyPursuits,
  type VillageDutyPatrol,
  villageDutyCapacity,
  villageDutyNavigationMap,
  villageDutyPatrols,
  villageDutyPosition,
  villageDutyPursuitPosition,
} from "@/libs/villageDuty";
import { tableDefaults } from "../setup/combat";
import { sectorMap } from "../setup/sectorMap";

it.each([
  [0, 0],
  [1, 2],
  [2, 4],
  [10, 20],
  [20, 20],
])("gives protector level %i a bounded %i-slot capacity", (level, capacity) => {
  expect(
    villageDutyCapacity([
      {
        ...tableDefaults(villageStructure),
        level,
        patrolSlotsPerLvl: 2,
      } as VillageStructure,
    ]),
  ).toBe(capacity);
  expect(villageDutyCapacity([])).toBe(0);
});

/** A known starting pose keeps targeting tests independent of the ambient wander phase. */
const patrol = (patch: Partial<VillageDutyPatrol> = {}): VillageDutyPatrol => ({
  userId: "guard",
  battleId: null,
  defeated: false,
  pursuit: { targetUserId: "old", startedAt: 0, path: [{ x: 1, y: 1 }] },
  ...patch,
});

it("pursues the closest enemy and keeps deterministic ties without changing owner or shift inputs", () => {
  const map = sectorMap(10, 10, () => ({ zone: "village" }), { anchors: [] });
  const source = [patrol()];
  const before = structuredClone(source);
  const result = planVillageDutyPursuits(
    source,
    [
      { userId: "guard", actorId: "duty:opaque-guard" },
      { userId: "reserve", actorId: "duty:opaque-reserve" },
    ],
    map,
    [
      { userId: "far", longitude: 8, latitude: 8 },
      { userId: "b", longitude: 3, latitude: 1 },
      { userId: "a", longitude: 3, latitude: 1 },
    ],
    1000,
  );
  expect(result).toHaveLength(1);
  expect(result[0]?.pursuit?.targetUserId).toBe("a");
  expect(source).toEqual(before);
});

it("routes pursuing copies around blocked ground using reachable village tiles", () => {
  const map = sectorMap(
    10,
    10,
    (x, y) => ({
      zone: x === 4 && y !== 7 ? "water" : "village",
      blocked: x === 4 && y !== 7,
    }),
    { anchors: [] },
  );
  const result = planVillageDutyPursuits(
    [patrol()],
    [{ userId: "guard", actorId: "duty:opaque-guard" }],
    map,
    [{ userId: "enemy", longitude: 8, latitude: 1 }],
    1000,
  );
  const path = result[0]!.pursuit!.path;
  expect(path.some((tile) => tile.x === 4 && tile.y === 7)).toBe(true);
  expect(path.every((tile) => tile.x !== 4 || tile.y === 7)).toBe(true);
  const last = path.at(-1)!;
  expect(oddQHexDistance(last.x, last.y, 8, 1)).toBeLessThanOrEqual(1);
});

it("does not replace defeated, engaged or withdrawn copies and returns to roaming when enemies leave", () => {
  const map = sectorMap(10, 10, () => ({ zone: "village" }), { anchors: [] });
  const source = [
    patrol({ defeated: true }),
    patrol({ userId: "busy", battleId: "fight" }),
    patrol({ userId: "withdrawn" }),
    patrol({ userId: "free" }),
  ];
  const result = planVillageDutyPursuits(
    source,
    [
      { userId: "guard", actorId: "duty:opaque-guard" },
      { userId: "busy", actorId: "duty:opaque-busy" },
      { userId: "free", actorId: "duty:opaque-free" },
    ],
    map,
    [],
    1000,
  );
  expect(result.slice(0, 3)).toEqual(source.slice(0, 3));
  expect(result[3]?.pursuit).toBeNull();
  expect(source[3]?.pursuit).not.toBeNull();
});

it("retains an unchanged pursuit and shares bounded interpolation with the renderer", () => {
  const map = sectorMap(10, 10, () => ({ zone: "village" }), { anchors: [] });
  const source = patrol({
    pursuit: {
      targetUserId: "enemy",
      startedAt: 1000,
      expiresAt: 100_001,
      path: [
        { x: 1, y: 1 },
        { x: 2, y: 1 },
      ],
    },
  });
  const result = planVillageDutyPursuits(
    [source],
    [{ userId: "guard", actorId: "duty:opaque-guard" }],
    map,
    [{ userId: "enemy", longitude: 3, latitude: 1, expiresAt: 100_001 }],
    1100,
  );
  expect(result[0]).toBe(source);
  expect(
    villageDutyPursuitPosition(source.pursuit!, 1000 + WANDER_STEP_MS / 2)?.progress,
  ).toBe(0.5);
  expect(villageDutyPursuitPosition(source.pursuit!, 100_000)?.to).toEqual({
    x: 2,
    y: 1,
  });
});

it("expires abandoned pursuits on the same clock used for rendering and retargets from roaming", () => {
  const map = sectorMap(10, 10, () => ({ zone: "village" }), { anchors: [] });
  const source = patrol();
  const now = VILLAGE_DUTY_PRESENCE_SECONDS * 1000;
  expect(villageDutyPursuitPosition(source.pursuit!, now)).toBeNull();
  const actor = {
    longitude: 1,
    latitude: 1,
    npcWander: {
      seed: "duty:guard",
      anchor: { x: 4, y: 4 },
      radius: 0,
      wildOnly: false,
      villageOnly: true,
    },
  };
  expect(villageDutyPosition(source, actor, map, now)).toEqual({ x: 4, y: 4 });
  const fresh = planVillageDutyPursuits(
    [source],
    [{ userId: "guard", actorId: "duty:opaque-guard" }],
    map,
    [{ userId: "old", longitude: 2, latitude: 1 }],
    now,
  )[0]!;
  expect(fresh.pursuit?.startedAt).toBe(now);
  expect(fresh.pursuit?.expiresAt).toBe(now + VILLAGE_DUTY_PRESENCE_SECONDS * 1000);
  const renewed = planVillageDutyPursuits(
    [fresh],
    [{ userId: "guard", actorId: "duty:opaque-guard" }],
    map,
    [{ userId: "old", longitude: 2, latitude: 1 }],
    now + 1000,
  )[0]!;
  expect(renewed.pursuit?.path).toBe(fresh.pursuit?.path);
  expect(renewed.pursuit?.startedAt).toBe(now);
  expect(renewed.pursuit?.expiresAt).toBe(fresh.pursuit!.expiresAt! + 1000);
});

it("keeps patrol anchors, roaming and pursuit paths clear of actual Horizon buildings", () => {
  const map = sectorMap(25, 25, () => ({ zone: "village" }), {
    anchors: [
      { key: "shrine.default", x: 13, y: 5 },
      { key: "structure.alliancehall", x: 13, y: 7 },
      { key: "structure.hospital", x: 16, y: 8 },
    ],
  });
  const structures = [
    { hasPage: 1, longitude: 3, latitude: 9, route: "/townhall" },
    { hasPage: 1, longitude: 5, latitude: 5, route: "/itemshop" },
    { hasPage: 1, longitude: 7, latitude: 8, route: "/blackmarket" },
    { hasPage: 1, longitude: 13, latitude: 8, route: "/hospital" },
    { hasPage: 0, longitude: 10, latitude: 10, route: "/patrol" },
  ];
  const original = structuredClone(map);
  const clientMap = villageDutyNavigationMap(map, structures);
  expect(clientMap.tiles).not.toBe(map.tiles);
  expect(clientMap.anchors.slice(0, map.anchors.length)).toEqual(map.anchors);
  expect(isOpenWanderTile(map, 3, 9, false)).toBe(true);
  expect(isOpenWanderTile(clientMap, 3, 9, false)).toBe(false);
  expect(isOpenWanderTile(clientMap, 13, 10, false)).toBe(false);
  expect(isOpenWanderTile(clientMap, 0, 0, false)).toBe(false);
  expect(isOpenWanderTile(clientMap, 10, 10, false)).toBe(true);
  const wall = planVillageWalls(map, [
    ...structures,
    { hasPage: 1, longitude: 13, latitude: 5, route: "/shrine" },
  ]);
  const interior = new Set(wall.interior.map((tile) => `${tile.x},${tile.y}`));
  const owners: Parameters<typeof villageDutyPatrols>[0] = [
    "user_3EOz9fh8bSO50ubD7HEH7FEhieN",
    "user_3FWtvZC9iNKwSFPCtVL6z5DeZK1",
  ].map((userId, index) => ({
    userId,
    actorId: `duty:opaque-${index}`,
    username: userId,
    avatar: null,
    avatarLight: null,
    gender: "male",
    spriteBodyStyle: null,
    maxHealth: 100,
    level: 10,
    experience: 0,
    rank: "CHUNIN",
    villageId: "horizon",
    villageDutyStartedAt: new Date(0),
    anbuId: null,
    anbuSquad: null,
    attributes: [],
    cosmeticSlots: [],
    items: [],
  }));
  const actors = villageDutyPatrols(
    owners,
    map,
    map.sector,
    "horizon",
    undefined,
    structures,
  );
  expect(actors).toHaveLength(2);
  expect(actors[0]!.npcWander!.anchor).not.toEqual(actors[1]!.npcWander!.anchor);
  const roster = owners.map((owner) => patrol({ userId: owner.userId, pursuit: null }));
  for (const defeated of [false, true]) {
    const survivor = villageDutyPatrols(
      owners.slice(1),
      map,
      map.sector,
      "horizon",
      [{ ...roster[0]!, defeated }, roster[1]!],
      structures,
    )[0]!;
    expect(survivor.npcWander!.anchor).toEqual(actors[1]!.npcWander!.anchor);
  }
  const now = 1_794_465_382_401;
  for (const [index, actor] of actors.entries()) {
    const source = patrol({ userId: owners[index]!.userId, pursuit: null });
    const wander = actor.npcWander!;
    expect(interior.has(`${wander.anchor.x},${wander.anchor.y}`)).toBe(true);
    const spots = wanderSpots(clientMap, wander.anchor, wander.radius, false, true);
    expect(spots.length).toBeGreaterThan(1);
    expect(
      spots.every((tile) => isOpenWanderTile(clientMap, tile.x, tile.y, false)),
    ).toBe(true);
    // A client's interpolated timeline and the server's engagement position share clearance.
    let moving = 0;
    let idleMs = 0;
    let longestIdleMs = 0;
    for (let elapsed = 0; elapsed < 120_000; elapsed += 100) {
      const at = now + elapsed;
      const pose = wanderPose({ ...wander, spots }, 0, at);
      moving += Number(pose.moving);
      idleMs = pose.moving ? 0 : idleMs + 100;
      longestIdleMs = Math.max(longestIdleMs, idleMs);
      const client = wanderPoseTile(pose);
      expect(villageDutyPosition(source, actor, clientMap, at)).toEqual(client);
      expect(isOpenWanderTile(clientMap, client.x, client.y, false)).toBe(true);
      expect(interior.has(`${client.x},${client.y}`)).toBe(true);
    }
    expect(moving / 1200).toBeGreaterThan(0.5);
    expect(longestIdleMs).toBeLessThanOrEqual(1000);
    const obstructed = {
      ...source,
      pursuit: {
        targetUserId: "visitor",
        startedAt: now,
        path: [{ x: 3, y: 9 }],
      },
    };
    expect(
      villageDutyPatrols(
        owners,
        map,
        map.sector,
        "horizon",
        roster.map((entry) => (entry.userId === source.userId ? obstructed : entry)),
        structures,
      )[index]!.npcWander!.pursuit,
    ).toBeUndefined();
    expect(villageDutyPosition(obstructed, actor, clientMap, now)).toEqual(
      villageDutyPosition(source, actor, clientMap, now),
    );
    const pursuit = planVillageDutyPursuits(
      roster.map((entry) => (entry.userId === source.userId ? obstructed : entry)),
      owners,
      map,
      [{ userId: "visitor", longitude: 3, latitude: 9 }],
      now,
      structures,
    )[index]!.pursuit!;
    expect(pursuit.path[0]).toEqual(villageDutyPosition(source, actor, clientMap, now));
    expect(pursuit.path.length).toBeGreaterThan(1);
    for (const [step, tile] of pursuit.path.entries()) {
      expect(isOpenWanderTile(clientMap, tile.x, tile.y, false)).toBe(true);
      if (step)
        expect(
          oddQHexDistance(
            pursuit.path[step - 1]!.x,
            pursuit.path[step - 1]!.y,
            tile.x,
            tile.y,
          ),
        ).toBe(1);
    }
  }
  expect(map).toEqual(original);
});

it("retains navigation views until the map or actual structure layout changes", () => {
  const map = sectorMap(25, 25);
  const structures = [{ hasPage: 1, longitude: 3, latitude: 9, route: "/townhall" }];
  const navigation = villageDutyNavigationMap(map, structures);
  expect(villageDutyNavigationMap(map, structures)).toBe(navigation);
  const moved = [{ ...structures[0]!, longitude: 20 }];
  const next = villageDutyNavigationMap(map, moved);
  expect(next).not.toBe(navigation);
  expect(isOpenWanderTile(next, 20, 9, false)).toBe(false);
  const edited = { ...map, anchors: [{ key: "structure.shop", x: 12, y: 12 }] };
  const editedNavigation = villageDutyNavigationMap(edited, structures);
  expect(editedNavigation).not.toBe(navigation);
  expect(isOpenWanderTile(editedNavigation, 12, 12, false)).toBe(false);
});

it.each(["old", "enemy"])(
  "clears an unreachable distant %s pursuit instead of completing at its origin",
  (previousTarget) => {
    const map = sectorMap(10, 10, (x) => ({ zone: "village", blocked: x === 4 }), {
      anchors: [],
    });
    const source = patrol({
      pursuit: { targetUserId: previousTarget, startedAt: 0, path: [{ x: 1, y: 1 }] },
    });
    const result = planVillageDutyPursuits(
      [source],
      [{ userId: "guard", actorId: "duty:opaque" }],
      map,
      [{ userId: "enemy", longitude: 8, latitude: 1 }],
      1000,
    )[0]!;
    expect(result.pursuit).toBeNull();
  },
);

it("masks ANBU owner IDs consistently in snapshots, seeds and deltas", () => {
  const map = sectorMap(10, 10, () => ({ zone: "village" }), { anchors: [] });
  const owner = {
    userId: "private-owner",
    actorId: "duty:opaque",
    username: "Secret",
    anbuId: "squad",
    anbuSquad: { image: "mask" },
    villageId: "home",
    avatar: "portrait",
    avatarLight: null,
    gender: "male",
    spriteBodyStyle: null,
    maxHealth: 100,
    level: 10,
    experience: 0,
    rank: "CHUNIN",
    villageDutyStartedAt: new Date(0),
    attributes: [],
    cosmeticSlots: [],
    items: [],
  } as Parameters<typeof villageDutyPatrols>[0][number];
  const foreign = villageDutyPatrols([owner], map, 1, "foreign")[0]!;
  const ally = villageDutyPatrols([owner], map, 1, "home")[0]!;
  expect(foreign.userId).toBe(owner.actorId);
  expect(foreign.npcWander?.seed).toBe(owner.actorId);
  expect(foreign.villageDutyUserId).toBeUndefined();
  expect(JSON.stringify(foreign)).not.toContain(owner.userId);
  expect(ally.userId).toBe(foreign.userId);
  expect(ally.npcWander?.seed).toBe(foreign.npcWander?.seed);
  expect(ally.villageDutyUserId).toBe(owner.userId);
  const update = buildVillageDutyPatrolUpdate(
    {
      villageId: "home",
      startedAt: new Date(0),
      revision: 0,
      capacity: 1,
      patrols: [
        { ...patrol({ userId: owner.userId, pursuit: null }), actorId: owner.actorId },
      ],
    },
    1,
    new Set([owner.userId]),
  );
  expect(update.patrols[0]?.userId).toBe(foreign.userId);
  expect(JSON.stringify(update)).not.toContain(owner.userId);
});
