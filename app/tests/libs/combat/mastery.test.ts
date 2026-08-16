import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/db", () => ({ drizzleDB: {} }));

import { availableUserActions } from "@/libs/combat/actions";
import { increaseMastery } from "@/libs/combat/tags";
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
});
