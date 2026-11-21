/** Cover the page-side check that decides whether caravan maintenance has work. */
import { describe, expect, it } from "bun:test";
import {
  CARAVAN_CHECKPOINTS,
  CARAVAN_ENCOUNTER_STALE_MINUTES,
} from "@/drizzle/constants";
import type { Caravan, CaravanEncounter, CaravanOperation } from "@/drizzle/schema";
import { hasDueCaravanWork } from "@/server/utils/caravan";

const NOW = new Date("2026-06-15T12:00:00Z");
const MINUTE = 60_000;

describe("hasDueCaravanWork", () => {
  it("finds nothing for a caravan between checkpoints", () => {
    expect(hasDueCaravanWork(input(), NOW)).toBe(false);
  });

  it("finds an arrival, an unrolled checkpoint and a blocked route", () => {
    expect(hasDueCaravanWork(input({ caravan: ARRIVED }), NOW)).toBe(true);
    expect(
      hasDueCaravanWork(input({ caravan: { checkpointsProcessed: 0 } }), NOW),
    ).toBe(true);
    expect(
      hasDueCaravanWork({ ...input(), blockedRouteIds: new Set(["r1"]) }, NOW),
    ).toBe(true);
  });

  it("leaves an arrival or a blocked route alone while a fight over it is open", () => {
    const fought = (overrides: Partial<CaravanEncounter>) => [
      {
        id: "e1",
        type: "AMBUSH",
        status: "PENDING",
        caravanId: "c1",
        expiresAt: new Date(NOW.getTime() + MINUTE),
        createdAt: NOW,
        ...overrides,
      } as CaravanEncounter,
    ];
    const arrived = input({ caravan: ARRIVED });
    expect(hasDueCaravanWork({ ...arrived, encounters: fought({}) }, NOW)).toBe(false);
    expect(
      hasDueCaravanWork(
        { ...input(), blockedRouteIds: new Set(["r1"]), encounters: fought({}) },
        NOW,
      ),
    ).toBe(false);
    // A fight over another caravan holds nothing back.
    expect(
      hasDueCaravanWork({ ...arrived, encounters: fought({ caravanId: "c2" }) }, NOW),
    ).toBe(true);
    // The fight itself coming due is work, and so is an unrolled checkpoint.
    expect(
      hasDueCaravanWork({ ...arrived, encounters: fought({ expiresAt: NOW }) }, NOW),
    ).toBe(true);
    expect(
      hasDueCaravanWork(
        {
          ...input({ caravan: { checkpointsProcessed: 0 } }),
          encounters: fought({}),
        },
        NOW,
      ),
    ).toBe(true);
  });

  it("finds due operations and fights, not ones still under way", () => {
    expect(
      hasDueCaravanWork(
        { ...input(), dueOperations: [{ id: "op" } as CaravanOperation] },
        NOW,
      ),
    ).toBe(true);
    const encounter = (overrides: Partial<CaravanEncounter>) => ({
      ...input(),
      encounters: [
        {
          id: "e1",
          type: "AMBUSH",
          status: "PENDING",
          caravanId: "c1",
          expiresAt: new Date(NOW.getTime() + MINUTE),
          createdAt: NOW,
          ...overrides,
        } as CaravanEncounter,
      ],
    });
    expect(hasDueCaravanWork(encounter({}), NOW)).toBe(false);
    expect(hasDueCaravanWork(encounter({ expiresAt: NOW }), NOW)).toBe(true);
    expect(hasDueCaravanWork(encounter({ status: "FIGHTING" }), NOW)).toBe(false);
    expect(hasDueCaravanWork(encounter({ status: "STARTING" }), NOW)).toBe(false);
    expect(
      hasDueCaravanWork(
        encounter({
          status: "STARTING",
          createdAt: new Date(
            NOW.getTime() - (CARAVAN_ENCOUNTER_STALE_MINUTES + 1) * MINUTE,
          ),
        }),
        NOW,
      ),
    ).toBe(true);
    expect(
      hasDueCaravanWork(
        encounter({
          status: "FIGHTING",
          createdAt: new Date(
            NOW.getTime() - (CARAVAN_ENCOUNTER_STALE_MINUTES + 1) * MINUTE,
          ),
        }),
        NOW,
      ),
    ).toBe(true);
  });
});

/** A caravan that just arrived, every checkpoint on the way already rolled. */
const ARRIVED = {
  arrivesAt: new Date(NOW.getTime() - 1),
  checkpointsProcessed: CARAVAN_CHECKPOINTS,
};

/** A caravan a third of the way along that has rolled its first checkpoint. */
const input = (overrides: { caravan?: Partial<Caravan> } = {}) => ({
  caravans: [
    {
      id: "c1",
      routeId: "r1",
      status: "TRAVELLING",
      departedAt: new Date(NOW.getTime() - 40 * MINUTE),
      arrivesAt: new Date(NOW.getTime() + 80 * MINUTE),
      checkpointsProcessed: 1,
      ...overrides.caravan,
    } as Caravan,
  ],
  encounters: [] as CaravanEncounter[],
  dueOperations: [] as CaravanOperation[],
  blockedRouteIds: new Set<string>(),
});
