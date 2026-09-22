import { describe, expect, it } from "vitest";
import { DIFFUSE_MAX_PERCENTAGE } from "@/drizzle/constants";
import { applyEffects } from "@/libs/combat/process";
import { cleanse, clear, copy, mirror } from "@/libs/combat/tags";
import type {
  BattleUserState,
  CombatAction,
  CompleteBattle,
  UserEffect,
} from "@/libs/combat/types";
import { DiffuseTag, getTagSchema, tagTypes } from "@/validators/combat";
import { makeBattleUser, makeDamageEffect, makeEffect } from "./helpers/battleScenario";

const ROUND = 3;
const runtime = (targetId = "defender") => ({
  creatorId: targetId,
  targetId,
  targetType: "user" as const,
  createdRound: 1,
  isNew: false,
  castThisRound: false,
  level: 0,
});
const diffuse = (fields = {}) =>
  makeEffect(
    "diffuse",
    { power: 50, ...fields },
    {
      ...runtime(),
      createdRound: ROUND,
      isNew: true,
      castThisRound: true,
    },
  );
const attack = (fields = {}) =>
  makeDamageEffect({
    ...runtime(),
    creatorId: "attacker",
    id: "hit",
    power: 100,
    calculation: "static",
    powerPerLevel: 0,
    rounds: 0,
    createdRound: ROUND,
    isNew: true,
    castThisRound: true,
    ...fields,
  });
const battle = (effects: UserEffect[], hp = 1000): CompleteBattle =>
  ({
    battleType: "COMBAT",
    round: ROUND,
    groundEffects: [],
    extraState: {},
    usersEffects: effects,
    usersState: [
      makeBattleUser("attacker", {
        direction: "left",
        curHealth: 1000,
        maxHealth: 1000,
      }),
      makeBattleUser("defender", {
        direction: "right",
        curHealth: hp,
        maxHealth: 1000,
      }),
    ],
  }) as unknown as CompleteBattle;
const defender = (b: CompleteBattle) =>
  b.usersState.find((u) => u.userId === "defender")!;
const debt = (user: BattleUserState) =>
  user.diffuseDamage?.reduce((sum, d) => sum + d.remainingDamage, 0) ?? 0;
const run = (effects: UserEffect[], hp = 1000, actorId = "attacker") =>
  applyEffects(battle(effects, hp), actorId);

describe("Diffuse content contract", () => {
  it("is discoverable in the shared tag registry", () => {
    expect(tagTypes).toContain("diffuse");
    expect(getTagSchema("diffuse").parse({}).type).toBe("diffuse");
  });
  it.each([
    { power: 0 },
    { power: 100 },
    { power: -1 },
    { calculation: "static" },
    { delayRounds: 0 },
    { delayRounds: 1.5 },
  ])("rejects invalid settings %j", (fields) => {
    expect(DiffuseTag.safeParse(fields).success).toBe(false);
  });
});

describe("Diffuse damage resolution", () => {
  it("splits static damage on the same turn it is cast", () => {
    const { newBattle, actionEffects } = run([attack(), diffuse()]);
    expect(defender(newBattle).curHealth).toBeCloseTo(960);
    expect(debt(defender(newBattle))).toBeCloseTo(40);
    expect(actionEffects.some((e) => e.txt.includes("diffuses 40.00"))).toBe(true);
  });
  it.each([80, 79])("does not defer a lethal hit at %i HP", (hp) => {
    const { newBattle } = run([attack(), diffuse()], hp);
    expect(defender(newBattle).curHealth).toBe(0);
    expect(debt(defender(newBattle))).toBe(0);
  });
  it("allows a hit strictly below current HP", () => {
    const { newBattle } = run([attack(), diffuse()], 81);
    expect(defender(newBattle).curHealth).toBeCloseTo(41);
    expect(debt(defender(newBattle))).toBeCloseTo(40);
  });
  it("checks all packets of a hit together before allowing deferral", () => {
    const { newBattle } = run([attack(), attack({ id: "second-hit" }), diffuse()], 150);
    expect(debt(defender(newBattle))).toBe(0);
    expect(defender(newBattle).curHealth).toBe(0);
  });
  it("checks lethality before shields and damage reduction", () => {
    const shield = makeEffect("shield", { power: 100, health: 100 }, runtime());
    const dr = makeEffect(
      "decreasedamagetaken",
      { power: 50, calculation: "percentage", rounds: 3 },
      runtime(),
    );
    const { newBattle } = run([attack(), diffuse(), dr, shield], 80);
    expect(debt(defender(newBattle))).toBe(0);
    expect(defender(newBattle).curHealth).toBe(80);
  });
  it("subtracts static reduction from the immediate portion, then consumes shields", () => {
    const dr = makeEffect(
      "decreasedamagetaken",
      {
        power: 20,
        calculation: "static",
        statTypes: ["Ninjutsu"],
        rounds: 3,
      },
      runtime(),
    );
    const shield = makeEffect("shield", { power: 10, health: 10 }, runtime());
    const { newBattle } = run([attack(), diffuse(), dr, shield]);
    expect(debt(defender(newBattle))).toBeCloseTo(40);
    expect(defender(newBattle).curHealth).toBeCloseTo(990);
  });
  it("calculates absorb from the immediate portion", () => {
    const absorb = makeEffect(
      "absorb",
      {
        power: 80,
        calculation: "percentage",
        statTypes: ["Ninjutsu"],
        rounds: 3,
      },
      runtime(),
    );
    const { newBattle } = run([attack(), diffuse(), absorb]);
    expect(debt(defender(newBattle))).toBeCloseTo(40);
    // 40 immediate damage, then the existing 60% absorb cap returns 24 HP.
    expect(defender(newBattle).curHealth).toBeCloseTo(984);
  });
  it("diffuses residual damage", () => {
    const { newBattle } = run(
      [attack({ isNew: false, createdRound: 1, rounds: 3 }), diffuse()],
      1000,
      "defender",
    );
    expect(defender(newBattle).curHealth).toBeCloseTo(960);
    expect(debt(defender(newBattle))).toBeCloseTo(40);
  });
  it("includes afterburn in the hit and lets a shield absorb its immediate portion", () => {
    const afterburn = makeEffect(
      "afterburn",
      {
        power: 30,
        calculation: "percentage",
        statTypes: ["Ninjutsu"],
        rounds: 3,
      },
      runtime(),
    );
    const shield = makeEffect("shield", { power: 100, health: 100 }, runtime());
    const { newBattle } = run([attack(), afterburn, diffuse(), shield]);
    expect(debt(defender(newBattle))).toBeCloseTo(52);
    expect(defender(newBattle).curHealth).toBe(1000);
    expect(newBattle.usersEffects.find((e) => e.type === "shield")?.power).toBeCloseTo(
      48,
    );
  });
  it("counts afterburn when checking whether a hit is lethal", () => {
    const afterburn = makeEffect(
      "afterburn",
      {
        power: 30,
        calculation: "percentage",
        statTypes: ["Ninjutsu"],
        rounds: 3,
      },
      runtime(),
    );
    expect(debt(defender(run([attack(), afterburn, diffuse()], 100).newBattle))).toBe(
      0,
    );
  });
  it("diffuses wound damage and applies damage reduction to the immediate portion", () => {
    const wound = makeEffect(
      "wound",
      {
        power: 20,
        rounds: 3,
        timeTracker: { originalDamage: 100 },
        statTypes: ["Ninjutsu"],
      },
      { ...runtime(), creatorId: "attacker" },
    );
    const dr = makeEffect(
      "decreasedamagetaken",
      {
        power: 50,
        rounds: 3,
        calculation: "percentage",
        statTypes: ["Ninjutsu"],
      },
      runtime(),
    );
    const { newBattle } = run([wound, diffuse(), dr], 1000, "defender");
    expect(debt(defender(newBattle))).toBeCloseTo(10);
    expect(defender(newBattle).curHealth).toBeCloseTo(995);
  });
  it("diffuses HP drain but does not defer chakra or stamina drain", () => {
    const drain = makeEffect(
      "drain",
      {
        power: 100,
        calculation: "static",
        rounds: 3,
        poolsAffected: ["Health", "Chakra", "Stamina"],
      },
      { ...runtime(), creatorId: "attacker" },
    );
    const { newBattle } = run([drain, diffuse()], 1000, "defender");
    expect(debt(defender(newBattle))).toBeCloseTo(50);
    expect(defender(newBattle).curHealth).toBeCloseTo(950);
    expect(defender(newBattle).curChakra).toBe(4900);
    expect(defender(newBattle).curStamina).toBe(4900);
  });
  it("does not stack into full deferral, including level scaling", () => {
    const first = diffuse({ power: 90, powerPerLevel: 1 });
    first.level = 100;
    const second = diffuse({ power: 80 });
    second.id = "diffuse-2";
    const { newBattle } = run([attack(), first, second]);
    expect(debt(defender(newBattle))).toBeCloseTo((80 * DIFFUSE_MAX_PERCENTAGE) / 100);
    expect(defender(newBattle).curHealth).toBeLessThan(1000);
  });
  it("preserves immediate afterburn across multiple damage packets", () => {
    const afterburn = makeEffect(
      "afterburn",
      {
        power: 30,
        calculation: "percentage",
        statTypes: ["Ninjutsu"],
        rounds: 3,
      },
      runtime(),
    );
    const { newBattle } = run([
      attack(),
      attack({ id: "second-hit" }),
      afterburn,
      diffuse(),
    ]);
    expect(debt(defender(newBattle))).toBeCloseTo(104);
    expect(defender(newBattle).curHealth).toBeCloseTo(896);
  });
  it("diffuses static damage increases with the hit", () => {
    const boost = makeEffect(
      "increasedamagegiven",
      {
        power: 20,
        calculation: "static",
        statTypes: ["Ninjutsu"],
        rounds: 3,
      },
      runtime("attacker"),
    );
    const { newBattle } = run([attack(), diffuse(), boost]);
    expect(debt(defender(newBattle))).toBeCloseTo(50);
    expect(defender(newBattle).curHealth).toBeCloseTo(950);
  });
  it("diffuses formula damage", () => {
    const damage = () => attack({ calculation: "formula", power: 1 });
    const baseline = run([damage()]).newBattle;
    const { newBattle } = run([damage(), diffuse()]);
    const incoming = 1000 - defender(baseline).curHealth;
    expect(incoming).toBeGreaterThan(0);
    expect(debt(defender(newBattle))).toBeCloseTo(incoming / 2);
    expect(defender(newBattle).curHealth).toBeCloseTo(1000 - incoming / 2);
  });
  it("diffuses poison caused by spending chakra and stamina", () => {
    const poison = makeEffect(
      "poison",
      { power: 50, rounds: 3 },
      {
        ...runtime(),
        creatorId: "attacker",
      },
    );
    const { newBattle } = applyEffects(battle([poison, diffuse()]), "defender", {
      chakraCost: 100,
      staminaCost: 100,
    } as CombatAction);
    expect(debt(defender(newBattle))).toBeCloseTo(50);
    expect(defender(newBattle).curHealth).toBeCloseTo(950);
  });
  it.each(["reflect", "recoil"] as const)(
    "diffuses %s on the actual recipient",
    (type) => {
      const returned = makeEffect(
        type,
        {
          power: 50,
          calculation: "percentage",
          statTypes: ["Ninjutsu"],
          rounds: 3,
        },
        runtime(type === "reflect" ? "defender" : "attacker"),
      );
      const d = diffuse();
      d.creatorId = "attacker";
      d.targetId = "attacker";
      const { newBattle } = run([attack(), d, returned]);
      const attacker = newBattle.usersState.find((u) => u.userId === "attacker")!;
      expect(debt(attacker)).toBeCloseTo(20);
      expect(attacker.curHealth).toBeCloseTo(980);
      expect(debt(defender(newBattle))).toBe(0);
    },
  );
  it("does not defer hits once Diffuse expires", () => {
    const d = diffuse();
    d.rounds = 0;
    const { newBattle } = run([attack(), d]);
    expect(debt(defender(newBattle))).toBe(0);
    expect(defender(newBattle).curHealth).toBeCloseTo(920);
  });
  it("allows a shield to absorb the immediate wound remainder", () => {
    const wound = makeEffect(
      "wound",
      {
        power: 20,
        rounds: 3,
        timeTracker: { originalDamage: 100 },
      },
      { ...runtime(), creatorId: "attacker" },
    );
    const shield = makeEffect("shield", { power: 100, health: 100 }, runtime());
    const { newBattle } = run([wound, diffuse(), shield], 1000, "defender");
    expect(debt(defender(newBattle))).toBeCloseTo(10);
    expect(defender(newBattle).curHealth).toBe(1000);
    expect(newBattle.usersEffects.find((e) => e.type === "shield")?.power).toBeCloseTo(
      90,
    );
  });
  it("applies defenses to a diffused pierce remainder", () => {
    const pierce = makeEffect(
      "pierce",
      {
        power: 100,
        rounds: 0,
        calculation: "static",
        statTypes: ["Ninjutsu"],
      },
      { ...runtime(), creatorId: "attacker", createdRound: ROUND, isNew: true },
    );
    const dr = makeEffect(
      "decreasedamagetaken",
      {
        power: 50,
        rounds: 3,
        calculation: "percentage",
        statTypes: ["Ninjutsu"],
      },
      runtime(),
    );
    const shield = makeEffect("shield", { power: 10, health: 10 }, runtime());
    const { newBattle } = run([pierce, diffuse(), dr, shield]);
    expect(debt(defender(newBattle))).toBeCloseTo(50);
    expect(defender(newBattle).curHealth).toBeCloseTo(985);
  });
  it.each(["reflect", "recoil"] as const)(
    "uses the %s recipient's absorb and shield",
    (type) => {
      const returned = makeEffect(
        type,
        {
          power: 50,
          calculation: "percentage",
          statTypes: ["Ninjutsu"],
          rounds: 3,
        },
        runtime(type === "reflect" ? "defender" : "attacker"),
      );
      const d = diffuse();
      d.creatorId = "attacker";
      d.targetId = "attacker";
      const absorb = makeEffect(
        "absorb",
        {
          power: 50,
          calculation: "percentage",
          statTypes: ["Ninjutsu"],
          rounds: 3,
        },
        runtime("attacker"),
      );
      const shield = makeEffect("shield", { power: 5, health: 5 }, runtime("attacker"));
      const { newBattle } = run([attack(), d, returned, absorb, shield]);
      const attacker = newBattle.usersState.find((u) => u.userId === "attacker")!;
      expect(debt(attacker)).toBeCloseTo(20);
      expect(attacker.curHealth).toBeCloseTo(995);
      expect(defender(newBattle).damageDealt ?? 0).toBe(0);
    },
  );
});

describe("Diffuse repayment and restrictions", () => {
  it("preserves summon damage attribution after the summon disappears", () => {
    const initial = battle([
      attack({ creatorId: "summon" }),
      diffuse({ delayRounds: 1 }),
    ]);
    initial.usersState.push(
      makeBattleUser("summon", {
        isSummon: true,
        controllerId: "attacker",
        direction: "left",
      }),
    );
    const hit = applyEffects(initial, "summon").newBattle;
    hit.usersState = hit.usersState.filter((u) => u.userId !== "summon");
    hit.usersEffects = [];
    hit.round += 1;
    const paid = applyEffects(hit, "defender").newBattle;
    expect(
      paid.usersState.find((u) => u.userId === "attacker")?.damageDealt,
    ).toBeCloseTo(80);
    expect(defender(paid).curHealth).toBeCloseTo(920);
  });
  it("repays exactly once per target round after serialization and tag expiry", () => {
    let current = run([attack(), diffuse()]).newBattle;
    current = JSON.parse(JSON.stringify(current)) as CompleteBattle;
    current.usersEffects = [];
    current.round += 1;
    const untouched = applyEffects(current, "attacker").newBattle;
    expect(debt(defender(untouched))).toBeCloseTo(40);
    for (let tick = 0; tick < 3; tick += 1) {
      current = applyEffects(current, "defender").newBattle;
      const repeated = applyEffects(current, "defender").newBattle;
      expect(defender(repeated).curHealth).toBe(defender(current).curHealth);
      current.round += 1;
    }
    expect(debt(defender(current))).toBe(0);
    expect(defender(current).curHealth).toBeCloseTo(920);
    expect(
      current.usersState.find((u) => u.userId === "attacker")?.damageDealt,
    ).toBeCloseTo(80);
  });
  it("does not mitigate, re-diffuse, or forgive a lethal repayment", () => {
    const current = run([attack(), diffuse({ delayRounds: 1 })]).newBattle;
    current.round += 1;
    defender(current).curHealth = 20;
    current.usersEffects = [
      diffuse(),
      makeEffect("shield", { power: 100, health: 100 }, runtime()),
    ];
    const result = applyEffects(current, "defender").newBattle;
    expect(defender(result).curHealth).toBe(0);
    expect(debt(defender(result))).toBe(0);
  });
  it("ignores buff and debuff prevention", () => {
    const prevents = (["buffprevent", "debuffprevent"] as const).map((type) =>
      makeEffect(type, { power: 100, rounds: 3 }, runtime()),
    );
    expect(
      debt(defender(run([attack(), diffuse(), ...prevents]).newBattle)),
    ).toBeCloseTo(40);
  });
  it("cannot be cleansed, cleared, copied, or mirrored", () => {
    const d = diffuse();
    const users = battle([]).usersState;
    const target = users[1]!;
    const caster = users[0]!;
    const effects = [d];
    cleanse(makeEffect("cleanse", { power: 100 }, runtime()), effects, target);
    clear(makeEffect("clear", { power: 100 }, runtime()), effects, target);
    copy(
      makeEffect(
        "copy",
        { power: 100 },
        { ...runtime(), creatorId: "attacker", isNew: true },
      ),
      effects,
      caster,
      target,
    );
    mirror(
      makeEffect(
        "mirror",
        { power: 100 },
        { ...runtime(), creatorId: "defender", targetId: "attacker", isNew: true },
      ),
      effects,
      target,
      caster,
    );
    expect(d.rounds).toBe(3);
    expect(effects).toHaveLength(1);
  });
});
