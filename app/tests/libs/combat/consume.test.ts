import { describe, expect, it } from "vitest";
import { applyEffects } from "@/libs/combat/process";
import type { CombatAction, CompleteBattle, UserEffect } from "@/libs/combat/types";
import { makeBattleUser, makeDamageEffect, makeEffect } from "./helpers/battleScenario";

const ROUND = 3;

const makeAction = (): CombatAction =>
  ({ chakraCost: 0, staminaCost: 0 }) as CombatAction;

const makeBattle = (
  usersState: ReturnType<typeof makeBattleUser>[],
  usersEffects: UserEffect[],
): CompleteBattle =>
  ({
    battleType: "COMBAT",
    round: ROUND,
    usersState,
    usersEffects,
    groundEffects: [],
    extraState: {},
  }) as unknown as CompleteBattle;

const makeAttacker = (overrides: Record<string, unknown> = {}) =>
  makeBattleUser("attacker", { curHealth: 1000, maxHealth: 1000, ...overrides });
const makeDefender = (overrides: Record<string, unknown> = {}) =>
  makeBattleUser("defender", {
    curHealth: 100_000_000,
    maxHealth: 100_000_000,
    ...overrides,
  });

const makeAttack = (
  id = "damage-1",
  creatorId = "attacker",
  targetId = "defender",
): UserEffect =>
  makeDamageEffect({
    id,
    creatorId,
    targetId,
    isNew: true,
    castThisRound: true,
    createdRound: ROUND,
    rounds: 0,
    targetType: "user",
  } as Partial<UserEffect>);

const makeConsume = (power: number, shieldRounds = 3): UserEffect =>
  makeEffect(
    "consume",
    { power, calculation: "percentage", shieldRounds },
    {
      id: "consume-1",
      creatorId: "attacker",
      targetId: "attacker",
      isNew: true,
      castThisRound: true,
      createdRound: ROUND,
      actionId: "consume-action",
      targetType: "user",
    },
  );

/**
 * Active shield on the target that guarantees activation and absorbs a large
 * chunk of a hit's damage. See vamp_lifesteal_cap.test.ts for the same fixture.
 */
const makeShield = (targetId: string): UserEffect =>
  makeEffect(
    "shield",
    { power: 100, health: 100_000 },
    {
      id: `shield-${targetId}`,
      creatorId: targetId,
      targetId,
      isNew: true,
      castThisRound: true,
      createdRound: ROUND,
      actionId: "shield-action",
      targetType: "user",
    },
  );

const findConsumeShield = (effects: UserEffect[]) =>
  effects.find(
    (e) => e.type === "shield" && e.targetId === "attacker" && (e.power ?? 0) > 0,
  );

describe("applyEffects — consume", () => {
  it("converts a percentage of damage dealt into a shield on the attacker", () => {
    const attacker = makeAttacker();
    const defender = makeDefender();
    const battle = makeBattle([attacker, defender], [makeAttack(), makeConsume(50)]);
    const { newBattle, actionEffects } = applyEffects(battle, "attacker", makeAction());

    const healthLost =
      defender.curHealth -
      (newBattle.usersState.find((u) => u.userId === "defender")?.curHealth ?? 0);
    expect(healthLost).toBeGreaterThan(0);

    const shields = newBattle.usersEffects.filter(
      (e) => e.type === "shield" && e.targetId === "attacker" && (e.power ?? 0) > 0,
    );
    expect(shields).toHaveLength(1);
    expect(shields[0]?.power).toBeCloseTo(Math.floor(healthLost * 0.5), 0);
    expect(shields[0]?.rounds).toBe(3);
    expect(
      actionEffects.some((e) => e.txt.includes("consumes") && e.txt.includes("shield")),
    ).toBe(true);
  });

  it("does not leave the consume tag itself as a lingering effect", () => {
    const battle = makeBattle(
      [makeAttacker(), makeDefender()],
      [makeAttack(), makeConsume(25, 5)],
    );
    const { newBattle } = applyEffects(battle, "attacker", makeAction());

    expect(newBattle.usersEffects.some((e) => e.type === "consume")).toBe(false);
    const shield = newBattle.usersEffects.find(
      (e) => e.type === "shield" && e.targetId === "attacker",
    );
    expect(shield).toBeDefined();
    expect(shield?.rounds).toBe(5);
  });

  it("sizes the consume shield off pre-shield damage when the defender has a shield", () => {
    // No-shield reference: consume (50%) of the full hit; healthLost == raw damage.
    const refDefender = makeDefender();
    const { newBattle: ref } = applyEffects(
      makeBattle([makeAttacker(), refDefender], [makeAttack(), makeConsume(50)]),
      "attacker",
      makeAction(),
    );
    const refHealthLost =
      refDefender.curHealth -
      (ref.usersState.find((u) => u.userId === "defender")?.curHealth ?? 0);
    const refShield = findConsumeShield(ref.usersEffects);
    expect(refHealthLost).toBeGreaterThan(0);
    expect(refShield?.power).toBeGreaterThan(0);

    // Same hit, but the defender's shield absorbs the damage (post-shield HP loss ~0).
    const shieldedDefender = makeDefender();
    const { newBattle: shielded } = applyEffects(
      makeBattle(
        [makeAttacker(), shieldedDefender],
        [makeAttack(), makeConsume(50), makeShield("defender")],
      ),
      "attacker",
      makeAction(),
    );
    const shieldedHealthLost =
      shieldedDefender.curHealth -
      (shielded.usersState.find((u) => u.userId === "defender")?.curHealth ?? 0);
    const consumeShield = findConsumeShield(shielded.usersEffects);

    expect(shieldedHealthLost).toBeLessThan(refHealthLost);
    // Consume is sized off the FULL pre-shield hit, so the granted shield matches the
    // no-shield reference even when post-shield damage collapses toward 0.
    expect(consumeShield?.power).toBeCloseTo(refShield!.power!, 0);
  });

  it("merges consume shields across multiple damage hits on the same target", () => {
    // Two damage consequences share targetId and collapse; consumeShield must accumulate
    // in the merge branch (current.consumeShield += ...), producing one shield sized off
    // the total pre-shield damage — not two separate shields or only the first hit.
    const defender = makeDefender();
    const { newBattle } = applyEffects(
      makeBattle(
        [makeAttacker(), defender],
        [makeAttack("damage-1"), makeAttack("damage-2"), makeConsume(50)],
      ),
      "attacker",
      makeAction(),
    );
    const healthLost =
      defender.curHealth -
      (newBattle.usersState.find((u) => u.userId === "defender")?.curHealth ?? 0);
    const shields = newBattle.usersEffects.filter(
      (e) => e.type === "shield" && e.targetId === "attacker" && (e.power ?? 0) > 0,
    );

    expect(healthLost).toBeGreaterThan(0);
    expect(shields).toHaveLength(1);
    expect(shields[0]?.power).toBeCloseTo(Math.floor(healthLost * 0.5), 0);
  });

  it("grants a shield that absorbs incoming damage on a later action", () => {
    // Drive createConsumeShieldEffect through applyEffects, then confirm the resulting
    // effect actually soaks damage (catches a broken ShieldTag field that would leave a
    // non-absorbing shield in usersEffects).
    const { newBattle: afterConsume } = applyEffects(
      makeBattle([makeAttacker(), makeDefender()], [makeAttack(), makeConsume(50)]),
      "attacker",
      makeAction(),
    );
    const consumeShield = findConsumeShield(afterConsume.usersEffects);
    expect(consumeShield).toBeDefined();
    expect(consumeShield!.power).toBeGreaterThan(0);
    const shieldHpBefore = consumeShield!.power;

    // Control: defender hits attacker with no shield.
    const controlAttacker = makeAttacker({ curHealth: 100_000_000, maxHealth: 100_000_000 });
    const { newBattle: control } = applyEffects(
      makeBattle(
        [controlAttacker, makeDefender()],
        [makeAttack("retaliation", "defender", "attacker")],
      ),
      "defender",
      makeAction(),
    );
    const controlLost =
      controlAttacker.curHealth -
      (control.usersState.find((u) => u.userId === "attacker")?.curHealth ?? 0);
    expect(controlLost).toBeGreaterThan(0);

    // Same retaliation with the consume-granted shield carried forward.
    const shieldedAttacker = makeAttacker({
      curHealth: 100_000_000,
      maxHealth: 100_000_000,
    });
    const { newBattle: shielded, actionEffects } = applyEffects(
      makeBattle(
        [shieldedAttacker, makeDefender()],
        [
          { ...consumeShield!, power: shieldHpBefore },
          makeAttack("retaliation", "defender", "attacker"),
        ],
      ),
      "defender",
      makeAction(),
    );
    const shieldedLost =
      shieldedAttacker.curHealth -
      (shielded.usersState.find((u) => u.userId === "attacker")?.curHealth ?? 0);
    const remainingShield = findConsumeShield(shielded.usersEffects);

    expect(shieldedLost).toBeLessThan(controlLost);
    expect(
      actionEffects.some((e) => e.txt.includes("shield absorbs")),
    ).toBe(true);
    // Shield HP decreased (or was destroyed) by the absorbed amount.
    expect((remainingShield?.power ?? 0) < shieldHpBefore || remainingShield === undefined).toBe(
      true,
    );
  });
});
