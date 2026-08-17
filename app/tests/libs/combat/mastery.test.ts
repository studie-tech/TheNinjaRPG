import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/db", () => ({ drizzleDB: {} }));

import { availableUserActions } from "@/libs/combat/actions";
import { applyEffects } from "@/libs/combat/process";
import {
  decreaseMastery,
  increaseMastery,
  increaseStats,
  updateStatUsage,
} from "@/libs/combat/tags";
import { damageCalc } from "@/libs/combat/tags";
import { dmgConfig } from "@/libs/combat/constants";
import type { CompleteBattle } from "@/libs/combat/types";
import {
  makeDamageEffect,
  makeEffect,
  makeUser,
} from "./helpers/battleScenario";

describe("increaseMastery", () => {
  it("raises the selected mastery without changing offence or defence", () => {
    const target = makeUser({
      userId: "user",
      ninjutsuMastery: 1000,
      offence: 2000,
      defence: 2000,
    });
    const effect = makeEffect(
      "increasemastery",
      {
        masteryTypes: ["Ninjutsu"],
        calculation: "static",
        power: 250,
        powerPerLevel: 0,
      },
      {
        isNew: false,
        castThisRound: false,
        targetId: "user",
      },
    );

    increaseMastery(effect, [], target);

    expect(target.ninjutsuMastery).toBe(1250);
    expect(target.offence).toBe(2000);
    expect(target.defence).toBe(2000);
  });
});

describe("decreaseMastery", () => {
  it("lowers the selected mastery without changing offence or defence", () => {
    const target = makeUser({
      userId: "user",
      ninjutsuMastery: 1000,
      offence: 2000,
      defence: 2000,
    });
    const effect = makeEffect(
      "decreasemastery",
      {
        masteryTypes: ["Ninjutsu"],
        calculation: "static",
        power: 250,
        powerPerLevel: 0,
      },
      {
        isNew: false,
        castThisRound: false,
        targetId: "user",
      },
    );

    decreaseMastery(effect, [], target);

    expect(target.ninjutsuMastery).toBe(750);
    expect(target.offence).toBe(2000);
    expect(target.defence).toBe(2000);
  });
});

describe("updateStatUsage", () => {
  it("credits both offence and defence when direction is both", () => {
    const user = makeUser({ userId: "user" });
    updateStatUsage(
      user,
      makeEffect("increasestat", {
        statTypes: ["Ninjutsu"],
        direction: "both",
      }),
    );
    expect(user.usedStats.offence).toBe(1);
    expect(user.usedStats.defence).toBe(1);
  });
});

describe("increaseStats", () => {
  it("reports the unified combat stats it changed, not the jutsu types listed", () => {
    const target = makeUser({ userId: "user", username: "Naruto", offence: 1000 });
    const effect = makeEffect(
      "increasestat",
      {
        statTypes: ["Ninjutsu"],
        direction: "offence",
        calculation: "static",
        power: 250,
        powerPerLevel: 0,
        rounds: 5,
      },
      { targetId: "user", isNew: true, castThisRound: false },
    );

    const info = increaseStats(effect, [], target);

    expect(info?.txt).toContain("Offence");
    expect(info?.txt).not.toContain("Ninjutsu");
  });
});

describe("applyEffects mastery persistence", () => {
  it("persists increasemastery onto the returned usersState without stacking", () => {
    const user = makeUser({
      userId: "actor",
      ninjutsuMastery: 1000,
    });
    const effect = makeEffect(
      "increasemastery",
      {
        masteryTypes: ["Ninjutsu"],
        calculation: "static",
        power: 250,
        powerPerLevel: 0,
        rounds: 5,
      },
      {
        creatorId: "actor",
        targetId: "actor",
        targetType: "user",
        isNew: false,
        castThisRound: false,
        createdRound: 0,
      },
    );
    const battle = {
      id: "battle-1",
      battleType: "COMBAT",
      width: 5,
      height: 5,
      round: 2,
      createdAt: new Date("2020-01-01T00:00:00Z"),
      updatedAt: new Date("2020-01-01T00:00:00Z"),
      roundStartAt: new Date("2020-01-01T00:00:00Z"),
      usersState: [user],
      usersEffects: [effect],
      groundEffects: [],
      extraState: { dmgConfig },
    } as unknown as CompleteBattle;

    const first = applyEffects(battle, "actor");
    const firstUser = first.newBattle.usersState[0];
    expect(firstUser?.ninjutsuMastery).toBe(1250);

    const second = applyEffects(first.newBattle, "actor");
    const secondUser = second.newBattle.usersState[0];
    expect(secondUser?.ninjutsuMastery).toBe(1250);
  });
});

describe("damage ignores mastery", () => {
  it("does not change damage when only mastery differs", () => {
    const effect = makeDamageEffect({ statTypes: ["Ninjutsu"] });
    const defender = makeUser({ userId: "defender" });
    const lowMastery = makeUser({
      userId: "attacker",
      ninjutsuMastery: 10,
    });
    const highMastery = makeUser({
      userId: "attacker",
      ninjutsuMastery: 1_000_000,
    });

    expect(damageCalc(effect, highMastery, defender, dmgConfig)).toBe(
      damageCalc(effect, lowMastery, defender, dmgConfig),
    );
  });
});

describe("availableUserActions mastery gating", () => {
  const makeBattle = (mastery: number): CompleteBattle => {
    const user = makeUser({
      userId: "actor",
      ninjutsuMastery: mastery,
      jutsus: [
        {
          id: "user-jutsu-1",
          jutsuId: "gated-jutsu",
          level: 1,
          equipped: true,
          experience: 0,
          lastUsedRound: -10,
          originalCooldown: 0,
          origin: "user",
        },
      ],
    });
    return {
      id: "battle-1",
      battleType: "COMBAT",
      width: 5,
      height: 5,
      round: 1,
      createdAt: new Date("2020-01-01T00:00:00Z"),
      updatedAt: new Date("2020-01-01T00:00:00Z"),
      roundStartAt: new Date("2020-01-01T00:00:00Z"),
      usersState: [user],
      usersEffects: [],
      groundEffects: [],
      extraState: {
        jutsus: {
          "gated-jutsu": {
            id: "gated-jutsu",
            name: "Gated Jutsu",
            image: "/jutsu.png",
            battleDescription: "test",
            target: "OTHER_USER",
            method: "SINGLE",
            range: 1,
            healthCost: 0,
            chakraCost: 0,
            staminaCost: 0,
            healthCostReducePerLvl: 0,
            chakraCostReducePerLvl: 0,
            staminaCostReducePerLvl: 0,
            actionCostPerc: 10,
            battleUsageType: "ANY",
            jutsuWeapon: "NONE",
            requiredNinjutsuMastery: 500,
            effects: [],
          },
        },
        jutsuReskins: {},
        items: {},
        bloodlines: {},
        villages: {},
        anbuSquads: {},
        keystoneItems: {},
        wars: {},
        aiProfiles: {},
        relations: {},
        clans: {},
        userQuests: {},
        completedQuests: {},
        questData: {},
        bounties: {},
        bountySignups: {},
      },
    } as unknown as CompleteBattle;
  };

  it("hides jutsu the user cannot meet mastery requirements for", () => {
    const actions = availableUserActions(makeBattle(100), "actor", false);
    expect(actions.some((action) => action.id === "gated-jutsu")).toBe(false);
  });

  it("shows jutsu once the user meets mastery requirements", () => {
    const actions = availableUserActions(makeBattle(500), "actor", false);
    expect(actions.some((action) => action.id === "gated-jutsu")).toBe(true);
  });

  it("keeps gated jutsu visible when masteries are masked off the user", () => {
    const battle = makeBattle(100);
    const actor = battle.usersState[0];
    if (actor) {
      delete (actor as { ninjutsuMastery?: number }).ninjutsuMastery;
    }
    const actions = availableUserActions(battle, "actor", false);
    expect(actions.some((action) => action.id === "gated-jutsu")).toBe(true);
  });
});
