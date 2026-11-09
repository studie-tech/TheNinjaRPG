import { describe, expect, it } from "bun:test";
import { applyEffects } from "@/libs/combat/process";
import { parry } from "@/libs/combat/tags";
import type { Consequence } from "@/libs/combat/types";
import { makeBattleUser, makeCompleteBattle, makeEffect } from "../../setup/combat";

const defense = (power: number, targetId = "defender", id = `parry-${power}`) =>
  makeEffect(
    "parry",
    { power, rounds: 3 },
    {
      id,
      creatorId: targetId,
      targetId,
      targetType: "user",
      createdRound: 1,
      isNew: false,
      castThisRound: false,
    },
  );
const hit = () =>
  makeEffect(
    "damage",
    { power: 1000, calculation: "static", rounds: 0 },
    {
      id: "hit",
      creatorId: "attacker",
      targetId: "defender",
      targetType: "user",
      isNew: true,
      createdRound: 3,
      fromType: "jutsu",
    },
  );
const run = (effects: ReturnType<typeof makeEffect>[], actorId = "attacker") =>
  applyEffects(
    makeCompleteBattle({
      round: 3,
      usersState: [
        makeBattleUser("attacker", { curHealth: 10000, maxHealth: 10000 }),
        makeBattleUser("defender", { curHealth: 10000, maxHealth: 10000 }),
      ],
      usersEffects: effects,
    }),
    actorId,
  ).newBattle;
const hp = (battle: ReturnType<typeof run>, id: string) =>
  battle.usersState.find((u) => u.userId === id)!.curHealth;

describe("Parry", () => {
  it("collects the assigned percentage for a 1000 damage hit", () => {
    const consequences = new Map<string, Consequence>([
      ["hit", { userId: "attacker", targetId: "defender", damage: 1000 }],
    ]);
    parry(defense(30), [hit()], consequences, makeBattleUser("defender"));
    expect(consequences.get("hit")!.parryPercentage).toBe(30);
  });
  it("redirects 30% of the mitigated hit and conserves total damage", () => {
    const baseline = run([hit()]);
    const incoming = 10000 - hp(baseline, "defender");
    const result = run([hit(), defense(30)]);
    expect(10000 - hp(result, "defender")).toBeCloseTo(incoming * 0.7);
    expect(10000 - hp(result, "attacker")).toBeCloseTo(incoming * 0.3);
    expect(result.usersState.find((u) => u.userId === "defender")!.damageDealt).toBe(0);
  });
  it("stacks additively and caps at 100% without return loops", () => {
    const incoming = 10000 - hp(run([hit()]), "defender");
    const result = run([hit(), defense(60), defense(70), defense(100, "attacker")]);
    expect(hp(result, "defender")).toBe(10000);
    expect(10000 - hp(result, "attacker")).toBeCloseTo(incoming);
  });
  it("does not activate on its casting action", () => {
    const effect = defense(30);
    effect.isNew = true;
    effect.castThisRound = true;
    expect(hp(run([hit(), effect]), "attacker")).toBe(10000);
  });
});

it("applies shields to the remaining hit and to the returned packet", () => {
  const incoming = 10000 - hp(run([hit()]), "defender");
  const shield = (targetId: string) =>
    makeEffect(
      "shield",
      { power: 100, rounds: 3 },
      {
        id: `shield-${targetId}`,
        creatorId: targetId,
        targetId,
        targetType: "user",
        createdRound: 1,
      },
    );
  const result = run([hit(), defense(30), shield("defender"), shield("attacker")]);
  expect(10000 - hp(result, "defender")).toBeCloseTo(incoming * 0.7 - 100);
  expect(10000 - hp(result, "attacker")).toBeCloseTo(incoming * 0.3 - 100);
});

it("lets the attacker absorb returned damage", () => {
  const incoming = 10000 - hp(run([hit()]), "defender");
  const effect = makeEffect(
    "absorb",
    { power: 50, calculation: "percentage", rounds: 3 },
    {
      creatorId: "attacker",
      targetId: "attacker",
      targetType: "user",
      createdRound: 1,
    },
  );
  const result = run([hit(), defense(30), effect]);
  expect(10000 - hp(result, "attacker")).toBeCloseTo(incoming * 0.3 * 0.5);
});

it("splits Diffuse debt after Parry for both participants", () => {
  const incoming = 10000 - hp(run([hit()]), "defender");
  const diffuse = (targetId: string) =>
    makeEffect(
      "diffuse",
      { power: 50, rounds: 3, delayRounds: 1 },
      {
        id: `diffuse-${targetId}`,
        creatorId: targetId,
        targetId,
        targetType: "user",
        createdRound: 1,
      },
    );
  const result = run([hit(), defense(30), diffuse("attacker"), diffuse("defender")]);
  expect(10000 - hp(result, "attacker")).toBeCloseTo(incoming * 0.15);
  expect(10000 - hp(result, "defender")).toBeCloseTo(incoming * 0.35);
  expect(
    result.usersState.find((u) => u.userId === "attacker")!.diffuseDamage![0]!
      .creditDamage,
  ).toBe(false);
});

it.each([
  ["increasedamagegiven", 0],
  ["increasedamagetaken", 0],
  ["increasedamagegiven", 50],
  ["increasedamagetaken", 50],
] as const)(
  "checks Diffuse lethality after Parry and static %s with %i percent player DR",
  (type, damageReduction) => {
    const hasDamageReduction = damageReduction > 0;
    const expectedDamage = hasDamageReduction ? 420 : 770;
    for (const health of [770, 775]) {
      const source = hit();
      source.power = 1250;
      const targetId = type === "increasedamagegiven" ? "attacker" : "defender";
      const modifier = makeEffect(
        type,
        { power: 100, calculation: "static", rounds: 3 },
        { creatorId: targetId, targetId, targetType: "user", createdRound: 1 },
      );
      const diffuse = makeEffect(
        "diffuse",
        { power: 50, rounds: 3, delayRounds: 1 },
        {
          creatorId: "defender",
          targetId: "defender",
          targetType: "user",
          createdRound: 1,
        },
      );
      const reduction = makeEffect(
        "decreasedamagetaken",
        { power: damageReduction, calculation: "percentage", rounds: 3 },
        {
          creatorId: "defender",
          targetId: "defender",
          targetType: "user",
          createdRound: 1,
        },
      );
      const result = applyEffects(
        makeCompleteBattle({
          round: 3,
          usersState: [
            makeBattleUser("attacker", { curHealth: 10000, maxHealth: 10000 }),
            makeBattleUser("defender", { curHealth: health, maxHealth: 10000 }),
          ],
          usersEffects: [
            source,
            modifier,
            defense(30),
            diffuse,
            ...(hasDamageReduction ? [reduction] : []),
          ],
        }),
        "attacker",
      ).newBattle;
      const defender = result.usersState.find((u) => u.userId === "defender")!;
      const deferred =
        defender.diffuseDamage?.reduce((sum, d) => sum + d.remainingDamage, 0) ?? 0;
      const expectedDeferred = health > 770 ? expectedDamage / 2 : 0;
      expect(deferred).toBeCloseTo(expectedDeferred);
      expect(defender.curHealth).toBeCloseTo(
        Math.max(0, health - expectedDamage + expectedDeferred),
      );
      expect(hp(result, "attacker")).toBeCloseTo(10000 - (expectedDamage * 3) / 7);
    }
  },
);

it("excludes residual damage", () => {
  const damage = hit();
  damage.isNew = false;
  damage.createdRound = 1;
  damage.rounds = 3;
  const result = run([damage, defense(100)], "defender");
  expect(hp(result, "attacker")).toBe(10000);
  expect(hp(result, "defender")).toBeLessThan(10000);
});

it("supports percentage scaling and ignores nonmatching generals", () => {
  const source = hit();
  const effect = defense(30);
  effect.level = 10;
  effect.powerPerLevel = 1;
  const consequences = new Map<string, Consequence>([
    ["hit", { userId: "attacker", targetId: "defender", damage: 1000 }],
  ]);
  parry(effect, [source], consequences, makeBattleUser("defender"));
  expect(consequences.get("hit")!.parryPercentage).toBe(40);
  const restricted = makeEffect(
    "parry",
    { power: 30, generalTypes: ["Strength"] },
    { targetId: "defender" },
  );
  const typedHit = makeEffect(
    "damage",
    { generalTypes: ["Intelligence"] },
    { id: "hit" },
  );
  consequences.get("hit")!.parryPercentage = 0;
  parry(restricted, [typedHit], consequences, makeBattleUser("defender"));
  expect(consequences.get("hit")!.parryPercentage).toBe(0);
});

it("does not change damage with zero power", () => {
  expect(hp(run([hit(), defense(0)]), "defender")).toBe(hp(run([hit()]), "defender"));
});

it.each([30, 100])("does not parry piercing hits at %i percent power", (power) => {
  const pierce = makeEffect(
    "pierce",
    { power: 1000, calculation: "static", rounds: 0 },
    {
      id: "pierce-hit",
      creatorId: "attacker",
      targetId: "defender",
      targetType: "user",
      isNew: true,
      createdRound: 3,
    },
  );
  const incoming = 10000 - hp(run([pierce]), "defender");
  const result = run([pierce, defense(power)]);
  expect(incoming).toBeGreaterThan(0);
  expect(10000 - hp(result, "defender")).toBeCloseTo(incoming);
  expect(hp(result, "attacker")).toBe(10000);
  const mixed = run([hit(), pierce, defense(power)]);
  const direct = 10000 - hp(run([hit()]), "defender");
  expect(10000 - hp(mixed, "defender")).toBeCloseTo(
    incoming + direct * (1 - power / 100),
  );
  expect(10000 - hp(mixed, "attacker")).toBeCloseTo((direct * power) / 100);
});

it("parries damage despite an earlier Buff Prevent", () => {
  const effect = defense(30);
  effect.createdRound = 2;
  const prevent = makeEffect(
    "buffprevent",
    { power: 100, rounds: 5 },
    {
      creatorId: "attacker",
      targetId: "defender",
      targetType: "user",
      createdRound: 1,
      isNew: false,
    },
  );
  const incoming = 10000 - hp(run([hit()]), "defender");
  const result = run([hit(), effect, prevent]);

  expect(10000 - hp(result, "defender")).toBeCloseTo(incoming * 0.7);
  expect(10000 - hp(result, "attacker")).toBeCloseTo(incoming * 0.3);
  expect(result.usersEffects.some((e) => e.id === effect.id && e.rounds! > 0)).toBe(
    true,
  );
});

it("can still be cleared before damage is parried", () => {
  const effect = defense(100);
  effect.fromType = "jutsu";
  const clear = makeEffect(
    "clear",
    { power: 100, rounds: 0 },
    {
      creatorId: "attacker",
      targetId: "defender",
      targetType: "user",
      createdRound: 3,
      isNew: true,
    },
  );
  const incoming = 10000 - hp(run([hit()]), "defender");
  const result = run([hit(), effect, clear]);

  expect(10000 - hp(result, "defender")).toBeCloseTo(incoming);
  expect(hp(result, "attacker")).toBe(10000);
  expect(result.usersEffects.some((e) => e.id === effect.id && e.rounds! > 0)).toBe(
    false,
  );
});

it("splits a 1000 incoming hit into 700 received and 300 returned", () => {
  const source = hit();
  source.power = 1250;
  expect(10000 - hp(run([source]), "defender")).toBe(1000);
  const result = run([source, defense(30)]);
  expect(hp(result, "defender")).toBe(9300);
  expect(hp(result, "attacker")).toBe(9700);
});

it.each([
  ["increaseheal", 90],
  ["decreaseheal", 30],
] as const)("applies %s to Absorb healing from returned damage", (type, healing) => {
  const source = hit();
  source.power = 1250;
  const absorb = makeEffect(
    "absorb",
    { power: 20, calculation: "percentage", rounds: 3 },
    {
      creatorId: "attacker",
      targetId: "attacker",
      targetType: "user",
      createdRound: 1,
    },
  );
  const modifier = makeEffect(
    type,
    { power: 50, calculation: "percentage", rounds: 3 },
    {
      creatorId: "attacker",
      targetId: "attacker",
      targetType: "user",
      createdRound: 1,
    },
  );
  const result = run([source, defense(30), absorb, modifier]);
  expect(hp(result, "attacker")).toBe(9700 + healing);
  expect(hp(result, "defender")).toBe(9300);
});
