import { expect, it } from "bun:test";
import { VILLAGE_DUTY_PRESENCE_SECONDS } from "@/drizzle/constants";
import { type VillageStructure, villageStructure } from "@/drizzle/schema";
import { oddQHexDistance } from "@/libs/hexgrid";
import { WANDER_STEP_MS } from "@/libs/overworldWander";
import {
  planVillageDutyPursuits,
  type VillageDutyPatrol,
  villageDutyCapacity,
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
    [{ userId: "guard" }, { userId: "reserve" }],
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
    [{ userId: "guard" }],
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
    [{ userId: "guard" }, { userId: "busy" }, { userId: "free" }],
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
    [{ userId: "guard" }],
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
    [{ userId: "guard" }],
    map,
    [{ userId: "old", longitude: 2, latitude: 1 }],
    now,
  )[0]!;
  expect(fresh.pursuit?.startedAt).toBe(now);
  expect(fresh.pursuit?.expiresAt).toBe(now + VILLAGE_DUTY_PRESENCE_SECONDS * 1000);
  const renewed = planVillageDutyPursuits(
    [fresh],
    [{ userId: "guard" }],
    map,
    [{ userId: "old", longitude: 2, latitude: 1 }],
    now + 1000,
  )[0]!;
  expect(renewed.pursuit?.path).toBe(fresh.pursuit?.path);
  expect(renewed.pursuit?.startedAt).toBe(now);
  expect(renewed.pursuit?.expiresAt).toBe(fresh.pursuit!.expiresAt! + 1000);
});
