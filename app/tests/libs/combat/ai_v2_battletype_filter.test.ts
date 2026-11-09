import { makeAiBattle, makeAiUser as mkUser } from "./helpers/aiScenario";
import { makeJutsu, makeTag } from "../../setup/combat";
import { describe, it, expect } from "bun:test";
import { Grid, rectangle } from "honeycomb-grid";
import { performAIaction } from "@/libs/combat/ai_v2";
import { ActionUseSpecificJutsu } from "@/validators/ai";
import type { BattleType } from "@/drizzle/constants";
import type { CompleteBattle, ExtraState } from "@/libs/combat/types";

/**
 * Integration cover for the ai_v2 candidate filter -- the CALL SITE, not just the
 * predicate. Deleting the filter must fail something, otherwise an AI in an
 * auto-resolved battle burns its turn casting a summon that summon() then
 * refuses, and re-casts it every round because does_not_have_summon stays true.
 *
 * The ARENA case is a positive control: if the AI stops casting the summon there
 * for unrelated reasons, that test fails too and this file cannot go vacuous.
 */

import { TerrainHex } from "@/libs/hexgrid";

const SUMMON_JUTSU = "j-summon";
const PROFILE = "profile-1";

const summonJutsu = makeJutsu({
  id: SUMMON_JUTSU,
  name: "Test Summon",
  battleDescription: "summons",
  target: "EMPTY_GROUND",
  range: 4,
  effects: [makeTag("summon", {
    aiId: "creature-1", aiHp: 1000, rounds: 4,
    power: 70, powerPerLevel: 0, calculation: "percentage",
    target: "INHERIT", friendlyFire: "ENEMIES", description: "summon",
  })],
});

const mkBattle = (battleType: BattleType): CompleteBattle =>
  makeAiBattle({
    battleType, activeUserId: "ai1", width: 10, height: 10,
    usersState: [
      mkUser({ userId: "ai1", username: "Caster", controllerId: "ai1",
        aiProfileId: PROFILE, longitude: 2, latitude: 2,
        jutsus: [{ id: "uj1", jutsuId: SUMMON_JUTSU, level: 1, experience: 0,
                   equipped: true, lastUsedRound: -99, originalCooldown: 0 }] }),
      mkUser({ userId: "foe", username: "Foe", controllerId: "foe", isAi: false,
        longitude: 6, latitude: 6 }),
      // Hidden clone-source template the summon tag would copy from.
      mkUser({ userId: "tmpl", username: "Creature", controllerId: "creature-1",
        isSummon: true, isSummonTemplate: true, curHealth: 0,
        longitude: 0, latitude: 0 }),
    ],
    extraState: {
      jutsus: { [SUMMON_JUTSU]: summonJutsu },
      aiProfiles: {
        [PROFILE]: {
          id: PROFILE, name: "always summon", includeDefaultRules: false,
          rules: [{
            conditions: [],
            // EMPTY_GROUND jutsu: aim at a free tile, not at the opponent's
            // occupied one, or insertAction rejects it before the filter matters.
            action: ActionUseSpecificJutsu.parse({
              jutsuId: SUMMON_JUTSU,
              target: "EMPTY_GROUND_CLOSEST_TO_SELF",
            }),
          }],
        },
      } as unknown as ExtraState["aiProfiles"],
    },
  });

/**
 * Assert on what the AI SELECTED, not on the resulting ground effect. Counting
 * summon ground effects looks equivalent but is not: performBattleAction runs
 * applyEffects in the same pass, so summon()'s own auto-battle backstop sweeps
 * the effect -- the count is 0 in KAGE_AI whether or not the candidate filter
 * exists, which makes that assertion blind to this filter.
 */
const actionPickedByAi = (battleType: BattleType) => {
  const grid = new Grid(TerrainHex, rectangle({ width: 10, height: 10 }));
  const { nextActionId } = performAIaction(mkBattle(battleType), grid, "ai1");
  return nextActionId;
};

describe("ai_v2 candidate filter by battle type", () => {
  it("POSITIVE CONTROL: the AI does pick the summon in ARENA", () => {
    // If this fails, the assertions below prove nothing -- fix this one first.
    expect(actionPickedByAi("ARENA")).toBe(SUMMON_JUTSU);
  });

  it("never picks the summon in KAGE_AI", () => {
    expect(actionPickedByAi("KAGE_AI")).not.toBe(SUMMON_JUTSU);
  });

  it("never picks the summon in CLAN_CHALLENGE", () => {
    expect(actionPickedByAi("CLAN_CHALLENGE")).not.toBe(SUMMON_JUTSU);
  });
});
