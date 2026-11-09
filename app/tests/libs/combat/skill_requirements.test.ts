import { describe, expect, it } from "bun:test";
import { handleInjectedJutsus } from "@/libs/combat/actions";
import { SAGE_MODE_ACTIVATION_JUTSU } from "@/libs/sageMode";
import { makeBattleUser, makeInjectBattle, makeJutsu } from "../../setup/combat";

const injected = makeJutsu({ id: "injected", requiredSkillId: "required" });

describe("injected jutsu skill requirements", () => {
  it("gates effect grants using the skill IDs preloaded in battle state", () => {
    const user = makeBattleUser("user", { activeSkillIds: [] });
    const battle = makeInjectBattle(user, { jutsus: { injected } });
    battle.usersEffects = [
      {
        type: "injectjutsus",
        targetId: user.userId,
        rounds: 10,
        createdRound: 0,
        jutsuIds: [injected.id],
        power: 1,
        isNew: false,
        castThisRound: false,
      },
    ] as typeof battle.usersEffects;
    expect(handleInjectedJutsus(battle, user)).toEqual([]);
    user.activeSkillIds = ["required"];
    expect(handleInjectedJutsus(battle, user).map((j) => j.jutsuId)).toContain(
      "injected",
    );
    user.jutsus = handleInjectedJutsus(battle, user);
    user.activeSkillIds = [];
    expect(handleInjectedJutsus(battle, user)).toEqual([]);
  });
});

it("preserves masked opponent action availability without revealing skills", () => {
  const user = makeBattleUser("opponent", { skillLockedJutsuIds: ["injected"] });
  const battle = makeInjectBattle(user, { jutsus: { injected } });
  battle.usersEffects = [
    {
      type: "injectjutsus",
      targetId: user.userId,
      rounds: 10,
      createdRound: 0,
      jutsuIds: [injected.id],
      power: 1,
      isNew: false,
      castThisRound: false,
    },
  ] as typeof battle.usersEffects;
  expect(handleInjectedJutsus(battle, user)).toEqual([]);
  user.skillLockedJutsuIds = [];
  expect(handleInjectedJutsus(battle, user).map((j) => j.jutsuId)).toContain(
    "injected",
  );
});

it("does not waive player requirements when the battle controls their turns as AI", () => {
  const user = makeBattleUser("projection", {
    isAi: true,
    activeSkillIds: [],
    sageModeId: "mode",
  });
  const battle = makeInjectBattle(user, {
    jutsus: {
      [SAGE_MODE_ACTIVATION_JUTSU.id]: {
        ...SAGE_MODE_ACTIVATION_JUTSU,
        requiredSkillId: "required",
      },
    },
  });
  expect(handleInjectedJutsus(battle, user)).toEqual([]);
});
