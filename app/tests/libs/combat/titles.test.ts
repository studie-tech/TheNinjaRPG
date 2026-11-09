import { expect, it } from "bun:test";
import { RANKED_PVP_STATS, REGEN_SECONDS } from "@/drizzle/constants";
import { applyEffects } from "@/libs/combat/process";
import { clear } from "@/libs/combat/tags";
import type { CombatQueryUser } from "@/libs/combat/types";
import { isEffectActive } from "@/libs/combat/util";
import { hasMasteryRequirements } from "@/libs/mastery";
import { makeCompleteBattle, makeEffect } from "../../setup/combat";
import { makeCombatQueryUser, preloadBattle } from "./helpers/preload";

const titleUser = () =>
  makeCombatQueryUser("title-caster", {
    ninjutsuMastery: 100,
    activeTitleId: null,
    titles: [
      {
        userId: "title-caster",
        titleId: "hero",
        createdAt: new Date(),
        effects: [{ type: "increasemastery", power: 15, masteryTypes: ["Ninjutsu"] }],
      },
    ],
  });

const preload = (
  caster: CombatQueryUser,
  battleType: "COMBAT" | "RANKED_PVP" | "RANKED_SPARRING" = "COMBAT",
) => preloadBattle([caster], { battleType });

it.each(["increasemastery", "increaseregeneration"] as const)(
  "reprocesses a JSON combatant with a %s title after regeneration ticks elapse",
  async (type) => {
    const caster = titleUser();
    caster.regenAt = new Date(Date.now() - REGEN_SECONDS * 2500);
    caster.status = "AWAKE";
    caster.regeneration = 10;
    caster.curHealth = caster.curChakra = caster.curStamina = 100;
    caster.titles![0]!.createdAt = new Date(caster.regenAt.getTime() - 1000);
    caster.titles![0]!.effects = [
      type === "increasemastery"
        ? { type, power: 15, masteryTypes: ["Ninjutsu"] }
        : { type, power: 5 },
    ];
    const serialized = JSON.parse(JSON.stringify(caster)) as CombatQueryUser;
    expect(typeof serialized.regenAt).toBe("string");
    const expected = (await preload(caster)).usersState[0]!;
    const actual = (await preload(serialized)).usersState[0]!;
    expect(expected.curHealth).toBeGreaterThan(100);
    expect(actual.curHealth).toBe(expected.curHealth);
    expect(actual.curChakra).toBe(expected.curChakra);
    expect(actual.curStamina).toBe(expected.curStamina);
  },
);

it("preloads every owned title mastery once, omits transient ownership and retains encounter snapshots", async () => {
  const caster = titleUser();
  const loaded = await preload(caster);
  expect(
    loaded.userEffects.filter((effect) => effect.type === "increasemastery"),
  ).toHaveLength(1);
  expect(loaded.usersState[0]).not.toHaveProperty("titles");
  caster.titles = [];
  const battle = makeCompleteBattle({
    usersState: loaded.usersState,
    usersEffects: loaded.userEffects,
    extraState: loaded.extraState,
  });
  expect(
    applyEffects(battle, caster.userId).newBattle.usersState[0]?.ninjutsuMastery,
  ).toBe(115);
  caster.titles = [
    {
      userId: caster.userId,
      titleId: "hero",
      createdAt: new Date(),
      effects: [{ type: "increasemastery", power: 15, masteryTypes: ["Ninjutsu"] }],
    },
  ];
  Object.assign(caster, RANKED_PVP_STATS);
  for (const battleType of ["RANKED_PVP", "RANKED_SPARRING"] as const) {
    const ranked = await preload(caster, battleType);
    expect(ranked.userEffects.some((effect) => effect.type === "increasemastery")).toBe(
      false,
    );
    const battle = makeCompleteBattle({
      battleType,
      usersState: ranked.usersState,
      usersEffects: ranked.userEffects,
      extraState: ranked.extraState,
    });
    expect(
      applyEffects(battle, caster.userId).newBattle.usersState[0]?.ninjutsuMastery,
    ).toBe(RANKED_PVP_STATS.ninjutsuMastery);
  }
});

it("Clear preserves owned title mastery and its action gates while removing temporary mastery", async () => {
  const caster = titleUser();
  const loaded = await preload(caster);
  const temporary = makeEffect(
    "increasemastery",
    {
      masteryTypes: ["Ninjutsu"],
      power: 30,
      powerPerLevel: 0,
      calculation: "static",
      rounds: 5,
    },
    {
      creatorId: caster.userId,
      targetId: caster.userId,
      targetType: "user",
      fromType: "jutsu",
    },
  );
  let battle = makeCompleteBattle({
    usersState: loaded.usersState,
    usersEffects: [...loaded.userEffects, temporary],
    extraState: loaded.extraState,
  });
  expect(hasMasteryRequirements(caster, { requiredNinjutsuMastery: 110 })).toBe(false);
  battle = applyEffects(battle, caster.userId).newBattle;
  expect(battle.usersState[0]?.ninjutsuMastery).toBe(145);
  expect(
    hasMasteryRequirements(battle.usersState[0]!, { requiredNinjutsuMastery: 140 }),
  ).toBe(true);

  clear(
    makeEffect("clear", { power: 100 }, { targetId: caster.userId }),
    battle.usersEffects,
    battle.usersState[0]!,
  );

  expect(battle.usersEffects.find((effect) => effect.id === temporary.id)?.rounds).toBe(
    0,
  );
  const title = battle.usersEffects.find((effect) => effect.actionId === "hero")!;
  expect(isEffectActive(title)).toBe(true);
  expect(title.rounds).toBeUndefined();
  battle = applyEffects(battle, caster.userId).newBattle;
  expect(battle.usersState[0]?.ninjutsuMastery).toBe(115);
  expect(
    hasMasteryRequirements(battle.usersState[0]!, { requiredNinjutsuMastery: 110 }),
  ).toBe(true);
  expect(
    hasMasteryRequirements(battle.usersState[0]!, { requiredNinjutsuMastery: 140 }),
  ).toBe(false);
});
