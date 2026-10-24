import { expect, it } from "bun:test";
import {
  getUserCaps,
  REGEN_SECONDS,
  STATS_PER_ENERGY,
  TERRITORY_WAR_BOOST_PERCENT,
} from "@/drizzle/constants";
import { settleEnergyTrainingQueue } from "@/libs/train";
import type { UserWithRelations } from "@/routers/profile";
import { makeBattleUser } from "./combat/helpers/battleScenario";

const start = new Date("2026-10-24T12:00:00Z");
const after = (ticks: number) =>
  new Date(start.getTime() + ticks * REGEN_SECONDS * 1000);
const queue = [{ stat: "strength" as const, energy: 100 }];
const room = 100 * STATS_PER_ENERGY;
const boostedRate = 1 + TERRITORY_WAR_BOOST_PERCENT / 100;
const trainee = (regeneration: number, boostStart = 1) =>
  ({
    ...makeBattleUser("trainee"),
    rank: "JONIN",
    status: "AWAKE",
    isBanned: false,
    isOutlaw: true,
    villageId: null,
    clanId: null,
    village: null,
    clan: null,
    curEnergy: 0,
    maxEnergy: 100,
    regeneration,
    regenAt: start,
    strength: getUserCaps("JONIN").gens_cap - room,
    territoryWarBoostWindows: [{
      startsAt: after(boostStart).toISOString(),
      endsAt: after(boostStart + 60).toISOString(),
    }],
  }) as unknown as NonNullable<UserWithRelations>;

it.each([
  { regeneration: 10, ticks: 9 },
  { regeneration: 11, ticks: 10 },
  { regeneration: 1.5, ticks: 70 },
])("settles capped Energy training across victory at $regeneration Energy per tick after $ticks ticks", ({ regeneration, ticks }) => {
  const user = trainee(regeneration);
  const offline = settleEnergyTrainingQueue(user, queue, [], ticks);
  const first = settleEnergyTrainingQueue(user, queue, [], 1);
  const refreshed = settleEnergyTrainingQueue(
    { ...user, regenAt: after(1), curEnergy: first.curEnergy },
    first.remaining,
    [],
    ticks - 1,
  );
  expect(offline.consumed).toBe(1);
  expect(offline.gains.strength).toBeCloseTo(room);
  expect(offline.curEnergy).toBeCloseTo(ticks * regeneration - 100 / boostedRate);
  expect(offline).toEqual(refreshed);
});

it("requires the unboosted cost when Energy first becomes affordable on the expiry tick", () => {
  const user = trainee(10, -51);
  const atExpiry = settleEnergyTrainingQueue(user, queue, [], 9);
  expect(atExpiry.consumed).toBe(0);
  expect(atExpiry.curEnergy).toBe(90);
  const later = settleEnergyTrainingQueue(user, queue, [], 10);
  expect(later.consumed).toBe(1);
  expect(later.gains.strength).toBeCloseTo(room);
  expect(later.curEnergy).toBeCloseTo(0);
});
