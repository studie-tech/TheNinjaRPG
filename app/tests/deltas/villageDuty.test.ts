import { expect, it } from "bun:test";
import type { RouterOutputs } from "@/app/_trpc/client";
import {
  buildVillageDutyPatrolUpdate,
  getVillageDutySectorUpdate,
} from "@/deltas/villageDuty";

const shift: Parameters<typeof buildVillageDutyPatrolUpdate>[0] = {
  villageId: "home",
  startedAt: new Date("2026-11-10T10:00:00Z"),
  capacity: 2,
  revision: 4,
  patrols: [
    {
      userId: "guard",
      actorId: "duty:opaque",
      defeated: false,
      battleId: null,
      pursuit: { targetUserId: "enemy", startedAt: 1000, path: [{ x: 1, y: 2 }] },
    },
  ],
};
const sector = () =>
  ({
    sectorData: { sector: 123 },
    patrolShiftAt: shift.startedAt,
    patrolRevision: 3,
    patrolThreat: true,
    protectors: [
      {
        userId: "duty:opaque",
        avatar: "loaded-art",
        npcWander: { seed: "duty:opaque" },
      },
    ],
  }) as Extract<
    RouterOutputs["travel"]["getSectorData"],
    { patrolShiftAt: Date | null }
  >;

it("patches shared pursuit without replacing loaded artwork or mutating the baseline", () => {
  const current = sector();
  const updated = getVillageDutySectorUpdate(
    current,
    buildVillageDutyPatrolUpdate(shift, 123, new Set(["guard"])),
  );
  expect(updated?.protectors?.[0]?.avatar).toBe("loaded-art");
  expect(updated?.protectors?.[0]?.npcWander?.pursuit).toEqual(
    shift.patrols[0]?.pursuit ?? undefined,
  );
  expect(updated?.patrolRevision).toBe(4);
  expect(current.protectors?.[0]?.npcWander?.pursuit).toBeUndefined();
});

it.each(["claimed", "defeated", "withdrawn"])(
  "removes a %s copy and stops empty-patrol heartbeats",
  (state) => {
    const changed = structuredClone(shift);
    if (state === "defeated") changed.patrols[0]!.defeated = true;
    const update = buildVillageDutyPatrolUpdate(
      changed,
      123,
      new Set(state === "withdrawn" ? [] : ["guard"]),
      state === "claimed" ? 0 : undefined,
    );
    const updated = getVillageDutySectorUpdate(sector(), update);
    expect(updated?.protectors).toEqual([]);
    expect(updated?.patrolThreat).toBe(false);
    expect(update.revision).toBe(state === "claimed" ? 5 : 4);
  },
);

it("requests reconciliation for unknown identities, sectors and hourly rosters", () => {
  const update = buildVillageDutyPatrolUpdate(shift, 123, new Set(["guard"]));
  expect(
    getVillageDutySectorUpdate({ ...sector(), protectors: [] }, update),
  ).toBeUndefined();
  expect(
    getVillageDutySectorUpdate(sector(), { ...update, sector: 456 }),
  ).toBeUndefined();
  expect(
    getVillageDutySectorUpdate(sector(), {
      ...update,
      startedAt: new Date("2026-11-10T11:00:00Z"),
    }),
  ).toBeUndefined();
});
