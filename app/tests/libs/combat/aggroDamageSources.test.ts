import { describe, expect, it } from "bun:test";
import { applyEffects } from "@/libs/combat/process";
import type { CompleteBattle, UserEffect } from "@/libs/combat/types";
import { makeBattleUser, makeCompleteBattle, makeEffect } from "../../setup/combat";

const hit = (creatorId = "attacker", residual = false) =>
  makeEffect(
    "damage",
    { power: 100, calculation: "static", rounds: residual ? 3 : 0 },
    {
      id: `hit-${creatorId}`,
      creatorId,
      targetId: "defender",
      targetType: "user",
      isNew: !residual,
      createdRound: residual ? 1 : 3,
      timeTracker: {},
      fromType: "jutsu",
    },
  );
const diffuse = (targetId: string) =>
  makeEffect(
    "diffuse",
    { power: 50, delayRounds: 1, rounds: 3 },
    {
      creatorId: targetId,
      targetId,
      targetType: "user",
      createdRound: 1,
    },
  );
const generation = (
  creatorId: string,
  power: number,
  calculation: "static" | "percentage" = "percentage",
) =>
  makeEffect(
    "increaseaggro",
    { power, calculation, aggroMode: "GENERATION" },
    {
      id: `generation-${creatorId}`,
      creatorId,
      targetId: creatorId,
      fromType: "armor",
    },
  );
const battle = (effects: UserEffect[], hp = 1000) =>
  makeCompleteBattle({
    round: 3,
    usersState: [
      makeBattleUser("attacker", { curHealth: 1000, maxHealth: 1000, enmity: 0 }),
      makeBattleUser("defender", {
        curHealth: hp,
        maxHealth: 1000,
        isAi: true,
        enmity: 0,
      }),
    ],
    usersEffects: effects,
  });
const user = (current: CompleteBattle, id: string) =>
  current.usersState.find((u) => u.userId === id)!;
const repay = (
  current: CompleteBattle,
  targetId = "defender",
  effects: UserEffect[] = [],
) => {
  current.round += 1;
  current.usersEffects = effects;
  return applyEffects(current, targetId).newBattle;
};

describe("Diffuse damage enmity", () => {
  it("credits actual deferred HP loss once after serialization and effect expiry", () => {
    const immediate = applyEffects(
      battle([hit(), diffuse("defender")]),
      "attacker",
    ).newBattle;
    expect(user(immediate, "attacker").enmity).toBe(40);
    const paid = repay(JSON.parse(JSON.stringify(immediate)) as CompleteBattle);
    expect(user(paid, "defender").curHealth).toBe(920);
    expect(user(paid, "attacker").damageDealt).toBe(80);
    expect(user(paid, "attacker").enmity).toBe(80);
    expect(user(applyEffects(paid, "defender").newBattle, "attacker").enmity).toBe(80);
  });

  it.each([false, true])(
    "caps repayment credit at remaining HP with Final Stand=%s",
    (finalStand) => {
      const immediate = applyEffects(
        battle([hit(), diffuse("defender")]),
        "attacker",
      ).newBattle;
      user(immediate, "defender").curHealth = 20;
      const paid = repay(
        immediate,
        "defender",
        finalStand
          ? [
              makeEffect(
                "finalstand",
                { rounds: 3 },
                {
                  targetId: "defender",
                  creatorId: "defender",
                  targetType: "user",
                  createdRound: 1,
                },
              ),
            ]
          : [],
      );
      expect(user(paid, "defender").curHealth).toBe(finalStand ? 1 : 0);
      expect(user(paid, "attacker").enmity).toBe(finalStand ? 59 : 60);
      // The existing quest tracker counts the repayment amount, even on overkill.
      expect(user(paid, "attacker").damageDealt).toBe(finalStand ? 59 : 80);
    },
  );

  it("retains distinct summons' debt ownership while crediting their controller's quests", () => {
    const initial = battle([hit("summon-a"), hit("summon-b"), diffuse("defender")]);
    for (const id of ["summon-a", "summon-b"])
      initial.usersState.push(
        makeBattleUser(id, {
          direction: "left",
          isSummon: true,
          isAi: true,
          controllerId: "attacker",
          enmity: 0,
        }),
      );
    const paid = repay(applyEffects(initial, "summon-a").newBattle);
    expect(user(paid, "defender").curHealth).toBe(840);
    expect(user(paid, "summon-a").enmity).toBe(80);
    expect(user(paid, "summon-b").enmity).toBe(80);
    expect(user(paid, "attacker").enmity).toBe(0);
    expect(user(paid, "attacker").damageDealt).toBe(160);
  });

  it("keeps quest credit after a summon departs without giving its threat to the controller", () => {
    const initial = battle([hit("summon"), diffuse("defender")]);
    initial.usersState.push(
      makeBattleUser("summon", {
        direction: "left",
        isSummon: true,
        controllerId: "attacker",
        enmity: 0,
      }),
    );
    const immediate = applyEffects(initial, "summon").newBattle;
    immediate.usersState = immediate.usersState.filter((u) => u.userId !== "summon");
    const paid = repay(immediate);
    expect(user(paid, "attacker").damageDealt).toBe(80);
    expect(user(paid, "attacker").enmity).toBe(0);
    expect(user(paid, "defender").curHealth).toBe(920);
  });

  it.each([false, true])(
    "excludes recoil with Diffuse=%s on both immediate and deferred loss",
    (hasDiffuse) => {
      const recoil = makeEffect(
        "recoil",
        { power: 50, calculation: "percentage", rounds: 3 },
        {
          creatorId: "attacker",
          targetId: "attacker",
          targetType: "user",
          createdRound: 1,
        },
      );
      const immediate = applyEffects(
        battle([hit(), recoil, ...(hasDiffuse ? [diffuse("attacker")] : [])]),
        "attacker",
      ).newBattle;
      expect(user(immediate, "attacker").curHealth).toBe(hasDiffuse ? 980 : 960);
      expect(user(immediate, "defender").enmity).toBe(0);
      const paid = repay(immediate, "attacker");
      expect(user(paid, "attacker").curHealth).toBe(960);
      expect(user(paid, "attacker").enmity).toBe(80);
      expect(user(paid, "defender").enmity).toBe(0);
      expect(user(paid, "defender").damageDealt).toBe(0);
    },
  );

  it("credits reflection immediately and on repayment without granting quest damage", () => {
    const reflect = makeEffect(
      "reflect",
      { power: 50, calculation: "percentage", rounds: 3 },
      {
        creatorId: "defender",
        targetId: "defender",
        targetType: "user",
        createdRound: 1,
      },
    );
    const immediate = applyEffects(
      battle([hit(), reflect, diffuse("attacker")]),
      "attacker",
    ).newBattle;
    expect(user(immediate, "defender").enmity).toBe(20);
    const paid = repay(immediate, "attacker");
    expect(user(paid, "attacker").curHealth).toBe(960);
    expect(user(paid, "defender").enmity).toBe(40);
    expect(user(paid, "defender").damageDealt).toBe(0);
  });

  it("applies the original actor's current generation modifiers to the repayment", () => {
    const immediate = applyEffects(
      battle([hit(), diffuse("defender"), generation("attacker", 50)]),
      "attacker",
    ).newBattle;
    expect(user(immediate, "attacker").enmity).toBe(60);
    const paid = repay(immediate, "defender", [generation("attacker", 100)]);
    expect(user(paid, "attacker").enmity).toBe(140);
    expect(user(paid, "attacker").damageDealt).toBe(80);
  });

  it("repays debts without enmity attribution as damage only", () => {
    const recoil = battle([]);
    user(recoil, "defender").diffuseDamage = [
      {
        attackerId: "attacker",
        sourceUserId: "attacker",
        remainingDamage: 40,
        remainingTurns: 1,
        lastAppliedRound: 3,
        creditDamage: true,
      },
    ];
    const paid = repay(recoil);
    expect(user(paid, "defender").curHealth).toBe(960);
    expect(user(paid, "attacker").damageDealt).toBe(40);
    expect(user(paid, "attacker").enmity).toBe(0);
  });
});

describe("aggregated damage enmity", () => {
  const partyBattle = (effects: UserEffect[], hp = 1000) => {
    const initial = battle(effects, hp);
    initial.usersState.push(
      makeBattleUser("teammate", { direction: "left", longitude: 2, enmity: 0 }),
    );
    return initial;
  };

  it("credits residual creators separately using their own generation modifiers", () => {
    const current = applyEffects(
      partyBattle([
        hit("attacker", true),
        hit("teammate", true),
        generation("attacker", 50),
        generation("teammate", 100),
      ]),
      "defender",
    ).newBattle;
    expect(user(current, "defender").curHealth).toBe(840);
    expect(user(current, "attacker").enmity).toBe(120);
    expect(user(current, "teammate").enmity).toBe(160);
    expect(user(current, "attacker").damageDealt).toBe(160);
    expect(user(current, "teammate").damageDealt).toBe(0);
  });

  it.each([false, true])(
    "caps each source in packet order on overkill, reversed=%s",
    (reverse) => {
      const creators = reverse ? ["teammate", "attacker"] : ["attacker", "teammate"];
      const current = applyEffects(
        partyBattle(
          creators.map((id) => hit(id, true)),
          100,
        ),
        "defender",
      ).newBattle;
      expect(user(current, "defender").curHealth).toBe(0);
      expect(user(current, creators[0]!).enmity).toBe(80);
      expect(user(current, creators[1]!).enmity).toBe(20);
      expect(user(current, creators[0]!).damageDealt).toBe(160);
    },
  );

  it("preserves shield order and credits only each creator's unabsorbed HP damage", () => {
    const shield = makeEffect(
      "shield",
      { power: 30, health: 30, rounds: 3 },
      {
        creatorId: "defender",
        targetId: "defender",
        targetType: "user",
        createdRound: 1,
      },
    );
    const current = applyEffects(
      partyBattle([hit("attacker", true), hit("teammate", true), shield]),
      "defender",
    ).newBattle;
    expect(user(current, "defender").curHealth).toBe(870);
    expect(user(current, "attacker").enmity).toBe(50);
    expect(user(current, "teammate").enmity).toBe(80);
    expect(user(current, "attacker").damageDealt).toBe(130);
  });

  it("applies flat generation once per actor per merged damage kind", () => {
    const second = hit("attacker", true);
    second.id = "second-hit";
    const current = applyEffects(
      partyBattle([
        hit("attacker", true),
        second,
        generation("attacker", 10, "static"),
      ]),
      "defender",
    ).newBattle;
    expect(user(current, "defender").curHealth).toBe(840);
    expect(user(current, "attacker").enmity).toBe(170);
  });

  it("retains each source across both the immediate Diffuse remainder and repayment", () => {
    const immediate = applyEffects(
      partyBattle([hit("attacker", true), hit("teammate", true), diffuse("defender")]),
      "defender",
    ).newBattle;
    expect(user(immediate, "defender").curHealth).toBe(920);
    expect(user(immediate, "attacker").enmity).toBe(40);
    expect(user(immediate, "teammate").enmity).toBe(40);
    const paid = repay(immediate);
    expect(user(paid, "defender").curHealth).toBe(840);
    expect(user(paid, "attacker").enmity).toBe(80);
    expect(user(paid, "teammate").enmity).toBe(80);
    expect(user(paid, "attacker").damageDealt).toBe(120);
    expect(user(paid, "teammate").damageDealt).toBe(40);
  });
});

describe("onehitkill damage credit", () => {
  it("credits the HP an instant kill removes to damageDealt", () => {
    const ohk = makeEffect(
      "onehitkill",
      { power: 100, rounds: 0 },
      {
        id: "ohk",
        creatorId: "attacker",
        targetId: "defender",
        targetType: "user",
        isNew: true,
        createdRound: 3,
        fromType: "jutsu",
      },
    );
    const current = applyEffects(battle([ohk], 700), "attacker").newBattle;
    expect(user(current, "defender").curHealth).toBe(0);
    expect(user(current, "attacker").damageDealt).toBe(700);
  });
});
