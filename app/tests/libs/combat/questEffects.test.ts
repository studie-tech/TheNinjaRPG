import { describe, expect, it } from "bun:test";
import { addQuestStartingEffects } from "@/libs/combat/questEffects";
import { applyEffects } from "@/libs/combat/process";
import { flee, realizeTag } from "@/libs/combat/tags";
import type { UserEffect } from "@/libs/combat/types";
import { getEffectiveMaxPool } from "@/libs/combat/util";
import { calcApReduction } from "@/libs/combat/turn";
import {
  getTagSchema,
  PreventTagTypes,
  questBuffTypes,
  questDebuffTypes,
  type ZodAllTags,
} from "@/validators/combat";
import { makeBattleUser, makeCompleteBattle } from "../../setup/combat";

describe("opening quest effects", () => {
  it("resolves failed/successful stuns before the first action without mutating content", () => {
    for (const power of [0, 100]) {
      const player = makeBattleUser("hero");
      const effects: UserEffect[] = [];
      const tag = getTagSchema("stun").parse({
        power,
        rounds: 3,
        apReduction: 20,
      }) as ZodAllTags;
      addQuestStartingEffects(player, effects, [tag], "quest");
      expect(
        calcApReduction(
          makeCompleteBattle({ usersState: [player], usersEffects: effects }),
          player.userId,
        ),
      ).toBe(power === 0 ? 0 : 20);
      expect(tag.rounds).toBe(3);
      expect(effects[0]?.targetId).toBe(player.userId);
      expect(effects[0]?.castThisRound).toBe(false);
      expect(effects[0]?.createdRound).toBe(-1);
    }
  });
  it("materializes shield HP and effective pool capacity from complete tags", () => {
    const player = makeBattleUser("hero", { maxHealth: 100 });
    const effects: UserEffect[] = [];
    const tags = [
      getTagSchema("shield").parse({ power: 100, health: 500, rounds: 3 }),
      getTagSchema("increasemaxpools").parse({
        power: 50,
        calculation: "percentage",
        poolsAffected: ["Health"],
        rounds: 3,
      }),
    ] as ZodAllTags[];
    addQuestStartingEffects(player, effects, tags, "quest");
    expect(effects[0]?.power).toBe(500);
    expect(getEffectiveMaxPool(player, effects, "Health")).toBe(150);
  });
  const startingTagTypes = new Set<string>([...questBuffTypes, ...questDebuffTypes]);
  const startingPreventTypes = PreventTagTypes.filter((type) =>
    startingTagTypes.has(type),
  );
  for (const type of startingPreventTypes) {
    it(`resolves immunity before starting ${type}, even when authored last`, () => {
      const player = makeBattleUser("hero");
      const effects: UserEffect[] = [];
      const tags = [
        getTagSchema(type).parse({ power: 100, rounds: 3 }),
        getTagSchema("immunity").parse({ blocks: type, rounds: 3 }),
      ] as ZodAllTags[];
      addQuestStartingEffects(player, effects, tags, "quest");
      const battle = applyEffects(
        makeCompleteBattle({ usersState: [player], usersEffects: effects }),
        player.userId,
      ).newBattle;
      expect(
        battle.usersEffects.find((effect) => effect.type === type)?.rounds ?? 0,
      ).toBe(0);
      expect(tags[0]?.rounds).toBe(3);
    });
    it(`expires a failed starting ${type} before the opening action`, () => {
      const player = makeBattleUser("hero");
      const effects: UserEffect[] = [];
      addQuestStartingEffects(
        player,
        effects,
        [getTagSchema(type).parse({ power: 0, rounds: 3 }) as ZodAllTags],
        "quest",
      );
      expect(effects[0]?.rounds).toBe(0);
    });
  }
  it("allows the opening flee action when starting immunity blocks flee prevention", () => {
    const player = makeBattleUser("hero");
    const effects: UserEffect[] = [];
    addQuestStartingEffects(
      player,
      effects,
      [
        getTagSchema("fleeprevent").parse({ power: 100, rounds: 3 }),
        getTagSchema("immunity").parse({ blocks: "fleeprevent", rounds: 3 }),
      ] as ZodAllTags[],
      "quest",
    );
    const action = realizeTag({
      tag: getTagSchema("flee").parse({ power: 100 }) as UserEffect,
      user: player,
      level: 0,
      actionId: "flee",
      round: 1,
    });
    flee(action, effects, player);
    expect(player.fledBattle).toBe(true);
  });
});
