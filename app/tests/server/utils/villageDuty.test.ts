import { afterEach, expect, it, vi } from "bun:test";
import { createHmac } from "node:crypto";
import * as warRouter from "@/routers/war";
import type { DrizzleClient } from "@/server/db";
import { getIpHashSecret } from "@/server/utils/ipHash";
import {
  isVillageDutyIntruder,
  prepareVillageDutyEncounter,
  villageDutyActorId,
} from "@/server/utils/villageDuty";
import { getUtcHourStart } from "@/utils/time";
import { sectorMap } from "../../setup/sectorMap";

afterEach(() => vi.restoreAllMocks());

const home = {
  id: "home",
  sector: 1,
  relationshipA: [{ villageIdA: "home", villageIdB: "visitor-home", status: "ENEMY" }],
  relationshipB: [],
} as unknown as Parameters<typeof isVillageDutyIntruder>[0];
const visitor = {
  userId: "visitor",
  villageId: "visitor-home",
  sector: 1,
  status: "AWAKE",
  location: "Village",
  isAi: false,
  isBanned: false,
};
const wars = (supportVillageId: string) =>
  [
    {
      attackerVillageId: "home",
      defenderVillageId: "other",
      warAllies: [{ villageId: "visitor-home", supportVillageId }],
    },
  ] as Parameters<typeof isVillageDutyIntruder>[2];

it("uses stable, domain-separated opaque patrol identities", () => {
  const actorId = villageDutyActorId("private-owner");
  expect(villageDutyActorId("private-owner")).toBe(actorId);
  expect(villageDutyActorId("another-owner")).not.toBe(actorId);
  expect(actorId).toMatch(/^duty:[a-f0-9]{64}$/);
  expect(actorId).not.toContain("private-owner");
  expect(actorId).not.toBe(
    `duty:${createHmac("sha256", getIpHashSecret()).update("private-owner").digest("hex")}`,
  );
});

it("gives defined war allegiance precedence over permanent hostile diplomacy", () => {
  expect(isVillageDutyIntruder(home, visitor, wars("home"))).toBe(false);
  expect(isVillageDutyIntruder(home, visitor, wars("other"))).toBe(true);
  expect(isVillageDutyIntruder(home, visitor, [])).toBe(true);
  expect(
    isVillageDutyIntruder(home, { ...visitor, status: "ASLEEP" }, wars("other")),
  ).toBe(false);
});

it("loads authoritative wars for preloaded travel encounters before deciding hostility", async () => {
  const fetchWars = vi
    .spyOn(warRouter, "fetchActiveWars")
    .mockResolvedValue(wars("home") as never);
  const client = {} as DrizzleClient;
  const preload = {
    user: {
      ...visitor,
      longitude: 8,
      latitude: 1,
      stealthActive: false,
    } as NonNullable<
      Parameters<typeof prepareVillageDutyEncounter>[0]["preload"]
    >["user"],
    home,
    map: sectorMap(10, 10),
    roster: [],
    presence: [],
  };
  expect(
    await prepareVillageDutyEncounter({
      client,
      userId: visitor.userId,
      sector: 1,
      preload,
    }),
  ).toBeNull();
  expect(fetchWars).toHaveBeenCalledWith(client);
  fetchWars.mockClear();
  expect(
    await prepareVillageDutyEncounter({
      client,
      userId: visitor.userId,
      sector: 1,
      preload: { ...preload, wars: wars("home") },
    }),
  ).toBeNull();
  expect(fetchWars).not.toHaveBeenCalled();
});

it.each(["old", "visitor"])(
  "does not passively engage a disconnected visitor after a completed %s pursuit",
  async (previousTarget) => {
    const now = new Date();
    const shift = {
      villageId: "home",
      startedAt: getUtcHourStart(now),
      capacity: 1,
      revision: 0,
      patrols: [
        {
          userId: "guard",
          defeated: false,
          battleId: null,
          pursuit: {
            targetUserId: previousTarget,
            startedAt: now.getTime() - 1000,
            path: [{ x: 1, y: 1 }],
          },
        },
      ],
    };
    const client = {
      update: () => ({ set: () => ({ where: async () => ({ rowsAffected: 1 }) }) }),
      insert: () => ({
        values: () => ({ onDuplicateKeyUpdate: async () => ({ rowsAffected: 1 }) }),
      }),
    } as unknown as DrizzleClient;
    const result = await prepareVillageDutyEncounter({
      client,
      userId: visitor.userId,
      sector: 1,
      preload: {
        user: { ...visitor, longitude: 8, latitude: 1, stealthActive: false } as never,
        home: { ...home, structures: [], dutyShift: shift },
        map: sectorMap(10, 10, (x) => ({ zone: "village", blocked: x === 4 }), {
          anchors: [],
        }),
        roster: [{ userId: "guard" }] as never,
        presence: [],
        wars: [],
      },
    });
    expect(result && !result.blocked && result.slot).toBe(-1);
    expect(result && !result.blocked && result.shift.patrols[0]?.pursuit).toBeNull();
  },
);
