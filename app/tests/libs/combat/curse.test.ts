import { describe, expect, it } from "bun:test";
import { accumulateCurseConsequence, accumulateCurseDamage } from "@/libs/combat/curse";
import { advanceEncounterWave } from "@/libs/combat/encounters";
import { applyEffects } from "@/libs/combat/process";
import { curse, settleCurse } from "@/libs/combat/tags";
import { alignBattle } from "@/libs/combat/turn";
import type { CompleteBattle, UserEffect } from "@/libs/combat/types";
import { applyPoolAdjustmentsToBase } from "@/libs/combat/util";
import { CurseTag } from "@/validators/combat";
import { makeBattleUser, makeCompleteBattle, makeEffect } from "../../setup/combat";

const mark = (
  power = 50,
  targetId = "attacker",
  id = `curse-${targetId}`,
  damageBonusPercent = 0,
) =>
  makeEffect(
    "curse",
    { power, rounds: 3, damageBonusPercent },
    {
      id,
      creatorId: targetId,
      targetId,
      targetType: "user",
      createdRound: 1,
      isNew: false,
    },
  );
const hit = (creatorId = "attacker", targetId = "defender", power = 1250) =>
  makeEffect(
    "damage",
    { power, calculation: "static", rounds: 0 },
    {
      id: `hit-${creatorId}`,
      creatorId,
      targetId,
      targetType: "user",
      isNew: true,
      createdRound: 3,
    },
  );
const instantKill = (creatorId = "attacker", targetId = "defender", power = 100) =>
  makeEffect(
    "onehitkill",
    { power, rounds: 0 },
    {
      id: `kill-${creatorId}-${targetId}`,
      creatorId,
      targetId,
      targetType: "user",
      isNew: true,
      createdRound: 3,
    },
  );
const scenario = (effects: UserEffect[]) =>
  makeCompleteBattle({
    round: 3,
    activeUserId: "attacker",
    usersState: [
      makeBattleUser("attacker", { curHealth: 5000, maxHealth: 10000 }),
      makeBattleUser("defender", { curHealth: 5000, maxHealth: 10000 }),
    ],
    usersEffects: effects,
  });
const user = (battle: CompleteBattle, id = "attacker") =>
  battle.usersState.find((u) => u.userId === id)!;
const stored = (battle: CompleteBattle, id = "attacker") =>
  battle.usersEffects.find((e) => e.type === "curse" && e.targetId === id)!.curseState!
    .storedHealing;
const expire = (battle: CompleteBattle) => {
  battle.usersEffects
    .filter((e) => e.type === "curse")
    .forEach((e) => {
      e.rounds = 1;
      e.castThisRound = false;
    });
  battle.usersState.forEach((u) => {
    u.round = battle.round;
    u.actionPoints = 0;
  });
  battle.roundStartAt = new Date(Date.now() - 600000);
  return alignBattle(battle, [], "attacker");
};

describe("Curse", () => {
  it("boosts only the active holder's damage and defaults to no bonus", () => {
    expect(CurseTag.parse({}).damageBonusPercent).toBe(0);
    expect(CurseTag.safeParse({ damageBonusPercent: -1 }).success).toBe(false);
    const boosted = mark(50, "attacker", "curse-attacker", 50);
    const battle = applyEffects(
      scenario([boosted, hit(), hit("defender", "attacker")]),
      "attacker",
    ).newBattle;
    expect(user(battle, "defender").curHealth).toBe(3500);
    expect(user(battle).curHealth).toBe(4000);
    expect(stored(battle)).toBe(625);
  });

  it("does not boost damage after Curse is removed", () => {
    const clear = makeEffect(
      "clear",
      { power: 100, rounds: 0 },
      {
        creatorId: "defender",
        targetId: "attacker",
        targetType: "user",
        createdRound: 3,
        isNew: true,
      },
    );
    const battle = applyEffects(
      scenario([mark(50, "attacker", "boosted", 50), clear, hit()]),
      "attacker",
    ).newBattle;
    expect(user(battle, "defender").curHealth).toBe(4000);
    expect(battle.usersEffects.some((effect) => effect.type === "curse")).toBe(false);
  });

  it.each([0, 50])(
    "excludes Pierce from a %i percent Curse bonus while preserving its damage-reduction bypass",
    (bonus) => {
      const pierce = makeEffect(
        "pierce",
        { power: 1250, calculation: "static", rounds: 0 },
        {
          creatorId: "attacker",
          targetId: "defender",
          targetType: "user",
          createdRound: 3,
          isNew: true,
        },
      );
      const reduction = makeEffect(
        "decreasedamagetaken",
        { power: 50, calculation: "percentage", rounds: 3 },
        {
          creatorId: "defender",
          targetId: "defender",
          targetType: "user",
          createdRound: 1,
        },
      );
      const battle = applyEffects(
        scenario([mark(50, "attacker", "boosted", bonus), pierce, reduction]),
        "attacker",
      ).newBattle;
      expect(user(battle, "defender").curHealth).toBe(3750);
    },
  );

  it.each([1200, 1600])(
    "uses Curse-boosted damage for Diffuse lethality at %i HP",
    (health) => {
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
      const initial = scenario([mark(50, "attacker", "boosted", 50), hit(), diffuse]);
      user(initial, "defender").curHealth = health;
      const battle = applyEffects(initial, "attacker").newBattle;
      const defender = user(battle, "defender");
      expect(defender.curHealth).toBe(health === 1200 ? 0 : 850);
      expect(
        defender.diffuseDamage?.reduce(
          (total, debt) => total + debt.remainingDamage,
          0,
        ) ?? 0,
      ).toBe(health === 1200 ? 0 : 750);
    },
  );

  it.each(["damage", "pierce"] as const)(
    "suppresses a bloodline Curse's %s bonus under a ground Seal",
    (type) => {
      const effect = mark(50, "attacker", "boosted", 50);
      effect.fromType = "bloodline";
      effect.curseState = { storedHealing: 0, activatedRound: 1 };
      const attack =
        type === "damage"
          ? hit()
          : makeEffect(
              "pierce",
              { power: 1250, calculation: "static", rounds: 0 },
              {
                creatorId: "attacker",
                targetId: "defender",
                targetType: "user",
                createdRound: 3,
                isNew: true,
              },
            );
      const initial = scenario([effect, attack]);
      initial.groundEffects = [
        {
          ...makeEffect(
            "seal",
            { power: 100, rounds: 3 },
            {
              creatorId: "defender",
              targetType: "user",
              createdRound: 1,
            },
          ),
          longitude: user(initial).longitude,
          latitude: user(initial).latitude,
        },
      ];
      const battle = applyEffects(initial, "attacker").newBattle;
      expect(user(battle, "defender").curHealth).toBe(type === "damage" ? 4000 : 3750);
    },
  );

  it.each(["expired", "settled", "prevented"] as const)(
    "does not boost damage with a %s Curse",
    (state) => {
      const effect = mark(50, "attacker", "boosted", 50);
      if (state === "expired") effect.rounds = 0;
      if (state === "settled")
        effect.curseState = { storedHealing: 0, activatedRound: 1, settled: true };
      const prevent = makeEffect(
        "buffprevent",
        { power: 100, rounds: 3 },
        {
          creatorId: "defender",
          targetId: "attacker",
          targetType: "user",
          createdRound: 0,
        },
      );
      const battle = applyEffects(
        scenario([effect, hit(), ...(state === "prevented" ? [prevent] : [])]),
        "attacker",
      ).newBattle;
      expect(user(battle, "defender").curHealth).toBe(4000);
    },
  );

  it("stores 250 from each 1000 damage direction and heals 500 only on expiry", () => {
    let battle = applyEffects(
      scenario([mark(), hit(), hit("defender", "attacker")]),
      "attacker",
    ).newBattle;
    expect(user(battle).curHealth).toBe(4000);
    expect(stored(battle)).toBe(500);
    battle = JSON.parse(JSON.stringify(battle)) as CompleteBattle;
    const transition = expire(battle);
    expect(transition.progressRound).toBe(true);
    expect(user(battle).curHealth).toBe(4500);
    expect(transition.expiredEffects.some((e) => e.txt.includes("500.00"))).toBe(true);
    expire(battle);
    expect(user(battle).curHealth).toBe(4500);
  });
  it.each(["attacker", "defender"])(
    "keeps one side at half power when only %s deals damage",
    (attackerId) => {
      const targetId = attackerId === "attacker" ? "defender" : "attacker";
      const battle = applyEffects(
        scenario([mark(), hit(attackerId, targetId)]),
        "attacker",
      ).newBattle;
      expect(stored(battle)).toBe(250);
    },
  );
  it("counts post-shield HP loss and caps overkill", () => {
    const shield = makeEffect(
      "shield",
      { power: 400, rounds: 3 },
      {
        targetId: "defender",
        creatorId: "defender",
        targetType: "user",
        createdRound: 1,
      },
    );
    expect(
      stored(applyEffects(scenario([mark(), hit(), shield]), "attacker").newBattle),
    ).toBe(150);
    const battle = scenario([mark(), hit()]);
    user(battle, "defender").curHealth = 100;
    expect(stored(applyEffects(battle, "attacker").newBattle)).toBe(25);
  });
  it.each(["damage", "onehitkill"] as const)(
    "stores first-action %s HP loss for an innate Curse and pays it on expiry",
    (type) => {
      const effect = mark();
      effect.createdRound = 0;
      effect.fromType = "bloodline";
      const damage =
        type === "damage" ? hit("attacker", "defender", 6250) : instantKill();
      damage.createdRound = 1;
      const initial = scenario([effect, damage]);
      initial.round = 1;
      user(initial).curHealth = 3000;
      user(initial).maxHealth = 5000;
      initial.usersState.push(makeBattleUser("another-enemy"));
      const battle = applyEffects(initial, "attacker").newBattle;
      expect(user(battle, "defender").curHealth).toBe(0);
      expect(stored(battle)).toBe(1250);
      expect(user(battle).damageDealt).toBe(5000);
      expect(expire(battle).progressRound).toBe(true);
      expect(user(battle).curHealth).toBe(4250);
    },
  );
  it.each(["clear", "seal", "buffprevent"] as const)(
    "resolves %s before storing instant-kill damage",
    (type) => {
      const effect = mark();
      if (type === "seal") effect.fromType = "bloodline";
      if (type === "buffprevent") effect.createdRound = 2;
      else effect.curseState = { storedHealing: 0, activatedRound: 1 };
      const blocker = makeEffect(
        type,
        { power: 100, rounds: type === "clear" ? 0 : 3 },
        {
          creatorId: "defender",
          targetId: "attacker",
          targetType: "user",
          createdRound: type === "buffprevent" ? 1 : 3,
          isNew: type !== "buffprevent",
        },
      );
      const battle = applyEffects(
        scenario([effect, blocker, instantKill()]),
        "attacker",
      ).newBattle;
      expect(user(battle, "defender").curHealth).toBe(0);
      expect(effect.curseState?.storedHealing ?? 0).toBe(0);
    },
  );
  it("stores an instant kill after Cleanse restores an uninitialized innate Curse", () => {
    const effect = mark();
    effect.fromType = "bloodline";
    const seal = makeEffect(
      "seal",
      { power: 100, rounds: 3 },
      {
        creatorId: "defender",
        targetId: "attacker",
        targetType: "user",
        createdRound: 1,
      },
    );
    const cleanse = makeEffect(
      "cleanse",
      { power: 100, rounds: 0 },
      { targetId: "attacker", targetType: "user", createdRound: 3, isNew: true },
    );
    const battle = applyEffects(
      scenario([effect, seal, cleanse, instantKill()]),
      "attacker",
    ).newBattle;
    expect(seal.rounds).toBe(0);
    expect(stored(battle)).toBe(1250);
  });
  it("excludes instant kills on the casting action and collects on the next action", () => {
    const effect = mark();
    effect.isNew = true;
    effect.createdRound = 3;
    const initial = scenario([effect, instantKill()]);
    initial.usersState.push(makeBattleUser("another-enemy", { curHealth: 700 }));
    let battle = applyEffects(initial, "attacker").newBattle;
    expect(stored(battle)).toBe(0);
    battle.usersEffects.push(instantKill("attacker", "another-enemy"));
    battle = applyEffects(battle, "attacker").newBattle;
    expect(stored(battle)).toBe(175);
  });
  it.each(["missed", "prevented", "dead target"] as const)(
    "stores no instant-kill damage for outcome: %s",
    (outcome) => {
      const effects = [
        mark(),
        instantKill("attacker", "defender", outcome === "missed" ? 0 : 100),
      ];
      if (outcome === "prevented") {
        effects.push(
          makeEffect(
            "onehitkillprevent",
            { power: 100, rounds: 3 },
            {
              creatorId: "defender",
              targetId: "defender",
              targetType: "user",
              createdRound: 1,
            },
          ),
        );
      }
      const initial = scenario(effects);
      user(initial, "defender").curHealth = outcome === "dead target" ? 0 : 700;
      const battle = applyEffects(initial, "attacker").newBattle;
      expect(stored(battle)).toBe(0);
      expect(user(battle).damageDealt).toBe(0);
    },
  );
  it("attributes actual instant-kill HP loss to its source without counting a second kill", () => {
    const initial = scenario([
      mark(),
      mark(50, "teammate"),
      mark(50, "defender"),
      instantKill(),
      instantKill("teammate"),
    ]);
    initial.usersState.push(makeBattleUser("teammate", { direction: "left" }));
    user(initial, "defender").curHealth = 700;
    const battle = applyEffects(initial, "attacker").newBattle;
    expect(stored(battle)).toBe(175);
    expect(stored(battle, "defender")).toBe(175);
    expect(stored(battle, "teammate")).toBe(0);
    expect(user(battle).damageDealt).toBe(700);
    expect(user(battle, "teammate").damageDealt).toBe(0);
  });
  it("discards healing when cleared", () => {
    const effect = mark();
    effect.curseState = { storedHealing: 500, activatedRound: 1 };
    const clear = makeEffect(
      "clear",
      { power: 100 },
      {
        creatorId: "defender",
        targetId: "attacker",
        targetType: "user",
        isNew: true,
        createdRound: 3,
      },
    );
    const battle = applyEffects(scenario([effect, clear]), "attacker").newBattle;
    const health = user(battle).curHealth;
    expire(battle);
    expect(user(battle).curHealth).toBe(health);
  });
  it("does not revive and caps payout at effective maximum HP", () => {
    const effect = mark();
    effect.curseState = { storedHealing: 500, activatedRound: 1 };
    const battle = scenario([effect]);
    user(battle).curHealth = 9900;
    settleCurse(effect, user(battle), [effect]);
    expect(user(battle).curHealth).toBe(10000);
    effect.curseState = { storedHealing: 500, activatedRound: 1 };
    user(battle).curHealth = 0;
    settleCurse(effect, user(battle), [effect]);
    expect(user(battle).curHealth).toBe(0);
  });
  it("reconciles expiring maximum HP before capping payout", () => {
    const effect = mark();
    effect.curseState = { storedHealing: 500, activatedRound: 1 };
    const bonus = makeEffect(
      "increasemaxpools",
      { power: 1000, calculation: "static", poolsAffected: ["Health"], rounds: 1 },
      {
        creatorId: "attacker",
        targetId: "attacker",
        targetType: "user",
        createdRound: 1,
      },
    );
    const battle = scenario([effect, bonus]);
    const holder = user(battle);
    holder.maxHealth = 5000;
    holder.curHealth = 4500;
    applyPoolAdjustmentsToBase(holder, battle.usersEffects);
    expect(holder.curHealth).toBe(5500);
    const transition = expire(battle);
    expect(transition.progressRound).toBe(true);
    expect(holder.curHealth).toBe(5000);
    expect(
      transition.expiredEffects.some((e) => e.txt.includes("restores 500.00 HP")),
    ).toBe(true);
    const result = applyEffects(battle, "attacker").newBattle;
    expect(user(result).curHealth).toBe(5000);
  });
  it("blocks payout under heal prevention and consumes it once", () => {
    const effect = mark();
    effect.curseState = { storedHealing: 500, activatedRound: 1 };
    const block = makeEffect(
      "healprevent",
      { power: 100, rounds: 3 },
      { targetId: "attacker", createdRound: 2 },
    );
    const battle = scenario([effect, block]);
    settleCurse(effect, user(battle), battle.usersEffects);
    settleCurse(effect, user(battle), [effect]);
    expect(user(battle).curHealth).toBe(5000);
    expect(effect.curseState.storedHealing).toBe(0);
  });
  it("applies healing increases at payout", () => {
    const effect = mark();
    effect.curseState = { storedHealing: 500, activatedRound: 1 };
    const boost = makeEffect(
      "increaseheal",
      { power: 50, calculation: "percentage", rounds: 3 },
      { targetId: "attacker", creatorId: "attacker", createdRound: 1 },
    );
    const battle = scenario([effect, boost]);
    settleCurse(effect, user(battle), battle.usersEffects);
    expect(user(battle).curHealth).toBe(5750);
  });
  it("does not accumulate on its casting action", () => {
    const effect = mark();
    effect.isNew = true;
    effect.createdRound = 3;
    const battle = applyEffects(scenario([effect, hit()]), "attacker").newBattle;
    expect(stored(battle)).toBe(0);
  });
  it("requires a positive finite duration", () => {
    expect(CurseTag.safeParse({ rounds: 0 }).success).toBe(false);
    expect(CurseTag.parse({}).rounds).toBe(3);
  });
  it("preserves fractions and independent instances", () => {
    const effects = [mark(50), mark(20, "defender")];
    const battle = scenario(effects);
    effects.forEach((e) => curse(e, effects, user(battle, e.targetId), 3));
    accumulateCurseDamage(effects, battle.usersState, "attacker", "defender", 1, 3);
    expect(effects[0]!.curseState!.storedHealing).toBe(0.25);
    expect(effects[1]!.curseState!.storedHealing).toBe(0.1);
  });
  it("attributes merged damage to individual attackers and excludes recoil", () => {
    const effect = mark();
    effect.curseState = { storedHealing: 0, activatedRound: 1 };
    const battle = scenario([effect]);
    accumulateCurseConsequence(
      {
        userId: "attacker",
        targetId: "defender",
        damage: 100,
        enmitySources: [
          { userId: "attacker", damage: 40 },
          { userId: "other", damage: 60 },
        ],
      },
      "damage",
      [effect],
      battle.usersState,
      3,
    );
    expect(effect.curseState.storedHealing).toBe(10);
    accumulateCurseConsequence(
      { userId: "attacker", targetId: "defender", damage: 100, damageSource: "recoil" },
      "damage",
      [effect],
      battle.usersState,
      3,
    );
    expect(effect.curseState.storedHealing).toBe(10);
  });
});

it("counts Diffuse damage only as it is repaid while Curse is active", () => {
  const diffuse = makeEffect(
    "diffuse",
    { power: 50, rounds: 3, delayRounds: 1 },
    {
      targetId: "defender",
      creatorId: "defender",
      targetType: "user",
      createdRound: 1,
    },
  );
  let battle = applyEffects(scenario([mark(), hit(), diffuse]), "attacker").newBattle;
  expect(stored(battle)).toBe(125);
  battle.usersEffects = battle.usersEffects.filter((e) => e.type === "curse");
  battle.round += 1;
  battle = applyEffects(battle, "defender").newBattle;
  expect(stored(battle)).toBe(250);
});

it.each([
  { expires: false, allied: false },
  { expires: true, allied: false },
  { expires: false, allied: true },
  { expires: true, allied: true },
])("keeps clone debt Curse attribution: %j", ({ expires, allied }) => {
  const direction = allied ? "right" : "left";
  const duration = makeEffect(
    "clone",
    { power: 100, rounds: 2 },
    { creatorId: "clone", createdRound: 1, isNew: false },
  );
  duration.rounds = expires ? 1 : 2;
  const initial = makeCompleteBattle({
    round: 3,
    activeUserId: "clone",
    usersState: [
      makeBattleUser("defender", { curHealth: 5000, maxHealth: 10000 }),
      makeBattleUser("attacker", { direction }),
      ...(allied ? [makeBattleUser("opponent", { direction: "left" })] : []),
      makeBattleUser("clone", {
        direction,
        isSummon: true,
        isOriginal: false,
        isAi: true,
        controllerId: "attacker",
      }),
    ],
    groundEffects: [duration],
    usersEffects: [
      mark(),
      mark(50, "defender"),
      makeEffect(
        "diffuse",
        { power: 50, rounds: 3, delayRounds: 1 },
        {
          creatorId: "defender",
          targetId: "defender",
          targetType: "user",
          createdRound: 1,
        },
      ),
      hit("clone"),
    ],
  });
  let battle = applyEffects(initial, "clone").newBattle;
  expect(user(battle, "defender").curHealth).toBe(4500);
  expect(stored(battle, "defender")).toBe(allied ? 0 : 125);
  expect(stored(battle)).toBe(0);
  expect(user(battle, "defender").diffuseDamage).toMatchObject([
    { attackerId: "attacker", sourceUserId: "clone", remainingDamage: 500 },
  ]);

  battle.usersState.forEach((u) => {
    u.round = battle.round;
    u.actionPoints = 0;
  });
  battle.roundStartAt = new Date(Date.now() - 600000);
  const transition = alignBattle(battle, []);
  expect(transition.progressRound).toBe(true);
  expect(transition.actor.userId).toBe("defender");
  expect(battle.usersState.some((u) => u.userId === "clone")).toBe(!expires);

  battle = applyEffects(battle, "defender").newBattle;
  expect(user(battle, "defender").curHealth).toBe(4000);
  expect(user(battle, "defender").diffuseDamage).toEqual([]);
  expect(stored(battle, "defender")).toBe(allied ? 0 : 250);
  expect(stored(battle)).toBe(0);
});

it("includes residual damage and returned Parry damage", () => {
  const residual = hit();
  residual.rounds = 3;
  residual.isNew = false;
  residual.createdRound = 1;
  expect(
    stored(applyEffects(scenario([mark(), residual]), "defender").newBattle),
  ).toBeGreaterThan(0);
  const parry = makeEffect(
    "parry",
    { power: 30, rounds: 3 },
    {
      creatorId: "defender",
      targetId: "defender",
      targetType: "user",
      createdRound: 1,
    },
  );
  const battle = applyEffects(scenario([mark(), hit(), parry]), "attacker").newBattle;
  expect(stored(battle)).toBe(250);
});

it("pays expiry healing before the next encounter wave spawns", () => {
  const effect = mark();
  effect.curseState = { storedHealing: 500, activatedRound: 1 };
  const battle = scenario([effect]);
  battle.width = 8;
  battle.height = 8;
  user(battle).curHealth = 3000;
  user(battle, "defender").curHealth = 0;
  battle.extraState.encounter = {
    wave: 1,
    waveStartedRound: 1,
    pendingWaves: [
      {
        users: [makeBattleUser("next-enemy")],
        effects: [],
        delayRounds: 0,
      },
    ],
  };

  const transition = expire(battle);
  expect(transition.progressRound).toBe(true);
  expect(advanceEncounterWave(battle)).toBe(true);
  expect(user(battle, "next-enemy").curHealth).toBeGreaterThan(0);
  expect(user(battle).curHealth).toBe(3500);
  expect(effect.curseState).toMatchObject({ storedHealing: 0, settled: true });
  expect(
    transition.expiredEffects.some((e) => e.txt.includes("restores 500.00 HP")),
  ).toBe(true);
});

it("does not pay at battle end", () => {
  const effect = mark();
  effect.curseState = { storedHealing: 500, activatedRound: 1 };
  const battle = scenario([effect]);
  user(battle, "defender").curHealth = 0;
  expire(battle);
  expect(user(battle).curHealth).toBe(5000);
});

it("applies per-level scaling to both halves", () => {
  const effect = mark(40);
  effect.level = 10;
  effect.powerPerLevel = 1;
  const battle = applyEffects(
    scenario([effect, hit(), hit("defender", "attacker")]),
    "attacker",
  ).newBattle;
  expect(stored(battle)).toBe(500);
});

it("does not accumulate from self damage or allied damage", () => {
  const effect = mark();
  effect.curseState = { storedHealing: 0, activatedRound: 1 };
  const battle = scenario([effect]);
  user(battle, "defender").direction = "left";
  accumulateCurseDamage([effect], battle.usersState, "attacker", "attacker", 1000, 3);
  accumulateCurseDamage([effect], battle.usersState, "attacker", "defender", 1000, 3);
  expect(effect.curseState.storedHealing).toBe(0);
});

it("rejects activation when buff prevention is active", () => {
  const effect = mark();
  effect.isNew = true;
  effect.createdRound = 3;
  const block = makeEffect(
    "buffprevent",
    { power: 100, rounds: 3 },
    {
      targetId: "attacker",
      creatorId: "defender",
      createdRound: 1,
      targetType: "user",
    },
  );
  const battle = applyEffects(scenario([effect, block, hit()]), "attacker").newBattle;
  expect(battle.usersEffects.some((e) => e.type === "curse")).toBe(false);
});

it("starts accumulating on the next action within the same round", () => {
  const effect = mark();
  effect.isNew = true;
  effect.createdRound = 3;
  let battle = applyEffects(scenario([effect, hit()]), "attacker").newBattle;
  expect(stored(battle)).toBe(0);
  battle.usersEffects.push(hit());
  battle = applyEffects(battle, "attacker").newBattle;
  expect(stored(battle)).toBe(250);
});

it.each(["increaseheal", "decreaseheal"] as const)(
  "keeps storage unchanged and applies %s to expiration payout",
  (type) => {
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
    const battle = applyEffects(
      scenario([mark(), modifier, hit(), hit("defender", "attacker")]),
      "attacker",
    ).newBattle;
    expect(stored(battle)).toBe(500);
    const health = user(battle).curHealth;
    expire(battle);
    expect(user(battle).curHealth - health).toBe(type === "increaseheal" ? 750 : 250);
  },
);

it("applies healing reduction to fractional storage on expiration", () => {
  const effect = mark();
  effect.curseState = { storedHealing: 759.52, activatedRound: 1 };
  const reduction = makeEffect(
    "decreaseheal",
    { power: 30, calculation: "percentage", rounds: 3 },
    { creatorId: "attacker", targetId: "attacker", createdRound: 1 },
  );
  const battle = scenario([effect, reduction]);
  const expected = (stored(battle) * 0.7).toFixed(2);
  const health = user(battle).curHealth;
  const transition = expire(battle);
  expect((user(battle).curHealth - health).toFixed(2)).toBe(expected);
  expect(
    transition.expiredEffects.some((e) => e.txt.includes(`restores ${expected} HP`)),
  ).toBe(true);
});

it("applies decreaseheal before capping Curse at missing HP", () => {
  const effect = mark();
  effect.curseState = { storedHealing: 500, activatedRound: 1 };
  const reduction = makeEffect(
    "decreaseheal",
    { power: 50, calculation: "percentage", rounds: 3 },
    { creatorId: "attacker", targetId: "attacker", createdRound: 1 },
  );
  const battle = scenario([effect, reduction]);
  user(battle).curHealth = 9600;
  settleCurse(effect, user(battle), battle.usersEffects);
  expect(user(battle).curHealth).toBe(9850);
});

it.each(["lifesteal", "absorb", "vamp"] as const)(
  "disables %s for the Curse holder and resumes it after expiry",
  (type) => {
    const conversion = () =>
      makeEffect(
        type,
        { power: 40, calculation: "percentage", rounds: type === "vamp" ? 0 : 3 },
        {
          id: `conversion-${type}`,
          creatorId: "attacker",
          targetId: "attacker",
          targetType: "user",
          createdRound: type === "vamp" ? 3 : 1,
          isNew: type === "vamp",
        },
      );
    const attack = () => (type === "absorb" ? hit("defender", "attacker") : hit());
    const baseline = applyEffects(scenario([attack()]), "attacker").newBattle;
    const enabled = applyEffects(
      scenario([attack(), conversion()]),
      "attacker",
    ).newBattle;
    expect(user(enabled).curHealth).toBeGreaterThan(user(baseline).curHealth);
    const blocked = applyEffects(
      scenario([mark(), attack(), conversion()]),
      "attacker",
    ).newBattle;
    expect(user(blocked).curHealth).toBe(user(baseline).curHealth);
    const expired = mark();
    expired.rounds = 0;
    const resumed = applyEffects(
      scenario([expired, attack(), conversion()]),
      "attacker",
    ).newBattle;
    expect(user(resumed).curHealth).toBe(user(enabled).curHealth);
  },
);

it("blocks all Absorb pools while Curse is active", () => {
  const absorb = makeEffect(
    "absorb",
    {
      power: 60,
      calculation: "percentage",
      poolsAffected: ["Health", "Chakra", "Stamina"],
      rounds: 3,
    },
    {
      creatorId: "attacker",
      targetId: "attacker",
      targetType: "user",
      createdRound: 1,
    },
  );
  const battle = scenario([mark(), hit("defender", "attacker"), absorb]);
  user(battle).curChakra = 10;
  user(battle).curStamina = 10;
  const result = applyEffects(battle, "attacker").newBattle;
  expect(user(result).curHealth).toBe(4000);
  expect(user(result).curChakra).toBe(10);
  expect(user(result).curStamina).toBe(10);
});

it("blocks Vamp on Curse's casting action", () => {
  const effect = mark();
  effect.createdRound = 3;
  effect.isNew = true;
  const vamp = makeEffect(
    "vamp",
    { power: 40, rounds: 0 },
    {
      creatorId: "attacker",
      targetId: "attacker",
      targetType: "user",
      createdRound: 3,
      isNew: true,
    },
  );
  const battle = applyEffects(scenario([effect, hit(), vamp]), "attacker").newBattle;
  expect(user(battle).curHealth).toBe(5000);
});

it("does not block the opponent's Lifesteal", () => {
  const lifesteal = makeEffect(
    "lifesteal",
    { power: 40, rounds: 3 },
    {
      creatorId: "defender",
      targetId: "defender",
      targetType: "user",
      createdRound: 1,
    },
  );
  const battle = applyEffects(
    scenario([mark(), hit("defender", "attacker"), lifesteal]),
    "attacker",
  ).newBattle;
  expect(user(battle, "defender").curHealth).toBeGreaterThan(5000);
});

it.each(["clear", "seal"] as const)(
  "allows Lifesteal after Curse is disabled by %s",
  (type) => {
    const effect = mark();
    if (type === "seal") effect.fromType = "bloodline";
    const removal = makeEffect(
      type,
      { power: 100, rounds: type === "seal" ? 3 : 0 },
      {
        creatorId: "defender",
        targetId: "attacker",
        targetType: "user",
        createdRound: type === "clear" ? 3 : 1,
        isNew: type === "clear",
      },
    );
    const lifesteal = makeEffect(
      "lifesteal",
      { power: 40, rounds: 3 },
      {
        creatorId: "attacker",
        targetId: "attacker",
        targetType: "user",
        createdRound: 1,
        fromType: "armor",
      },
    );
    const battle = applyEffects(
      scenario([effect, removal, hit(), lifesteal]),
      "attacker",
    ).newBattle;
    expect(user(battle).curHealth).toBeGreaterThan(5000);
  },
);
