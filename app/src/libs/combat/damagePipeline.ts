import {
  DMG_REDUCTION_CAP,
  isPreBattleGearFromType,
  isPreBattleKeystoneFromType,
  OUT_OF_COMBAT_BASE_DAMAGE_INCREASE,
  OUT_OF_COMBAT_BASE_DAMAGE_REDUCTION,
  PARRY_MAX_PERCENTAGE,
} from "@/drizzle/constants";
import {
  damageBoostTypes,
  damageReductionTypes,
  HP_DAMAGE_KEYS,
  REFLECT_CAP_RATIO,
} from "./constants";
import { getCurseDamageMultiplier } from "./curse";
import { type DiffusePacket, deferDiffuseDamage } from "./diffuse";
import { getDamageModifierPreventState, getEfficiencyRatio, getPower } from "./tags";
import type {
  ActionEffect,
  BattleUserState,
  CompleteBattle,
  Consequence,
  ExtraState,
  PreBattleGearModifiers,
  UserEffect,
} from "./types";
import {
  calcEffectRoundInfo,
  getActiveSealEffects,
  getEffectStage,
  isEffectActive,
  sealCheck,
  sortEffects,
} from "./util";

/** Create independent zeroed totals for gear and keystone damage modifiers. */
export const emptyPreBattleGearModifiers = (): PreBattleGearModifiers => ({
  incDamageGivenFromGear: 0,
  incDamageTakenFromGear: 0,
  drTakenFromGear: 0,
  drGivenFromGear: 0,
  incDamageGivenFromKeystone: 0,
  incDamageTakenFromKeystone: 0,
  drTakenFromKeystone: 0,
  drGivenFromKeystone: 0,
});

/** True when percentage mods are folded into preBattleGearModifiers (not pipeline lists). */
const isPreBattleConsolidatedPercentageFromType = (
  fromType: string | undefined,
): boolean =>
  isPreBattleGearFromType(fromType) || isPreBattleKeystoneFromType(fromType);

/** Universal armor/accessory/keystone percentage mods fold into battle-start totals. */
export const isConsolidatedStage1PercentageModifier = (effect: UserEffect): boolean => {
  if (
    !damageBoostTypes.includes(effect.type) &&
    !damageReductionTypes.includes(effect.type)
  ) {
    return false;
  }
  if (!("fromType" in effect)) {
    return false;
  }
  if (!isPreBattleConsolidatedPercentageFromType(effect.fromType)) {
    return false;
  }
  return (
    effect.calculation === "percentage" &&
    !("elements" in effect && effect.elements?.length)
  );
};

/** Stage-1 percentage modifiers from skill/village/ranked stay in usersEffects for the pipeline. */
const isStage1NonGearPercentageModifier = (effect: UserEffect): boolean =>
  getEffectStage(effect) === 1 &&
  !("fromType" in effect && isPreBattleConsolidatedPercentageFromType(effect.fromType));

/** Apply fractional damage reduction without allowing the multiplier to become negative. */
const applyPercentageDrMultiplier = (damage: number, drFraction: number): number =>
  damage * Math.max(0, 1 - drFraction);

/** Aggregate one combatant's unscoped gear and keystone percentages into battle-start totals. */
export const buildPreBattleGearModifiersForUser = (
  userEffects: UserEffect[],
  userId: string,
): PreBattleGearModifiers => {
  const mods = emptyPreBattleGearModifiers();

  for (const effect of userEffects) {
    if (effect.targetId !== userId) continue;
    if (!isConsolidatedStage1PercentageModifier(effect)) continue;

    const { power } = getPower(effect);
    const isKeystone =
      "fromType" in effect && isPreBattleKeystoneFromType(effect.fromType);
    if (effect.type === "increasedamagegiven") {
      if (isKeystone) mods.incDamageGivenFromKeystone += power;
      else mods.incDamageGivenFromGear += power;
    } else if (effect.type === "increasedamagetaken") {
      if (isKeystone) mods.incDamageTakenFromKeystone += power;
      else mods.incDamageTakenFromGear += power;
    } else if (effect.type === "decreasedamagetaken") {
      if (isKeystone) mods.drTakenFromKeystone += Math.abs(power);
      else mods.drTakenFromGear += Math.abs(power);
    } else if (effect.type === "decreasedamagegiven") {
      if (isKeystone) mods.drGivenFromKeystone += Math.abs(power);
      else mods.drGivenFromGear += Math.abs(power);
    }
  }

  return mods;
};

/** Snapshot gear totals per combatant and remove folded effects so the pipeline cannot apply them twice. */
export const consolidatePreBattleDamageModifiers = (
  userEffects: UserEffect[],
  userIds: string[],
): {
  preBattleGearModifiers: Record<string, PreBattleGearModifiers>;
  filteredEffects: UserEffect[];
} => {
  const preBattleGearModifiers: Record<string, PreBattleGearModifiers> = {};
  for (const userId of userIds) {
    preBattleGearModifiers[userId] = buildPreBattleGearModifiersForUser(
      userEffects,
      userId,
    );
  }

  const filteredEffects = userEffects.filter(
    (e) => !isConsolidatedStage1PercentageModifier(e),
  );

  return { preBattleGearModifiers, filteredEffects };
};

/** Identify modifiers whose source follows the bloodline-specific stacking and permission rules. */
const isBloodlineDamageMod = (effect: UserEffect): boolean =>
  "fromType" in effect && effect.fromType === "bloodline";

/** Which packet id field to compare against effect.targetId (pair-dependent). */
type DamageModifierPacketSide = "attacker" | "defender";

export type DamageModifierEligibility = {
  targetId: string;
  increaseSide: DamageModifierPacketSide | null;
  decreaseSide: DamageModifierPacketSide | null;
  /** Set when prevent RNG blocks the modifier; reused for combat log (no second roll). */
  preventInfo?: ActionEffect;
};

/** Pair-independent timing + modifier type; built once per performAction round. */
export const buildDamageModifierEligibilityById = (
  usersEffects: UserEffect[],
  battleRound: number,
  usersStateById?: Map<string, BattleUserState>,
): Map<string, DamageModifierEligibility> => {
  const eligibilityById = new Map<string, DamageModifierEligibility>();
  const roundCtx = { round: battleRound };

  for (const effect of usersEffects) {
    const isBoost = damageBoostTypes.includes(effect.type);
    const isDr = damageReductionTypes.includes(effect.type);
    if (!isBoost && !isDr) continue;
    if (!isEffectActive(effect)) continue;

    // Same condition as adjustDamageGiven / adjustDamageTaken after applySingleEffect
    // assigns `effect.castThisRound = (startRound === curRound)`.
    const { startRound, curRound } = calcEffectRoundInfo(effect, roundCtx);
    const passesTiming = !effect.isNew && startRound !== curRound;

    const targetUser = usersStateById?.get(effect.targetId);
    const preventState = targetUser
      ? getDamageModifierPreventState(effect, usersEffects, targetUser)
      : { blocked: false, info: undefined };

    let increaseSide: DamageModifierPacketSide | null = null;
    let decreaseSide: DamageModifierPacketSide | null = null;
    if (passesTiming && !preventState.blocked) {
      if (effect.type === "increasedamagegiven") increaseSide = "attacker";
      else if (effect.type === "increasedamagetaken") increaseSide = "defender";
      if (effect.type === "decreasedamagegiven") decreaseSide = "attacker";
      else if (effect.type === "decreasedamagetaken") decreaseSide = "defender";
    }

    eligibilityById.set(effect.id, {
      targetId: effect.targetId,
      increaseSide,
      decreaseSide,
      preventInfo: preventState.info,
    });
  }

  return eligibilityById;
};

/** Match an eligible modifier to the attacker or defender side selected for this packet. */
const modifierAppliesToDamagePacketPair = (
  eligibility: DamageModifierEligibility | undefined,
  attackerId: string,
  defenderId: string,
  kind: "increase" | "decrease",
): boolean => {
  if (!eligibility) return false;
  const side =
    kind === "increase" ? eligibility.increaseSide : eligibility.decreaseSide;
  if (!side) return false;
  const id = side === "attacker" ? attackerId : defenderId;
  return id === eligibility.targetId;
};

/** Respect a damage effect's bloodline increase and reduction opt-outs without restricting other sources. */
const allowBloodlineDamageModifier = (
  damageEffect: UserEffect,
  modEffect: UserEffect,
  power: number,
): boolean => {
  if (!isBloodlineDamageMod(modEffect)) return true;
  if (
    !("allowBloodlineDamageIncrease" in damageEffect) ||
    !("allowBloodlineDamageDecrease" in damageEffect)
  ) {
    return true;
  }
  if (power > 0 && !damageEffect.allowBloodlineDamageIncrease) return false;
  if (power < 0 && !damageEffect.allowBloodlineDamageDecrease) return false;
  return true;
};

/** Normalize reduction effects to negative power for additive modifier stages. */
const getSignedDrModifierPower = (effect: UserEffect): number => {
  const { power } = getPower(effect);
  if (effect.type === "decreasedamagetaken" || effect.type === "decreasedamagegiven") {
    return -Math.abs(power);
  }
  return power;
};

export type DamagePacketModifierLists = {
  stage1PreBattleIncreases: UserEffect[];
  inBattleIncreases: UserEffect[];
  stage1PreBattleDrEffects: UserEffect[];
  inCombatDrEffects: UserEffect[];
  staticIncEffects: UserEffect[];
  staticDrEffects: UserEffect[];
  bloodlineIncreases: UserEffect[];
  bloodlineDrEffects: UserEffect[];
  elementalGearIncreases: UserEffect[];
  elementalGearReductions: UserEffect[];
  elementalKeystoneIncreases: UserEffect[];
  elementalKeystoneReductions: UserEffect[];
};

/** Bucket damage modifiers once per attacker–defender pair (reuse across consequences). */
export const buildDamagePacketModifierLists = (
  usersEffects: UserEffect[],
  attackerId: string,
  defenderId: string,
  eligibilityById: Map<string, DamageModifierEligibility>,
): DamagePacketModifierLists => {
  const applies = (effect: UserEffect, kind: "increase" | "decrease") =>
    modifierAppliesToDamagePacketPair(
      eligibilityById.get(effect.id),
      attackerId,
      defenderId,
      kind,
    );

  const stage1PreBattleIncreases: UserEffect[] = [];
  const inBattleIncreases: UserEffect[] = [];
  const stage1PreBattleDrEffects: UserEffect[] = [];
  const inCombatDrEffects: UserEffect[] = [];
  const staticIncEffects: UserEffect[] = [];
  const staticDrEffects: UserEffect[] = [];
  const bloodlineIncreases: UserEffect[] = [];
  const bloodlineDrEffects: UserEffect[] = [];
  const elementalGearIncreases: UserEffect[] = [];
  const elementalGearReductions: UserEffect[] = [];
  const elementalKeystoneIncreases: UserEffect[] = [];
  const elementalKeystoneReductions: UserEffect[] = [];

  for (const effect of usersEffects) {
    const isBoost = damageBoostTypes.includes(effect.type);
    const isDr = damageReductionTypes.includes(effect.type);
    if (!isBoost && !isDr) continue;

    const isBloodline = isBloodlineDamageMod(effect);
    const isStatic = effect.calculation === "static";
    const isPercentage = effect.calculation === "percentage";

    // Keep scoped gear in its existing additive stage, evaluated per damage packet.
    if (
      isPercentage &&
      "fromType" in effect &&
      "elements" in effect &&
      effect.elements?.length
    ) {
      const isGear = isPreBattleGearFromType(effect.fromType);
      const isKeystone = isPreBattleKeystoneFromType(effect.fromType);
      if (isGear || isKeystone) {
        if (isBoost && applies(effect, "increase"))
          (isKeystone ? elementalKeystoneIncreases : elementalGearIncreases).push(
            effect,
          );
        if (isDr && applies(effect, "decrease"))
          (isKeystone ? elementalKeystoneReductions : elementalGearReductions).push(
            effect,
          );
        continue;
      }
    }

    if (isBoost && applies(effect, "increase")) {
      if (isStatic) {
        staticIncEffects.push(effect);
      } else if (isPercentage && isBloodline) {
        bloodlineIncreases.push(effect);
      } else if (isPercentage && isStage1NonGearPercentageModifier(effect)) {
        stage1PreBattleIncreases.push(effect);
      } else if (isPercentage && getEffectStage(effect) === 2) {
        inBattleIncreases.push(effect);
      }
      continue;
    }

    if (isDr && applies(effect, "decrease")) {
      if (isStatic) {
        staticDrEffects.push(effect);
      } else if (isPercentage && isBloodline) {
        bloodlineDrEffects.push(effect);
      } else if (isPercentage && isStage1NonGearPercentageModifier(effect)) {
        stage1PreBattleDrEffects.push(effect);
      } else if (isPercentage && getEffectStage(effect) !== 1) {
        inCombatDrEffects.push(effect);
      }
    }
  }

  stage1PreBattleIncreases.sort(sortEffects);
  inBattleIncreases.sort(sortEffects);
  stage1PreBattleDrEffects.sort(sortEffects);
  inCombatDrEffects.sort(sortEffects);
  staticIncEffects.sort(sortEffects);
  staticDrEffects.sort(sortEffects);
  bloodlineIncreases.sort(sortEffects);
  bloodlineDrEffects.sort(sortEffects);

  return {
    stage1PreBattleIncreases,
    inBattleIncreases,
    stage1PreBattleDrEffects,
    inCombatDrEffects,
    staticIncEffects,
    staticDrEffects,
    bloodlineIncreases,
    bloodlineDrEffects,
    elementalGearIncreases,
    elementalGearReductions,
    elementalKeystoneIncreases,
    elementalKeystoneReductions,
  };
};

type DamagePacketComputeContext = {
  rawDamage: number;
  /** Preview incoming damage without player defenses; retain the system's base normalization. */
  ignoreDamageReduction?: boolean;
  damageEffect: UserEffect;
  usersEffects: UserEffect[];
  attackerId: string;
  defenderId: string;
  preBattleGearModifiers: Record<string, PreBattleGearModifiers>;
  battleRound: number;
  modifierLists?: DamagePacketModifierLists;
  sealEffects?: UserEffect[];
};

/** Resolve all HP damage sources together; secondary packets already contain their damage boosts. */
export const applyDiffuseToConsequences = ({
  consequences,
  effects,
  users,
  battle,
  eligibilityById,
  actionEffects,
}: {
  consequences: Map<string, Consequence>;
  effects: UserEffect[];
  users: BattleUserState[];
  battle: CompleteBattle;
  eligibilityById: Map<string, DamageModifierEligibility>;
  actionEffects: ActionEffect[];
}) => {
  if (!effects.length) return;
  const packets: DiffusePacket[] = [];
  const affected = new Set<Consequence>();
  for (const [effectId, consequence] of consequences) {
    // Fallbacks follow the consequence keys built in tags.ts: wound writes
    // `wound-<effectId>`, drain writes `drain-<creatorId>-<targetId>`.
    const source =
      battle.usersEffects.find(
        (e) => e.id === (consequence.diffuseSourceEffectId ?? effectId),
      ) ??
      battle.usersEffects.find(
        (e) =>
          e.id === effectId.replace(/^wound-/, "") ||
          (e.type === "drain" &&
            e.creatorId === consequence.userId &&
            e.targetId === consequence.targetId),
      );
    for (const key of [...HP_DAMAGE_KEYS, "reflect", "recoil"] as const) {
      const originalDamage = consequence[key] ?? 0;
      if (originalDamage <= 0) continue;
      const isReturnDamage = key === "reflect" || key === "recoil";
      const targetId = isReturnDamage ? consequence.userId : consequence.targetId;
      const attackerId = key === "reflect" ? consequence.targetId : consequence.userId;
      if (!effects.some((e) => e.targetId === targetId)) continue;
      const isPrimary = key === "damage" || key === "residual";
      const isPierce = consequence.types?.includes("pierce") ?? false;
      // Reflect is capped against the source hit before splitting the returned damage.
      const cappedDamage =
        key === "reflect"
          ? Math.min(originalDamage, (consequence.damage ?? 0) * REFLECT_CAP_RATIO)
          : originalDamage;
      // Parry splits the complete packet, including static damage increases.
      const parryFraction =
        Math.min(PARRY_MAX_PERCENTAGE, consequence.parryPercentage ?? 0) / 100;
      const damage =
        isPrimary && source && !isPierce && !consequence.damageSource
          ? computeDamagePacket({
              rawDamage: consequence.baseDamageForModifiers ?? originalDamage,
              damageEffect: source,
              usersEffects: battle.usersEffects,
              attackerId,
              defenderId: targetId,
              preBattleGearModifiers: battle.extraState.preBattleGearModifiers ?? {},
              battleRound: battle.round,
              modifierLists: buildDamagePacketModifierLists(
                battle.usersEffects,
                attackerId,
                targetId,
                eligibilityById,
              ),
              ignoreDamageReduction: true,
            }).damage *
            (1 - parryFraction)
          : cappedDamage;
      packets.push({
        targetId,
        attackerId,
        damage,
        deferredDamage: cappedDamage,
        creditDamage: !isReturnDamage && !consequence.damageSource,
        creditEnmity: key !== "recoil",
        applyRemaining: (fraction) => {
          // Preserve the source's existing DR and bypass rules; mitigation runs only once.
          const remaining = cappedDamage * fraction;
          if (isReturnDamage) {
            // Return damage must pass through the recipient's absorb/shield handling,
            // without granting damage-dealt credit or sharing the original target's defenses.
            const returned: Consequence = {
              userId: attackerId,
              targetId,
              damage: remaining,
              damageSource: key,
              diffuseSourceEffectId: source?.id,
              types: [key],
            };
            consequences.set(`diffuse-${effectId}-${key}`, returned);
            consequence[key] = undefined;
            affected.add(returned);
            return;
          }
          consequence[key] = remaining;
          if (key === "damage") {
            consequence.preDiffuseDamage = originalDamage;
            consequence.preShieldDamage = remaining;
            // Damage-derived leech uses the immediate hit. Absorb is resolved after this pass.
            if (consequence.lifesteal_hp !== undefined) {
              consequence.lifesteal_hp *= remaining / originalDamage;
            }
          }
          affected.add(consequence);
          consequence.diffuseSourceEffectId = source?.id;
        },
      });
    }
  }
  deferDiffuseDamage(packets, effects, users, battle.round, actionEffects);
  for (const c of affected) {
    c.diffuseImmediateDamage = HP_DAMAGE_KEYS.reduce(
      (sum, key) => sum + (c[key] ?? 0),
      0,
    );
  }
};

/** Resolve one raw damage packet through ordered modifiers, seals and damage floors. */
export const computeDamagePacket = (
  ctx: DamagePacketComputeContext,
): { damage: number } => {
  const {
    damageEffect,
    usersEffects,
    attackerId,
    defenderId,
    preBattleGearModifiers,
    battleRound,
  } = ctx;
  const originalModifierLists =
    ctx.modifierLists ??
    buildDamagePacketModifierLists(
      usersEffects,
      attackerId,
      defenderId,
      buildDamageModifierEligibilityById(usersEffects, battleRound),
    );
  const sealEffects = ctx.sealEffects ?? getActiveSealEffects(usersEffects);
  const modifierLists = { ...originalModifierLists };
  if (ctx.ignoreDamageReduction) {
    modifierLists.stage1PreBattleDrEffects = [];
    modifierLists.inCombatDrEffects = [];
    modifierLists.staticDrEffects = [];
    modifierLists.bloodlineDrEffects = [];
  }
  const attackerGear =
    preBattleGearModifiers[attackerId] ?? emptyPreBattleGearModifiers();
  const defenderGear =
    preBattleGearModifiers[defenderId] ?? emptyPreBattleGearModifiers();

  const elementalPoints = (effects: UserEffect[], reduction = false) =>
    effects.reduce((sum, effect) => {
      const { power } = getPower(effect);
      return (
        sum +
        (reduction ? Math.abs(power) : power) * getEfficiencyRatio(damageEffect, effect)
      );
    }, 0);
  let damage = ctx.rawDamage;

  const applyPercentageIncreases = (effects: UserEffect[]) => {
    for (const effect of effects) {
      const ratio = getEfficiencyRatio(damageEffect, effect);
      if (ratio === 0) continue;
      const { power } = getPower(effect);
      damage *= 1 + (power / 100) * ratio;
    }
  };
  const applyPercentageReductions = (effects: UserEffect[]) => {
    for (const effect of effects) {
      const ratio = getEfficiencyRatio(damageEffect, effect);
      if (ratio === 0) continue;
      const { power } = getPower(effect);
      damage = applyPercentageDrMultiplier(damage, (Math.abs(power) / 100) * ratio);
    }
  };

  applyPercentageIncreases(modifierLists.stage1PreBattleIncreases);

  const incPoints =
    OUT_OF_COMBAT_BASE_DAMAGE_INCREASE +
    attackerGear.incDamageGivenFromGear +
    defenderGear.incDamageTakenFromGear +
    elementalPoints(modifierLists.elementalGearIncreases);
  damage *= 1 + incPoints / 100;

  applyPercentageIncreases(modifierLists.inBattleIncreases);

  const baseDamageAfterBoosts = damage;

  const systemDr = OUT_OF_COMBAT_BASE_DAMAGE_REDUCTION;
  const drPoints =
    systemDr +
    (ctx.ignoreDamageReduction
      ? 0
      : defenderGear.drTakenFromGear +
        attackerGear.drGivenFromGear +
        elementalPoints(modifierLists.elementalGearReductions, true));
  damage = applyPercentageDrMultiplier(damage, drPoints / 100);

  applyPercentageReductions(modifierLists.stage1PreBattleDrEffects);
  applyPercentageReductions(modifierLists.inCombatDrEffects);

  const baseDamageAfterSystemDr = applyPercentageDrMultiplier(
    baseDamageAfterBoosts,
    systemDr / 100,
  );
  const minDamage = baseDamageAfterSystemDr * (1 - DMG_REDUCTION_CAP);
  damage = Math.max(damage, minDamage);

  let totalStaticIncrease = 0;
  for (const effect of modifierLists.staticIncEffects) {
    if (sealCheck(effect, sealEffects)) continue;
    const ratio = getEfficiencyRatio(damageEffect, effect);
    if (ratio === 0) continue;
    const { power } = getPower(effect);
    if (!allowBloodlineDamageModifier(damageEffect, effect, power)) continue;
    totalStaticIncrease += power * ratio;
  }
  damage += totalStaticIncrease;

  let totalStaticReduction = 0;
  for (const effect of modifierLists.staticDrEffects) {
    if (sealCheck(effect, sealEffects)) continue;
    const ratio = getEfficiencyRatio(damageEffect, effect);
    if (ratio === 0) continue;
    const power = getSignedDrModifierPower(effect);
    if (!allowBloodlineDamageModifier(damageEffect, effect, power)) continue;
    totalStaticReduction += Math.abs(power) * ratio;
  }
  damage = Math.max(minDamage, damage - totalStaticReduction);

  const keystoneIncPoints =
    attackerGear.incDamageGivenFromKeystone +
    defenderGear.incDamageTakenFromKeystone +
    elementalPoints(modifierLists.elementalKeystoneIncreases);
  damage *= 1 + keystoneIncPoints / 100;

  const keystoneDrPoints =
    defenderGear.drTakenFromKeystone +
    attackerGear.drGivenFromKeystone +
    elementalPoints(modifierLists.elementalKeystoneReductions, true);
  if (!ctx.ignoreDamageReduction) {
    damage = applyPercentageDrMultiplier(damage, keystoneDrPoints / 100);
  }
  damage = Math.max(minDamage, damage);

  for (const effect of modifierLists.bloodlineIncreases) {
    if (sealCheck(effect, sealEffects)) continue;
    const ratio = getEfficiencyRatio(damageEffect, effect);
    if (ratio === 0) continue;
    const { power } = getPower(effect);
    if (!allowBloodlineDamageModifier(damageEffect, effect, power)) continue;
    damage *= 1 + (power / 100) * ratio;
  }

  for (const effect of modifierLists.bloodlineDrEffects) {
    if (sealCheck(effect, sealEffects)) continue;
    const ratio = getEfficiencyRatio(damageEffect, effect);
    if (ratio === 0) continue;
    const power = getSignedDrModifierPower(effect);
    if (!allowBloodlineDamageModifier(damageEffect, effect, power)) continue;
    damage = applyPercentageDrMultiplier(damage, (Math.abs(power) / 100) * ratio);
  }

  return { damage: Math.max(minDamage, damage) };
};

/**
 * Update damage consequences in place using the caller's seal and eligibility snapshots.
 * Reuse modifier lists per attacker/defender pair within this processing pass.
 */
export const applyDamageModifierPipelineToConsequences = ({
  consequences,
  usersEffects,
  extraState,
  battleRound,
  sealEffects,
  eligibilityById,
  curseEffects,
}: {
  consequences: Map<string, Consequence>;
  usersEffects: UserEffect[];
  extraState: ExtraState;
  battleRound: number;
  sealEffects: UserEffect[];
  eligibilityById: Map<string, DamageModifierEligibility>;
  curseEffects?: UserEffect[];
}) => {
  const preBattleGearModifiers = extraState.preBattleGearModifiers ?? {};
  const effectById = new Map(usersEffects.map((e) => [e.id, e]));
  const modifierListsByPair = new Map<string, DamagePacketModifierLists>();
  const curseBonusByUser = new Map<string, number>();

  for (const [effectId, consequence] of consequences) {
    const damageKey =
      consequence.damage !== undefined
        ? "damage"
        : consequence.residual !== undefined
          ? "residual"
          : undefined;
    if (!damageKey) continue;

    const dmgEffect = effectById.get(effectId);
    if (!dmgEffect) continue;

    const pairKey = `${consequence.userId}\0${consequence.targetId}`;
    let modifierLists = modifierListsByPair.get(pairKey);
    if (!modifierLists) {
      modifierLists = buildDamagePacketModifierLists(
        usersEffects,
        consequence.userId,
        consequence.targetId,
        eligibilityById,
      );
      modifierListsByPair.set(pairKey, modifierLists);
    }

    let curseBonus = curseBonusByUser.get(consequence.userId);
    if (curseBonus === undefined) {
      curseBonus = getCurseDamageMultiplier(
        curseEffects ?? [],
        consequence.userId,
        usersEffects,
      );
      curseBonusByUser.set(consequence.userId, curseBonus);
    }
    const rawDamage = consequence[damageKey] ?? 0;
    const { damage } = computeDamagePacket({
      rawDamage: rawDamage * curseBonus,
      damageEffect: dmgEffect,
      usersEffects,
      attackerId: consequence.userId,
      defenderId: consequence.targetId,
      preBattleGearModifiers,
      battleRound,
      modifierLists,
      sealEffects,
    });

    consequence[damageKey] = damage;
    // Diffuse recomputes pre-DR lethality from the same boosted base.
    consequence.baseDamageForModifiers =
      (consequence.baseDamageForModifiers ?? rawDamage) * curseBonus;
  }
};
