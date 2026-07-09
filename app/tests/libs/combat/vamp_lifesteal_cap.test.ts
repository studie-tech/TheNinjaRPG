import { describe, expect, it } from "vitest";
import { applyEffects } from "@/libs/combat/process";
import { DAMAGE_LEECH_CAP_RATIO } from "@/libs/combat/constants";
import type { CombatAction, CompleteBattle, UserEffect } from "@/libs/combat/types";
import { makeBattleUser, makeDamageEffect, makeEffect } from "./helpers/battleScenario";

const ROUND = 3;

/** Minimal action fixture — effects drive the packet, not the action. */
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

/**
 * Attacker with almost no current HP but a huge max, so any heal is fully
 * observable (never clamped). Defender is a huge sponge so it always survives
 * (lets lifesteal proc) unless a test overrides its HP.
 */
const makeAttacker = (overrides: Record<string, unknown> = {}) =>
  makeBattleUser("attacker", { curHealth: 1, maxHealth: 100_000_000, ...overrides });
const makeDefender = (overrides: Record<string, unknown> = {}) =>
  makeBattleUser("defender", { curHealth: 100_000_000, maxHealth: 100_000_000, ...overrides });

/**
 * Same-round damage jutsu attacker -> defender. Distinct ids collapse onto one consequence.
 *
 * `rounds: 0` and `targetType: "user"` are added on top of the brief's fixture: neither
 * `effectRuntimeSchema` nor `DamageTag`'s `BaseAttributes.rounds` supplies a default, so
 * without them `damageUser`'s `instant`/`residual` check is false and no consequence (and
 * thus no damage) is ever recorded — `applySingleEffect` also gates every effect type on
 * `effect.targetType === "user"` before dispatching, and that field has no schema default
 * either. See `summon_damage_credit.test.ts` for the same two fields on its instant-damage
 * fixture.
 */
const makeAttack = (id = "damage-1"): UserEffect =>
  makeDamageEffect({
    id,
    creatorId: "attacker",
    targetId: "defender",
    isNew: true,
    castThisRound: true,
    createdRound: ROUND,
    rounds: 0,
    targetType: "user",
  } as Partial<UserEffect>);

/**
 * Same-round vamp self-buff cast by the attacker (matches consequences by creatorId).
 *
 * `rounds: 0` is added on top of the brief's fixture: `calcEffectRoundInfo` recomputes
 * `effect.castThisRound` from `effect.rounds`/`effect.createdRound` at the top of
 * `applySingleEffect`, overwriting whatever the fixture set. `VampTag` (like `DamageTag`)
 * has no schema default for `rounds`, so without it `calcEffectRoundInfo` takes the
 * `rounds === undefined` branch (`startRound: -1`) and `castThisRound` always resolves to
 * `false` — silently defeating `vamp()`'s `effect.isNew && effect.castThisRound` gate.
 */
const makeVamp = (power: number): UserEffect =>
  makeEffect(
    "vamp",
    { power, calculation: "percentage" },
    {
      id: "vamp-1",
      creatorId: "attacker",
      targetId: "attacker",
      isNew: true,
      castThisRound: true,
      createdRound: ROUND,
      actionId: "vamp-action",
      targetType: "user",
      rounds: 0,
    },
  );

/** Lingering lifesteal buff on the attacker (matches consequences by targetId; must be non-new). */
const makeLifesteal = (power: number): UserEffect =>
  makeEffect(
    "lifesteal",
    { power, calculation: "percentage" },
    {
      id: "lifesteal-1",
      creatorId: "attacker",
      targetId: "attacker",
      isNew: false,
      castThisRound: false,
      createdRound: 1,
      actionId: "lifesteal-action",
      targetType: "user",
    },
  );

/**
 * Active shield on the target that guarantees activation and absorbs a large
 * chunk of a hit's damage.
 *
 * `shield()` (process.ts) only rolls/activates on `isNew` when `effect.rounds`
 * is truthy; `ShieldTag.rounds` has a schema prefault of 3, so the default
 * (unset) rounds already satisfies that gate. On activation it rolls
 * `Math.random() < power/100` and, on success, sets `effect.power =
 * shieldEffect.health` — the absorption pass later reads that `power` as
 * remaining shield capacity (process.ts:549, 566-568). `power: 100` makes the
 * roll always succeed (`Math.random()` is always `< 1`); `health` sets the
 * post-activation capacity.
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

/** A reflect buff on the defender: reflects a % of received damage back at the attacker. */
const makeReflect = (power: number): UserEffect =>
  makeEffect(
    "reflect",
    { power, calculation: "percentage" },
    {
      id: "reflect-1",
      creatorId: "defender",
      targetId: "defender",
      isNew: false,
      castThisRound: false,
      createdRound: 1,
      actionId: "reflect-action",
      targetType: "user",
    },
  );

/** A healprevent debuff targeting a user, created on a given round. */
const makeHealPrevent = (targetId: string, createdRound: number): UserEffect =>
  makeEffect(
    "healprevent",
    { power: 100, calculation: "static", rounds: 5 },
    {
      id: `healprevent-${targetId}`,
      creatorId: "defender",
      targetId,
      targetType: "user",
      isNew: false,
      castThisRound: false,
      createdRound,
      actionId: "healprevent-action",
    },
  );

/** Runs one packet and returns the observed HP deltas. */
const runLeech = (effects: UserEffect[], attacker = makeAttacker(), defender = makeDefender()) => {
  const battle = makeBattle([attacker, defender], effects);
  const { newBattle } = applyEffects(battle, "attacker", makeAction());
  const a = newBattle.usersState.find((u) => u.userId === "attacker");
  const d = newBattle.usersState.find((u) => u.userId === "defender");
  return {
    healGained: (a?.curHealth ?? 0) - attacker.curHealth,
    healthLost: defender.curHealth - (d?.curHealth ?? 0),
  };
};

describe("applyEffects — vamp + lifesteal shared 60% cap", () => {
  it("caps the COMBINED heal at 60% of damage when both proc (40% + 40% -> 60%)", () => {
    // Both raw contributions are 40% of damage; summed 80% must clamp to the 60% budget.
    const { healGained, healthLost } = runLeech([makeAttack(), makeVamp(40), makeLifesteal(40)]);

    expect(healthLost).toBeGreaterThan(0);
    // Combined heal clamps to the shared budget. (Before the fix this ratio was ~0.4 — vamp
    // only — because lifesteal was fully suppressed by the mutual-exclusion guard.)
    // Ratio assertion is robust to the damage formula's magnitude and to sub-HP flooring.
    expect(healGained / healthLost).toBeCloseTo(DAMAGE_LEECH_CAP_RATIO, 2);
  });

  it("vamp alone still caps at 60% of damage", () => {
    const { healGained, healthLost } = runLeech([makeAttack(), makeVamp(80)]);
    expect(healthLost).toBeGreaterThan(0);
    expect(healGained / healthLost).toBeCloseTo(DAMAGE_LEECH_CAP_RATIO, 2);
  });

  it("lifesteal alone still caps at ~60% of damage", () => {
    const { healGained, healthLost } = runLeech([makeAttack(), makeLifesteal(80)]);
    expect(healthLost).toBeGreaterThan(0);
    expect(healGained / healthLost).toBeCloseTo(DAMAGE_LEECH_CAP_RATIO, 2);
  });

  it("adds vamp and lifesteal when the combined heal is under the cap", () => {
    // Deterministic damage per run, so the combined heal equals the exact sum of the two
    // individual heals (robust to the exact power->ratio math), and stays below the cap.
    const vampOnly = runLeech([makeAttack(), makeVamp(20)]);
    const lifestealOnly = runLeech([makeAttack(), makeLifesteal(20)]);
    const both = runLeech([makeAttack(), makeVamp(20), makeLifesteal(20)]);
    expect(both.healthLost).toBeGreaterThan(0);
    expect(both.healGained).toBeCloseTo(vampOnly.healGained + lifestealOnly.healGained, 5);
    expect(both.healGained).toBeLessThan(both.healthLost * DAMAGE_LEECH_CAP_RATIO);
  });

  it("shares one budget across merged multi-hit damage on the same target", () => {
    // Two hits collapse (targetId-keyed) into one consequence; preShieldDamage sums, so the
    // single budget is derived from the TOTAL damage. 40% + 40% still clamps to 60% of the sum.
    const { healGained, healthLost } = runLeech([
      makeAttack("damage-1"),
      makeAttack("damage-2"),
      makeVamp(40),
      makeLifesteal(40),
    ]);
    expect(healthLost).toBeGreaterThan(0);
    expect(healGained / healthLost).toBeCloseTo(DAMAGE_LEECH_CAP_RATIO, 2);
  });

  it("on a killing blow only vamp heals (lifesteal needs a live target)", () => {
    const defender = makeDefender({ curHealth: 1 });
    const kill = runLeech([makeAttack(), makeVamp(40), makeLifesteal(40)], makeAttacker(), defender);
    // Damage is stat-based (not HP-based), so vamp against a LIVE defender deals identical
    // damage and thus identical vamp healing. On a killing blow lifesteal is suppressed, so the
    // heal must equal the vamp-only reference exactly — this would fail if lifesteal wrongly procced.
    const ref = runLeech([makeAttack(), makeVamp(40)]);
    expect(kill.healGained).toBeGreaterThan(0);
    expect(kill.healGained).toBeCloseTo(ref.healGained, 5);
  });

  it("clamps the combined heal to maxHealth and never exceeds the budget", () => {
    // Attacker near full: heal is clamped by maxHealth; state stays valid.
    const attacker = makeAttacker({ curHealth: 99_999_990, maxHealth: 100_000_000 });
    const { healGained, healthLost } = runLeech(
      [makeAttack(), makeVamp(40), makeLifesteal(40)],
      attacker,
    );
    expect(healthLost).toBeGreaterThan(0);
    // curHealth clamped to max: gain is exactly the headroom (10).
    expect(healGained).toBeCloseTo(10, 5);
  });

  it("vamps off the full pre-shield damage when the target has a shield", () => {
    // No-shield reference: vamp (40%) heals 0.4 * full damage D; healthLost == D.
    const ref = runLeech([makeAttack(), makeVamp(40)]);
    // Same hit, but the defender has a shield that absorbs a large chunk of it.
    const shielded = runLeech([makeAttack(), makeVamp(40), makeShield("defender")]);
    expect(ref.healthLost).toBeGreaterThan(0);
    // The shield absorbed damage, so less HP was lost than the unshielded reference.
    expect(shielded.healthLost).toBeLessThan(ref.healthLost);
    // ...but vamp heals off the FULL pre-shield hit, so the vamp heal matches the
    // no-shield reference. (Before this change it would be smaller: ~0.4 * post-shield.)
    expect(shielded.healGained).toBeCloseTo(ref.healGained, 5);
  });

  it("reflect still kills a low-HP attacker before lifesteal can save them (ordering preserved)", () => {
    // Attacker at 1 HP with a lingering lifesteal buff; defender reflects the hit.
    // Reflect runs before lifesteal and re-checks user.curHealth > 0, so the attacker dies
    // and lifesteal never heals — exactly today's behavior.
    const attacker = makeAttacker({ curHealth: 1, maxHealth: 100_000_000 });
    const defender = makeDefender();
    const battle = makeBattle([attacker, defender], [makeAttack(), makeLifesteal(60), makeReflect(60)]);
    const { newBattle } = applyEffects(battle, "attacker", makeAction());
    const a = newBattle.usersState.find((u) => u.userId === "attacker");
    expect(a?.curHealth).toBe(0);
  });

  it("healprevent on the attacker blocks vamp (caster-direct check) while lifesteal is gated by its own preventCheck", () => {
    // Positive control: the same effect stack WITHOUT the prevent heals a nonzero amount,
    // so the blocked run's 0 is specifically the healprevent firing (not an unrelated no-op).
    const control = runLeech([makeAttack(), makeVamp(40), makeLifesteal(40)]);
    expect(control.healGained).toBeGreaterThan(0);
    const prevent = makeHealPrevent("attacker", 0);
    const { healGained } = runLeech([makeAttack(), makeVamp(40), makeLifesteal(40), prevent]);
    expect(healGained).toBe(0);
  });
});
