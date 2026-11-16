import { describe, expect, it } from "bun:test";
import { clone } from "@/libs/combat/tags";
import type { GroundEffect } from "@/libs/combat/types";
import {
  applyPoolAdjustmentsToBase,
  getEffectiveMaxPool,
  syncPoolAdjustments,
} from "@/libs/combat/util";
import { calcHP } from "@/libs/profile";
import { makeBattleUser, makeEffect } from "../../setup/combat";

const LEVEL = 20;

const makeCaster = () =>
  makeBattleUser("caster", {
    isAi: false,
    level: LEVEL,
    maxHealth: calcHP(LEVEL),
    curHealth: calcHP(LEVEL),
    maxChakra: 1000,
    curChakra: 1000,
    maxStamina: 1000,
    curStamina: 1000,
  });

/** A +50% maximum-pool buff on the caster, as from a bloodline or buff jutsu. */
const casterPoolBuff = () =>
  makeEffect(
    "increasemaxpools",
    {
      power: 50,
      calculation: "percentage",
      poolsAffected: ["Health", "Chakra", "Stamina"],
    },
    { creatorId: "caster", targetId: "caster" },
  );

const makeCloneEffect = () =>
  ({
    id: "clone-effect",
    type: "clone",
    creatorId: "caster",
    isNew: true,
    castThisRound: true,
    rounds: 3,
    longitude: 2,
    latitude: 2,
    power: 50,
    level: 1,
    powerPerLevel: 0,
    calculation: "percentage",
  }) as unknown as GroundEffect;

describe("clone pools", () => {
  it("spawns with full pools when the caster carries a maximum-pool buff", () => {
    const caster = makeCaster();
    const effects = [casterPoolBuff()];
    applyPoolAdjustmentsToBase(caster, effects);
    const usersState = [caster];

    clone(usersState, makeCloneEffect(), { jutsus: {} });
    const spawned = usersState.find((u) => u.username === "caster clone");
    if (!spawned) throw new Error("clone was not spawned");
    syncPoolAdjustments(usersState, effects);

    expect(spawned.curHealth).toBe(getEffectiveMaxPool(spawned, effects, "Health"));
    expect(spawned.curChakra).toBe(getEffectiveMaxPool(spawned, effects, "Chakra"));
    expect(spawned.curStamina).toBe(getEffectiveMaxPool(spawned, effects, "Stamina"));
    // The caster keeps its own buffed pools.
    expect(caster.curHealth).toBe(getEffectiveMaxPool(caster, effects, "Health"));
  });
});
