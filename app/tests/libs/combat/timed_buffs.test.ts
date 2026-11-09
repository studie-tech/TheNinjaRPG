import { describe, expect, it } from "bun:test";
import { applyEffects } from "@/libs/combat/process";
import { getPower, realizeTag } from "@/libs/combat/tags";
import {
  getTimedRegeneration,
  getTimedRegenerationGain,
  getTimedRegenerationPeriods,
  getRegenerationPeriodGain,
} from "@/libs/timedBuffs";
import { IncreaseRegenerationTag } from "@/validators/combat";
import { makeCompleteBattle, makeEffect, makeUser } from "../../setup/combat";

const statBuff = (id: string, power: number, expires: number, patch = {}) =>
  makeEffect(
    "increasestat",
    {
      statTypes: ["Ninjutsu"],
      direction: "offence",
      power,
      powerPerLevel: 0,
      ...patch,
    },
    {
      id,
      creatorId: "user",
      targetId: "user",
      targetType: "user",
      fromType: "item",
      isNew: false,
      castThisRound: false,
      timedBuffExpiresAt: expires,
    },
  );

describe("timed meal and raid effects", () => {
  it("uses the strongest overlap, retains independent stats and ordinary combat stacking", () => {
    const user = makeUser({ userId: "user", offence: 1000, defence: 1000 });
    const live = Date.now() + 60000;
    const meal = statBuff("meal", 10, live);
    const raid = statBuff("raid", 20, live, { direction: "both" });
    const ordinary = makeEffect(
      "increasestat",
      { statTypes: ["Ninjutsu"], direction: "offence", power: 5 },
      {
        creatorId: "user",
        targetId: "user",
        targetType: "user",
        fromType: "jutsu",
        isNew: false,
      },
    );
    const battle = makeCompleteBattle({
      usersState: [user],
      usersEffects: [meal, raid, ordinary],
    });
    applyEffects(battle, "user");
    expect(user.offence).toBe(1250);
    expect(user.defence).toBe(1200);
  });
  it("does not apply an expired stronger effect on the first action after expiry", () => {
    const user = makeUser({ userId: "user", offence: 1000 });
    const battle = makeCompleteBattle({
      usersState: [user],
      usersEffects: [
        statBuff("meal", 50, Date.now() - 1),
        statBuff("raid", 10, Date.now() + 60000),
      ],
    });
    applyEffects(battle, "user");
    expect(user.offence).toBe(1100);
  });
  it("compares flat and percentage effects against a stable base", () => {
    for (const reverse of [false, true]) {
      const user = makeUser({ userId: "user", offence: 1000 });
      const buffs = [
        statBuff("flat", 100, Date.now() + 60000, { calculation: "static" }),
        statBuff("percent", 9.5, Date.now() + 60000),
      ];
      applyEffects(
        makeCompleteBattle({
          usersState: [user],
          usersEffects: reverse ? buffs.reverse() : buffs,
        }),
        "user",
      );
      expect(user.offence).toBe(1100);
    }
  });
  it.each([false, true])(
    "compares timed bonuses by capped combat power (reverse order: %s)",
    (reverse) => {
      const user = makeUser({ userId: "user", offence: 100 });
      const live = Date.now() + 60000;
      const buffs = [
        statBuff("meal", 150, live, { calculation: "static" }),
        statBuff("raid", 200, live),
      ].map((tag) => ({
        ...realizeTag({ tag, user, actionId: tag.id, level: 0 }),
        isNew: false,
        castThisRound: false,
      }));
      expect(buffs[1]!.power).toBe(200);
      expect(getPower(buffs[1]!).power).toBe(100);
      applyEffects(
        makeCompleteBattle({
          usersState: [user],
          usersEffects: reverse ? buffs.reverse() : buffs,
        }),
        "user",
      );
      expect(user.offence).toBe(250);
    },
  );
  it("integrates offline regeneration without extending past expiry or stacking overlaps", () => {
    const start = new Date("2026-01-01T00:00:00Z");
    const buff = {
      createdAt: start,
      expiresAt: new Date(start.getTime() + 30000),
      effects: [IncreaseRegenerationTag.parse({ power: 50 })],
    };
    const weaker = { ...buff, effects: [IncreaseRegenerationTag.parse({ power: 20 })] };
    expect(
      getTimedRegeneration(10, [buff, weaker], new Date(start.getTime() + 10000)),
    ).toBe(15);
    expect(getTimedRegeneration(10, [buff], buff.expiresAt)).toBe(10);
    expect(getTimedRegenerationGain(10, [buff, weaker], start, 4, 10)).toBe(50);
  });
});

it("uses non-stacking continuous Energy intervals only while a timed bonus is active", () => {
  const start = new Date("2026-01-01T00:00:00Z");
  const buff = {
    createdAt: start,
    expiresAt: new Date(start.getTime() + 30000),
    effects: [IncreaseRegenerationTag.parse({ power: 50 })],
  };
  const weaker = {
    ...buff,
    expiresAt: new Date(start.getTime() + 60000),
    effects: [IncreaseRegenerationTag.parse({ power: 20 })],
  };
  const periods = getTimedRegenerationPeriods(10, [buff, weaker]);
  expect(
    getRegenerationPeriodGain(periods, start, new Date(start.getTime() + 120000), 60),
  ).toBe(3.5);
  expect(
    getRegenerationPeriodGain(
      periods,
      new Date(start.getTime() + 60000),
      new Date(start.getTime() + 120000),
      60,
    ),
  ).toBe(0);
});
