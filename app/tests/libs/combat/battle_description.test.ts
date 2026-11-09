import { describe, expect, it } from "bun:test";
import { insertAction } from "@/libs/combat/actions";
import type { CombatAction, GroundEffect, ReturnedBattle } from "@/libs/combat/types";
import { getBattleGrid } from "@/libs/combat/util";
import { DamageTag } from "@/validators/combat";
import { makeBattleUser, makeCompleteBattle } from "../../setup/combat";

const PLACEHOLDERS =
  "%user_subject %user_object %user_posessive %user_reflexive | %target_subject %target_object %target_posessive %target_reflexive";

const makeAction = (method: CombatAction["method"] = "SINGLE"): CombatAction =>
  ({
    id: "strike",
    name: "Strike",
    type: "jutsu",
    target: "OTHER_USER",
    method,
    range: 5,
    battleDescription: PLACEHOLDERS,
    healthCost: 0,
    chakraCost: 0,
    staminaCost: 0,
    actionCostPerc: 10,
    cooldown: 0,
    originalCooldown: 0,
    level: 1,
    effects: [DamageTag.parse({ power: 10 })],
  }) as unknown as CombatAction;

const describeStrike = (actorGender: string, targetGender?: string) => {
  const target = targetGender
    ? [
        makeBattleUser("target", {
          gender: targetGender,
          direction: "right",
          longitude: 4,
          latitude: 3,
        }),
      ]
    : [];
  const battle = makeCompleteBattle({
    width: 13,
    height: 9,
    createdAt: new Date(),
    updatedAt: new Date(),
    roundStartAt: new Date(),
    usersState: [
      makeBattleUser("actor", {
        gender: actorGender,
        direction: "left",
        longitude: 3,
        latitude: 3,
      }),
      ...target,
    ],
    groundEffects: targetGender ? [] : [makeBarrier()],
  });
  const action = makeAction(targetGender ? "SINGLE" : "AOE_CIRCLE_SPAWN");
  const inserted = insertAction({
    battle,
    grid: getBattleGrid(20, battle as unknown as ReturnedBattle),
    action,
    actorId: "actor",
    longitude: 4,
    latitude: 3,
  });
  expect(inserted).toBe(true);
  return action.battleDescription;
};

describe("insertAction battle description pronouns", () => {
  it("renders subject, object, possessive and reflexive forms for a single target", () => {
    expect(describeStrike("Male", "Female")).toContain(
      "he him his himself | she her hers herself",
    );
    expect(describeStrike("Female", "Male")).toContain(
      "she her hers herself | he him his himself",
    );
  });

  it("renders neuter forms for a lone barrier target", () => {
    expect(describeStrike("Male")).toContain("he him his himself | it it its itself");
  });
});

const makeBarrier = (): GroundEffect =>
  ({
    id: "barrier-1",
    type: "barrier",
    creatorId: "enemy",
    longitude: 4,
    latitude: 3,
    level: 0,
    power: 10,
    absorbPercentage: 50,
    curHealth: 1000,
    maxHealth: 1000,
    isNew: false,
    castThisRound: false,
    createdRound: 0,
    barrierAbsorb: 0,
    actionId: "barrier-action",
    rounds: 10,
  }) as unknown as GroundEffect;
