import { nanoid } from "nanoid";
import {
  ID_ANIMATION_SMOKE,
  PARRY_MAX_PERCENTAGE,
  POST_DAMAGE_MODIFIER_TYPES,
  type PoolType,
  SAGE_MODE_ACTIVATION_JUTSU_ID,
  SAGE_MODE_DISABLED_BATTLES,
  SAGE_MODE_MAX_LEVEL,
  SHIELD_MAX_HEALTH,
} from "@/drizzle/constants";
import type { SageMode } from "@/drizzle/schema";
import {
  getActiveSageLevel,
  getSageDailyCap,
  getSageModeActivationCost,
} from "@/libs/sageMode";
import { nonStackingTimedStatEffect } from "@/libs/timedBuffs";
import type { ShieldTagType, ZodAllTags } from "@/validators/combat";
import { ShieldTag, VisualTag } from "@/validators/combat";
import { creditConsequenceEnmity, creditDamageEnmity } from "./aggro";
import {
  ABSORB_CAP_RATIO,
  BARRIER_DAMAGE_TAG_TYPES,
  DAMAGE_LEECH_CAP_RATIO,
  damageModifierTypes,
  dmgConfig as defaultDmgConfig,
  HP_DAMAGE_KEYS,
  REFLECT_CAP_RATIO,
} from "./constants";
import {
  accumulateCurseConsequence,
  accumulateCurseDamage,
  getCurseDamageMultiplier,
} from "./curse";
import {
  applyDamageModifierPipelineToConsequences,
  applyDiffuseToConsequences,
  buildDamageModifierEligibilityById,
} from "./damagePipeline";
import { repayDiffuseDamage } from "./diffuse";
import { refreshMasteries, resetMasteriesToBase } from "./mastery";
import { areBattleAllies } from "./participants";
import {
  absorb,
  adjustAggro,
  adjustDamageGiven,
  adjustDamageTaken,
  afterburn,
  applyFinalStandDamage,
  applyPreventTag,
  calcDmgModifier,
  cleanse,
  clear,
  clone,
  copy,
  curse,
  damageBarrier,
  damageUser,
  decreaseCooldown,
  decreaseDamageGiven,
  decreaseDamageTaken,
  decreaseHealGiven,
  decreaseMastery,
  decreaseMaxPools,
  decreasepoolcost,
  decreaseStats,
  drain,
  elementalseal,
  finalStand,
  flee,
  heal,
  immunity,
  increaseCooldown,
  increaseDamageGiven,
  increaseDamageTaken,
  increaseHealGiven,
  increaseMastery,
  increaseMaxPools,
  increasepoolcost,
  increaseRange,
  increaseStats,
  injectjutsus,
  invertPower,
  isPreventEffect,
  lifesteal,
  mirror,
  move,
  onehitkill,
  parry,
  poison,
  potency,
  realizePassiveEffect,
  recoil,
  redirection,
  reflect,
  registerShieldConversion,
  rob,
  seal,
  shield,
  stealth,
  stun,
  summon,
  temporalShift,
  updateStatUsage,
  vamp,
  weakness,
  wound,
} from "./tags";
import type {
  ActionEffect,
  BattleEffect,
  BattleUserState,
  CombatAction,
  CompleteBattle,
  Consequence,
  EnmityDamageKey,
  GroundEffect,
  ShieldConversionsByUser,
  UserEffect,
} from "./types";
import {
  calcApplyRatio,
  calcEffectRoundInfo,
  canStackEffect,
  collapseConsequences,
  creditDamageDealt,
  findBarrier,
  findUser,
  getActiveSealEffects,
  getBattleGrid,
  getEffectiveMaxPool,
  getEffectStackKey,
  getItem,
  isEffectActive,
  isEffectEnabled,
  recordUsedTag,
  resolveDamageCreditUser,
  sealCheck,
  sortEffects,
  syncPoolAdjustments,
  wearBattleItem,
} from "./util";

/**
 * Minimal user type for checkFriendlyFire
 */
type FriendlyFireUser = Pick<BattleUserState, "userId" | "direction">;

/**
 * Check whether to apply given effect to a user, based on friendly fire settings.
 * Uses the 'direction' property to determine teams - users on the same side (left/right)
 * are allies, users on opposite sides are enemies. This works for all battle types
 * because direction is set based on userIds (attackers=left) vs targetIds (defenders=right).
 */
export const checkFriendlyFire = (
  effect: BattleEffect,
  target: FriendlyFireUser,
  usersState: FriendlyFireUser[],
) => {
  // Find the creator of the effect
  const creator = usersState.find((u) => u.userId === effect.creatorId);
  if (!creator) return false;

  // Determine if target is friendly based on direction (same side = allies)
  const isFriendly = areBattleAllies(creator, target);

  // Check if effect should be applied based on friendly fire settings
  if (!effect.friendlyFire || effect.friendlyFire === "ALL") {
    return true; // Allow all
  }
  if (effect.friendlyFire === "FRIENDLY") {
    return isFriendly; // Only apply to friends (same direction/team)
  }
  if (effect.friendlyFire === "ENEMIES") {
    return !isFriendly; // Only apply to enemies (different direction/team)
  }
  return false;
};

/**
 * Create a visual effect with a specified appearAnimation and optional SFX
 */
const getVisualOrSound = (
  longitude: number,
  latitude: number,
  animation: string | undefined,
  sfx: string | undefined,
  round: number,
  animationScale = 1,
): GroundEffect => {
  return {
    ...VisualTag.parse({
      type: "visual",
      rounds: 0,
      description: "N/A",
      appearAnimation: animation,
      animationScale,
      appearSfx: sfx ?? "",
      createdAt: Date.now(),
    }),
    actionId: "visual",
    id: nanoid(),
    createdRound: round,
    creatorId: nanoid(),
    level: 0,
    barrierAbsorb: 0,
    isNew: true,
    castThisRound: true,
    longitude,
    latitude,
  };
};

/**
 * Base shape of the temporary shield granted by the consume tag, parsed once at import.
 *
 * Going through ShieldTag keeps the shield contract in a single place: any field later
 * added to ShieldTag (with a default) flows through here automatically instead of
 * silently missing this call site. Everything the parse validates is static - rounds,
 * power and health are overridden per cast below - so the parse never runs on the
 * per-action combat path.
 */
const CONVERSION_SHIELD_BASE = ShieldTag.parse({
  type: "shield",
  description: "Temporary shield from damage conversion",
  rounds: 1,
  power: 1,
  powerPerLevel: 0,
  direction: "offence",
  calculation: "static",
  health: 1,
  target: "SELF",
});

/**
 * Build the temporary shield effect granted by Consume or Siphon.
 *
 * shieldHp and rounds are clamped to the bounds ShieldTag accepts, so a very large
 * consumed hit can never produce a shield outside the schema's range.
 *
 * isNew is intentionally false: shield()'s cast-round branch rolls a
 * `Math.random() < power / 100` primary check to decide whether the shield lands, but
 * here `power` is the raw shield HP (not a 0-100 probability). Marking the effect as
 * not-new skips that roll so the conversion shield is applied deterministically.
 */
const createConversionShieldEffect = (
  user: BattleUserState,
  shieldHp: number,
  rounds: number,
  round: number,
): UserEffect => {
  const cappedHp = Math.min(shieldHp, SHIELD_MAX_HEALTH);
  return {
    ...CONVERSION_SHIELD_BASE,
    rounds: Math.min(rounds, 100),
    power: cappedHp,
    health: cappedHp,
    id: nanoid(),
    creatorId: user.userId,
    targetId: user.userId,
    level: 0,
    isNew: false,
    castThisRound: true,
    createdRound: round,
    longitude: user.longitude,
    latitude: user.latitude,
    barrierAbsorb: 0,
    actionId: `consume-${user.userId}-${round}`,
    targetType: "user",
  };
};

/**
 * Remove expired battlefield entities in place and return their history effects.
 * Preserve this request's visuals and unapplied instant effects for action processing.
 */
export const expireGroundEffects = (battle: CompleteBattle, actionRounds: number[]) => {
  const actionEffects: ActionEffect[] = [];
  const visuals: GroundEffect[] = [];
  battle.groundEffects = battle.groundEffects.filter((effect) => {
    if (effect.rounds === undefined || effect.rounds > 0) return true;
    if (effect.type === "visual") return actionRounds.includes(effect.createdRound);
    // A newly authored instant effect still needs its first application.
    if (effect.isNew) return true;
    const info =
      effect.type === "clone"
        ? clone(battle.usersState, effect, battle.extraState)
        : effect.type === "summon"
          ? summon(battle.usersState, effect, battle.usersEffects, battle)
          : undefined;
    if (info) actionEffects.push(info);
    if (effect.disappearAnimation || effect.disappearSfx)
      visuals.push(
        getVisualOrSound(
          effect.longitude,
          effect.latitude,
          effect.disappearAnimation,
          effect.disappearSfx,
          battle.round,
          effect.animationScale,
        ),
      );
    return false;
  });
  battle.groundEffects.push(...visuals);
  return actionEffects;
};

/**
 * Resolve one action against the battle and return the next state. The phase order
 * decides combat outcomes:
 * 1. Ground effects become user effects on occupied tiles.
 * 2. Mirror and copy add the effects they transfer.
 * 3. Non-damage effects resolve; instant kills settle against Curse.
 * 4. Consume and Siphon register, then Diffuse debts are repaid.
 * 5. The damage pipeline rewrites packets; modifier tags log and carry forward.
 * 6. Pierce, Parry and post-damage effects read the mitigated packets.
 * 7. Parry returns and Diffuse split the packets, before deferred Absorb and heal adjustments.
 * 8. Consequences are mitigated per source, collapsed per target and applied to pools.
 * 9. Conversion shields are granted; pools and masteries refresh for the next action.
 *
 * @param battle - Battle to apply effects to
 * @param actorId - ID of the actor
 * @param action - Action to apply effects to
 */
export const applyEffects = (
  battle: CompleteBattle,
  actorId: string,
  action?: CombatAction,
) => {
  // Destructure
  const { usersState, usersEffects, round } = battle;
  const actor = usersState.find((u) => u.userId === actorId);

  // Things we wish to return
  const newUsersState = structuredClone(usersState);
  // Mastery tags deliberately work differently from increasestat/decreasestat. Stat tags
  // are applied to `usersState`, the transient pre-round copy, so they vanish when the round
  // ends and never need undoing. Masteries must persist into `newUsersState`, because
  // availableUserActions reads the saved state to decide which gated jutsu and items are
  // usable next round. Persisting them means a buff would compound every round, so reset to
  // the remembered unbuffed values here and let the still-active tags reapply below.
  newUsersState.forEach(resetMasteriesToBase);
  const newGroundEffects: GroundEffect[] = [];
  const newUsersEffects: UserEffect[] = [];
  const actionEffects: ActionEffect[] = [];

  applyGroundEffects({
    battle,
    actor,
    newUsersState,
    newUsersEffects,
    newGroundEffects,
    actionEffects,
  });

  // Book-keeping for damage and heal effects
  const consequences = new Map<string, Consequence>();

  // Remember effects applied to different users, so that we only apply effects once
  const appliedEffects = new Set<string>();
  // Only authored instant tags may convert after their duration reaches zero.
  // Clear revokes these exceptions when it cancels the corresponding effects.
  const instantConsumeIds = new Set(
    usersEffects
      .filter((e) => e.type === "consume" && e.rounds === 0 && e.isNew)
      .map((e) => e.id),
  );
  const shieldConversionsByUser: ShieldConversionsByUser = new Map();
  const resolution: EffectResolution = {
    consequences,
    newUsersState,
    newUsersEffects,
    newGroundEffects,
    actionEffects,
    appliedEffects,
    battle,
    actorId,
    action,
    shieldConversionsByUser,
    instantConsumeIds,
  };
  const resolve = (effect: UserEffect) => applySingleEffect(resolution, effect);

  // Apply mirror & copy tags first, so that these get added to usersEffects
  usersEffects.filter((e) => e.type === "mirror" || e.type === "copy").forEach(resolve);

  // Separate non-damage-modifier effects from damage modifier effects
  // Note: pierce is explicitly excluded here to maintain the sortEffects ordering
  // where damage modifiers run BEFORE pierce (pierce bypasses damage reduction)
  // Note: all POST_DAMAGE_MODIFIER_TYPES are excluded here and resolved in their
  // own passes below
  // Note: increaseheal/decreaseheal are excluded because they modify lifesteal_hp/absorb_hp/vampRatio
  // which are set by post-damage modifiers
  const nonDamageModifierEffects = usersEffects
    .filter((e) => e.type !== "mirror" && e.type !== "copy")
    .filter((e) => !damageModifierTypes.includes(e.type))
    .filter((e) => !POST_DAMAGE_MODIFIER_TYPES.includes(e.type))
    .filter((e) => e.type !== "pierce")
    .filter((e) => e.type !== "increaseheal" && e.type !== "decreaseheal");

  // Separate pierce effects (must run AFTER damage modifiers, BEFORE post-damage modifiers)
  const pierceEffects = usersEffects.filter((e) => e.type === "pierce");

  // Separate post-damage-modifier effects: POST_DAMAGE_MODIFIER_TYPES except consume
  // and siphon, which register earlier as shield conversions.
  // These depend on post-mitigated damage values, so they must run after pierce
  const postDamageModifierEffects = usersEffects.filter(
    (e) =>
      POST_DAMAGE_MODIFIER_TYPES.includes(e.type) &&
      e.type !== "consume" &&
      e.type !== "siphon",
  );

  // Separate heal adjustment effects (increaseheal/decreaseheal)
  // These modify lifesteal_hp/absorb_hp/vampRatio so they must run AFTER post-damage modifiers set those values
  const healAdjustmentEffects = usersEffects.filter(
    (e) => e.type === "increaseheal" || e.type === "decreaseheal",
  );

  // Apply non-damage-modifier effects first
  nonDamageModifierEffects.sort(sortEffects).forEach(resolve);

  // Instant kills precede Curse activation and seals; account only their resolved HP loss.
  for (const [id, consequence] of consequences) {
    if (consequence.instantKillDamage === undefined) continue;
    accumulateCurseDamage(
      newUsersEffects,
      newUsersState,
      consequence.userId,
      consequence.targetId,
      consequence.instantKillDamage,
      round,
    );
    consequences.delete(id);
  }

  // Register conversions after activation, Clear and prevention, before damage.
  usersEffects
    .filter(
      (e) =>
        (e.type === "consume" || e.type === "siphon") &&
        (isEffectActive(e) || instantConsumeIds.has(e.id)),
    )
    .sort(sortEffects)
    .forEach(resolve);

  // Resolve activation and prevention before Final Stand can protect debt repayment.
  repayDiffuseDamage(
    newUsersState,
    usersEffects,
    actorId,
    round,
    actionEffects,
    (userId, targetId, damage, healthLost, creditUserId) => {
      accumulateCurseDamage(
        newUsersEffects,
        newUsersState,
        userId,
        targetId,
        healthLost,
        round,
        creditUserId,
      );
      if (userId !== targetId) {
        accumulateShieldConversion(shieldConversionsByUser, userId, damage, "consume");
        accumulateShieldConversion(
          shieldConversionsByUser,
          targetId,
          healthLost,
          "siphon",
        );
      }
    },
  );

  const sealEffects = getActiveSealEffects(usersEffects);
  const diffuseEffects = usersEffects.filter(
    (e) =>
      e.type === "diffuse" &&
      e.targetType === "user" &&
      isEffectActive(e) &&
      !sealCheck(e, sealEffects),
  );
  const diffuseTargets = new Set(diffuseEffects.map((e) => e.targetId));
  const usersStateById = new Map(newUsersState.map((u) => [u.userId, u]));
  const damageModifierEligibilityById = buildDamageModifierEligibilityById(
    usersEffects,
    battle.round,
    usersStateById,
  );

  // Consolidated damage pipeline: multiplicative inc buckets, shared sequential % DR, static DR, BL inc
  applyDamageModifierPipelineToConsequences({
    consequences,
    usersEffects,
    extraState: battle.extraState,
    battleRound: battle.round,
    sealEffects,
    eligibilityById: damageModifierEligibilityById,
    curseEffects: newUsersEffects,
  });

  const modifierInfoConsequences = new Map<string, Consequence>();
  usersEffects
    .filter((e) => damageModifierTypes.includes(e.type))
    .filter((e) => !sealCheck(e, sealEffects))
    .sort(sortEffects)
    .forEach((effect) => {
      const targetUser = usersStateById.get(effect.targetId);
      if (!targetUser) return;

      const eligibility = damageModifierEligibilityById.get(effect.id);
      if (eligibility?.preventInfo) {
        actionEffects.push(eligibility.preventInfo);
        return;
      }

      // Record the applied damage-modifier tag for the tag_usage_win tracker. These four tags
      // bypass applySingleEffect's resolution branch (they run only in this dedicated loop), so
      // mirror that credit here: past the preventInfo guard the modifier is applied (not
      // blocked) — the same "applied, not resisted" bar the resolution branch uses. Deliberately
      // NOT gated on `info` below: that is only the cast-round display text (isNew && rounds), so
      // it would miss every later active round and any rounds:0 tag. Caster is effect.creatorId
      // (its controller for a summon/clone), matching damage_dealt attribution.
      const modifierCaster = usersStateById.get(effect.creatorId);
      if (modifierCaster) recordUsedTag(newUsersState, modifierCaster, effect.type);

      let info: ActionEffect | undefined;
      switch (effect.type) {
        case "increasedamagegiven":
          info = adjustDamageGiven(
            effect,
            usersEffects,
            modifierInfoConsequences,
            targetUser,
          );
          break;
        case "decreasedamagegiven":
          info = adjustDamageGiven(
            invertPower(effect),
            usersEffects,
            modifierInfoConsequences,
            targetUser,
          );
          break;
        case "increasedamagetaken":
          info = adjustDamageTaken(
            effect,
            usersEffects,
            modifierInfoConsequences,
            targetUser,
          );
          break;
        case "decreasedamagetaken":
          info = adjustDamageTaken(
            invertPower(effect),
            usersEffects,
            modifierInfoConsequences,
            targetUser,
          );
          break;
        default:
          break;
      }
      if (info) actionEffects.push(info);
    });

  // Damage modifier tags are excluded from applySingleEffect; carry them forward so they
  // persist in the outgoing snapshot (pierce / post-damage tags have dedicated passes later).
  const presentEffectIds = new Set(newUsersEffects.map((e) => e.id));
  for (const e of usersEffects) {
    if (
      !damageModifierTypes.includes(e.type) ||
      presentEffectIds.has(e.id) ||
      !(isEffectActive(e) && !e.fromGround)
    ) {
      continue;
    }
    e.isNew = false;
    newUsersEffects.push(e);
    presentEffectIds.add(e.id);
  }

  // Apply pierce effects AFTER damage modifiers but BEFORE post-damage modifiers
  // Pierce adds damage that should be included in post-damage calculations (lifesteal, etc.)
  pierceEffects.sort(sortEffects).forEach(resolve);

  // Split direct hits before damage-derived effects; delay returns to prevent recursion.
  postDamageModifierEffects
    .filter((e) => e.type === "parry")
    .sort(sortEffects)
    .forEach(resolve);
  const parryReturns = splitParriedDamage(consequences, actionEffects);

  // Apply the remaining post-damage-modifier effects (parry resolved above).
  // These read consequence.damage to calculate their effect, so they must run after pierce
  // to include pierce damage in their calculations
  postDamageModifierEffects.sort(sortEffects).forEach((effect) => {
    if (effect.type === "parry") return;
    // Absorb reads the immediate portion after Diffuse, including secondary damage.
    if (
      effect.type === "absorb" &&
      (parryReturns.length > 0 || diffuseTargets.has(effect.targetId))
    )
      return;
    resolve(effect);
  });

  for (const [id, returned] of parryReturns) consequences.set(id, returned);

  applyDiffuseToConsequences({
    consequences,
    effects: diffuseEffects,
    users: newUsersState,
    battle,
    eligibilityById: damageModifierEligibilityById,
    actionEffects,
  });
  postDamageModifierEffects
    .filter(
      (e) =>
        e.type === "absorb" &&
        (parryReturns.length > 0 || diffuseTargets.has(e.targetId)),
    )
    .forEach(resolve);

  // Apply heal adjustment effects (increaseheal/decreaseheal) AFTER post-damage modifiers
  // These modify lifesteal_hp/absorb_hp/vampRatio values set by lifesteal/absorb/vamp effects
  healAdjustmentEffects.sort(sortEffects).forEach(resolve);

  // Resolve Curse after activation, Clear, and seals; conversion effects resume when it ends.
  const curseHolders = new Set(
    newUsersEffects
      .filter(
        (effect) =>
          effect.type === "curse" &&
          effect.curseState &&
          !effect.curseState.settled &&
          isEffectEnabled(effect, newUsersEffects),
      )
      .map((effect) => effect.targetId),
  );

  // Apply consequences to users
  Array.from(consequences.values())
    // Before collapsing consequences, we process each consequence indicidually
    .map((c) => mitigateConsequence(resolution, shieldConversionsByUser, c))
    .reduce(collapseConsequences, [] as Consequence[])
    .forEach((c) => {
      applyConsequence(resolution, shieldConversionsByUser, curseHolders, c);
    });

  // A newly cast Curse starts collecting on the next action, including within this round.
  for (const effect of newUsersEffects) {
    if (effect.type === "curse" && effect.curseState) effect.curseState.ready = true;
  }

  grantConversionShields(resolution, shieldConversionsByUser);

  syncPoolAdjustments(newUsersState, newUsersEffects);

  // Eligibility for the next action must reflect seals and removals settled by this action.
  // Ground-derived effects apply at the user's current tile but are not persisted as user tags.
  refreshMasteries(newUsersState, [
    ...newUsersEffects,
    ...usersEffects.filter((effect) => effect.fromGround && isEffectActive(effect)),
  ]);

  return {
    newBattle: {
      ...battle,
      usersState: newUsersState,
      usersEffects: newUsersEffects,
      groundEffects: newGroundEffects,
    },
    actionEffects,
  };
};

/** Convert ground effects into user effects on the users standing on their tiles. */
const applyGroundEffects = ({
  battle,
  actor,
  newUsersState,
  newUsersEffects,
  newGroundEffects,
  actionEffects,
}: Pick<
  EffectResolution,
  "battle" | "newUsersState" | "newUsersEffects" | "newGroundEffects" | "actionEffects"
> & { actor: BattleUserState | undefined }) => {
  const { usersEffects, groundEffects, round } = battle;
  let spawnGrid: ReturnType<typeof getBattleGrid> | undefined;
  groundEffects.sort(sortEffects).forEach((e) => {
    // Get the round information for the effect
    const { startRound, curRound } = calcEffectRoundInfo(e, battle);
    e.castThisRound = startRound === curRound;
    // Ignore movement passives because no combat action selected their destination.
    if (e.fromType === "skill" && e.type === "move") return;
    if (
      e.isNew &&
      e.fromType === "skill" &&
      (e.type === "clone" || e.type === "summon")
    ) {
      const creator = newUsersState.find((user) => user.userId === e.creatorId);
      spawnGrid ??= getBattleGrid(1, battle);
      const grid = spawnGrid;
      const origin = grid.getHex({ col: e.longitude, row: e.latitude });
      if (!creator || !origin) return;
      // Innate casts originate on occupied cells; choose the nearest empty destination.
      // Include earlier spawns in this pass when checking occupancy to prevent overlap.
      const destination = grid
        .toArray()
        .filter(
          (target) =>
            !findUser(newUsersState, target.col, target.row) &&
            !findBarrier(groundEffects, target.col, target.row),
        )
        .sort((a, b) => grid.distance(a, origin) - grid.distance(b, origin))[0];
      if (!destination) return;
      e.longitude = destination.col;
      e.latitude = destination.row;
    }
    // Process special effects
    let info: ActionEffect | undefined;
    if (e.type === "move") {
      move(e, usersEffects, newUsersState, newGroundEffects);
    } else {
      // Special handling of clone & summon ground-effects
      if (e.type === "clone") {
        info = clone(newUsersState, e, battle.extraState);
      } else if (e.type === "summon") {
        info = summon(newUsersState, e, newUsersEffects, battle);
      } else if (e.type === "barrier") {
        const user = findUser(newUsersState, e.longitude, e.latitude);
        if (user) e.rounds = 0;
      } else {
        // Information on what was done
        if (e.isNew && e.castThisRound && actor && e.type !== "visual" && e.rounds) {
          const txt = `${actor.username} marked the ground with ${e.type} for the next ${e.rounds} rounds`;
          if (!actionEffects.find((ae) => ae.txt === txt)) {
            actionEffects.push({ txt, color: "blue" });
          }
        }
        // Apply all other ground effects to user
        const user = findUser(newUsersState, e.longitude, e.latitude);
        if (user && e.type !== "visual") {
          if (checkFriendlyFire(e, user, newUsersState)) {
            const hasEffect = usersEffects.some((ue) => ue.id === e.id);
            const isInstant = ["damage", "heal", "pierce"].includes(e.type);
            if (!hasEffect) {
              // NOTE:
              // 1. If the effect is instant, it is applied immediately
              // 2. User effects from Ground effects are not forwarded to the next round
              usersEffects.push({
                ...e,
                rounds: isInstant ? 0 : 1,
                targetId: user.userId,
                createdRound: isInstant ? curRound : curRound - 1,
                fromGround: true,
              } as UserEffect);
            }
          }
        }
        // Forward any damage effects, which should be applied to barriers as well
        if (!user && e.type === "damage") {
          const barrier = findBarrier(groundEffects, e.longitude, e.latitude);
          if (barrier) {
            usersEffects.push({
              ...e,
              targetType: "barrier",
              targetId: barrier.id,
              fromGround: true,
            } as UserEffect);
          }
        }
      }

      // Show once appearing visual/audio
      if ((e.appearAnimation || e.appearSfx) && e.isNew && e.type !== "visual") {
        newGroundEffects.push(
          getVisualOrSound(
            e.longitude,
            e.latitude,
            e.appearAnimation,
            e.appearSfx,
            round,
            e.animationScale,
          ),
        );
      }

      // Process round reduction & tag removal
      if (isEffectActive(e) || e.type === "visual") {
        e.isNew = false;
        newGroundEffects.push(e);
      } else if (e.disappearAnimation || e.disappearSfx) {
        newGroundEffects.push(
          getVisualOrSound(
            e.longitude,
            e.latitude,
            e.disappearAnimation,
            e.disappearSfx,
            round,
            e.animationScale,
          ),
        );
      }
    }

    // Add info to action effects if it exists
    if (info) actionEffects.push(info);
  });
};

/** Split parried direct hits and return the damage owed back to their attackers. */
const splitParriedDamage = (
  consequences: Map<string, Consequence>,
  actionEffects: ActionEffect[],
) => {
  const parryReturns: [string, Consequence][] = [];
  for (const [id, consequence] of consequences) {
    if (!consequence.damage || !consequence.parryPercentage) continue;
    const fraction = Math.min(PARRY_MAX_PERCENTAGE, consequence.parryPercentage) / 100;
    const returned = consequence.damage * fraction;
    consequence.damage -= returned;
    parryReturns.push([
      `parry-${id}`,
      {
        userId: consequence.targetId,
        targetId: consequence.userId,
        damage: returned,
        damageSource: "parry",
        diffuseSourceEffectId: id,
        types: ["parry"],
      },
    ]);
    actionEffects.push({
      txt: `Parry redirects ${returned.toFixed(2)} damage to the attacker`,
      color: "red",
    });
  }
  return parryReturns;
};

/** Allocate conversion credit before caster hits collapse; shields are granted after the generating action resolves. */
const accumulateShieldConversion = (
  shieldConversionsByUser: ShieldConversionsByUser,
  userId: string,
  damage: number,
  type: "consume" | "siphon",
) => {
  const conversion = shieldConversionsByUser.get(userId);
  if (!conversion || damage <= 0) return;
  conversion.shields.forEach((shield) => {
    if (shield.type === type) {
      shield.hp += damage * (shield.ratio / Math.max(1, conversion.ratio));
    }
  });
};

/** Credit enemy-caused HP loss after mitigation and Final Stand, before healing; recoil and self-damage do not count. */
const accumulateSiphonShield = (
  shieldConversionsByUser: ShieldConversionsByUser,
  consequence: Consequence,
  key: EnmityDamageKey,
  target: BattleUserState,
) => {
  if (
    consequence.damageSource === "recoil" ||
    !shieldConversionsByUser
      .get(target.userId)
      ?.shields.some((shield) => shield.type === "siphon")
  )
    return;
  let remaining = Math.min(
    Math.max(0, target.curHealth),
    Math.max(0, consequence[key] ?? 0),
  );
  let incomingDamage = 0;
  // Source attribution survives target-level collapse, including mixed self/enemy hits.
  for (const source of consequence.enmitySources ?? [consequence]) {
    const healthLost = Math.min(remaining, Math.max(0, source[key] ?? 0));
    remaining -= healthLost;
    if (source.userId !== target.userId) incomingDamage += healthLost;
  }
  accumulateShieldConversion(
    shieldConversionsByUser,
    target.userId,
    incomingDamage,
    "siphon",
  );
};

/** Absorb one uncollapsed consequence with shields, Final Stand and conversion credit. */
const mitigateConsequence = (
  { newUsersState, newUsersEffects, actionEffects, battle }: EffectResolution,
  shieldConversionsByUser: ShieldConversionsByUser,
  c: Consequence,
) => {
  const { usersEffects } = battle;
  // State
  const user = newUsersState.find((u) => u.userId === c.userId);
  const target = newUsersState.find((u) => u.userId === c.targetId);
  const targetShields = newUsersEffects.filter(
    (e) =>
      e.type === "shield" &&
      e.targetId === c.targetId &&
      e.power > 0 &&
      isEffectEnabled(e, usersEffects),
  ) as ShieldTagType[];
  /** Convenience method for reducing shields before applying damage */
  const calcAdjustedDamage = (
    target: BattleUserState,
    originalDamage: number,
    effectTypes?: string[],
  ) => {
    // For negative changes, first reduce shields
    let remainingDamage = Math.abs(originalDamage);
    // Bypass shield absorption for pierce, reflect, and wound effects
    if (
      !effectTypes?.includes("pierce") &&
      !effectTypes?.includes("reflect") &&
      !effectTypes?.includes("wound")
    ) {
      targetShields.forEach((shield) => {
        if (remainingDamage > 0 && shield.power && shield.power > 0) {
          const absorbed = Math.min(remainingDamage, shield.power);
          shield.power -= absorbed;
          remainingDamage -= absorbed;
          if (shield.power > 0) {
            actionEffects.push({
              txt: `${target.username}'s shield absorbs ${absorbed.toFixed(2)} damage. ${shield.power.toFixed(2)} remaining.`,
              color: "red",
            });
          } else {
            actionEffects.push({
              txt: `${target.username}'s shield absorbs ${absorbed.toFixed(2)} damage and is destroyed`,
              color: "red",
            });
          }
        }
      });
    } else if (effectTypes?.includes("pierce")) {
      // Pierce effects destroy shields instead of absorbing damage
      targetShields.forEach((shield) => {
        if (shield.power && shield.power > 0) {
          actionEffects.push({
            txt: `${target.username}'s shield was pierced and destroyed!`,
            color: "red",
          });
          shield.power = 0;
          shield.rounds = 0;
        }
      });
    }

    return applyFinalStandDamage(usersEffects, target, remainingDamage, actionEffects);
  };
  // Store pre-shield damage for reflect/lifesteal/absorb calculations
  const preShieldDamage = c.damage ?? 0;

  if (target && user && c.userId !== c.targetId) {
    if (c.damageSource !== "recoil") {
      accumulateShieldConversion(
        shieldConversionsByUser,
        c.userId,
        HP_DAMAGE_KEYS.reduce((sum, key) => sum + Math.max(0, c[key] ?? 0), 0),
        "consume",
      );
    }
  }

  // Adjust damages and reduce shields
  if (target && user) {
    // A Diffuse remainder is ordinary incoming damage, even when its original source bypassed shields.
    const immediateTypes = c.diffuseImmediateDamage !== undefined ? [] : c.types;
    if (c.damage && c.damage > 0) {
      c.damage = calcAdjustedDamage(target, c.damage, immediateTypes);
    }
    if (c.residual && c.residual > 0) {
      c.residual = calcAdjustedDamage(target, c.residual, immediateTypes);
    }
    if (c.wound && c.wound > 0) {
      c.wound = calcAdjustedDamage(target, c.wound, immediateTypes);
    }
    if (c.diffuseImmediateDamage !== undefined) {
      for (const key of ["afterburn", "drain_hp", "poison"] as const) {
        const damage = c[key];
        if (damage && damage > 0)
          c[key] = calcAdjustedDamage(target, damage, immediateTypes);
      }
    }
    if (c.reflect && c.reflect > 0) {
      c.reflect = calcAdjustedDamage(user, c.reflect, c.types);
    }
    if (c.recoil && c.recoil > 0) {
      c.recoil = calcAdjustedDamage(user, c.recoil, c.types);
    }
  }

  // Store pre-shield damage for later use (preserve if already set, e.g. by vamp)
  c.preShieldDamage = c.preShieldDamage ?? preShieldDamage;
  c.diffuseImmediateDamage ??= preShieldDamage;
  c.enmitySources = [
    {
      userId: c.userId,
      damage: c.damage,
      residual: c.residual,
      wound: c.wound,
      afterburn: c.afterburn,
      drain_hp: c.drain_hp,
      poison: c.poison,
    },
  ];
  return c;
};

/** Apply one collapsed consequence to its target's and source's pools. */
const applyConsequence = (
  {
    newUsersState,
    newUsersEffects,
    newGroundEffects,
    actionEffects,
    battle,
  }: EffectResolution,
  shieldConversionsByUser: ShieldConversionsByUser,
  curseHolders: Set<string>,
  c: Consequence,
) => {
  const { usersEffects, round } = battle;
  // Convenience variables & methods
  const user = newUsersState.find((u) => u.userId === c.userId);
  const target = newUsersState.find((u) => u.userId === c.targetId);

  // Pools refill up to the effective max, so max-pool effects (e.g. armor pool
  // bonuses) are not stripped by the first heal, absorb or lifesteal of the fight
  const cap = (u: BattleUserState, pool: PoolType) =>
    getEffectiveMaxPool(u, usersEffects, pool);

  // Apply all the consequences
  if (target && user) {
    // Vamp + lifesteal share one 60%-of-damage budget per consequence. Declared
    // before the damage block because lifesteal is applied later, outside it, and
    // still needs the budget when a shield-reduced damage===0 was dropped in merge.
    const leechBudget = Math.floor(
      (c.preShieldDamage ?? c.damage ?? 0) * DAMAGE_LEECH_CAP_RATIO,
    );
    let leechConsumed = 0;
    // damage_dealt tracker credit goes to the controller when the attacker is a
    // summon/clone, matching creatures_hunted attribution (kills a summon secures
    // already count for the summoner). Summons copy the summoner's direction at
    // spawn, so the opponent predicate is evaluated from the controller too.
    const damageCreditUser = resolveDamageCreditUser(newUsersState, user);
    // Curse, enmity and Siphon read an HP loss before it reaches the pool.
    const recordHpLoss = (key: EnmityDamageKey) => {
      accumulateCurseConsequence(c, key, newUsersEffects, newUsersState, round);
      creditConsequenceEnmity(c, key, newUsersState, usersEffects);
      accumulateSiphonShield(shieldConversionsByUser, c, key, target);
    };
    if (c.damage !== undefined && c.damage >= 0) {
      recordHpLoss("damage");
      target.curHealth -= c.damage;
      target.curHealth = Math.max(0, target.curHealth);
      // Accumulate per-attacker damage dealt to real opponents (non-self, non-summon)
      // for the damage_dealt quest tracker. Direct damage plus DoT/drain (residual,
      // wound, afterburn, drain_hp, poison) each credit via creditDamageDealt below;
      // reflect and recoil hit the attacker's own HP and are intentionally excluded.
      if (!c.damageSource) creditDamageDealt(damageCreditUser, target, c.damage);
      actionEffects.push({
        txt: `${target.username} takes ${c.damage.toFixed(2)} ${c.damageSource ? `${c.damageSource} ` : ""}damage`,
        color: "red",
        types: c.types,
        hp: { userId: target.userId, amount: -c.damage },
      });
      // Vamp: heal the attacker based on the full pre-shield damage dealt (post-boost,
      // pre-shield; matches lifesteal, so a shield doesn't shrink the vamp heal).
      // Intentional: this can trigger on killing blows (no target.curHealth > 0 guard).
      // Fills the shared leech budget first; lifesteal later takes whatever remains.
      const rawVampHeal = c.vampHeal ?? 0;
      if (rawVampHeal > 0 && user.curHealth > 0 && !curseHolders.has(user.userId)) {
        const vampHeal = Math.min(Math.floor(rawVampHeal), leechBudget - leechConsumed);
        if (vampHeal > 0) {
          leechConsumed += vampHeal;
          user.curHealth = Math.min(cap(user, "Health"), user.curHealth + vampHeal);
          actionEffects.push({
            txt: `${user.username} vamps ${vampHeal} damage as health`,
            color: "green",
            hp: { userId: user.userId, amount: vampHeal },
          });
        }
      }
      wearArmor(battle, target);
    }
    for (const key of ["residual", "wound"] as const) {
      const amount = c[key];
      if (amount === undefined || amount < 0) continue;
      recordHpLoss(key);
      target.curHealth -= amount;
      target.curHealth = Math.max(0, target.curHealth);
      creditDamageDealt(damageCreditUser, target, amount);
      actionEffects.push({
        txt: `${target.username} takes ${amount.toFixed(2)} ${key} damage`,
        color: "red",
        types: c.types,
        hp: { userId: target.userId, amount: -amount },
      });
      wearArmor(battle, target);
    }
    if (c.heal_hp !== undefined && c.heal_hp >= 0 && target.curHealth > 0) {
      target.curHealth += c.heal_hp;
      target.curHealth = Math.min(cap(target, "Health"), target.curHealth);
      actionEffects.push({
        txt: `${target.username} heals ${c.heal_hp} HP`,
        color: "green",
        hp: { userId: target.userId, amount: c.heal_hp },
      });
    }
    if (c.heal_sp !== undefined && c.heal_sp >= 0) {
      target.curStamina += c.heal_sp;
      target.curStamina = Math.min(cap(target, "Stamina"), target.curStamina);
      actionEffects.push({
        txt: `${target.username} heals ${c.heal_sp} SP`,
        color: "green",
      });
    }
    if (c.heal_cp !== undefined && c.heal_cp >= 0) {
      target.curChakra += c.heal_cp;
      target.curChakra = Math.min(cap(target, "Chakra"), target.curChakra);
      actionEffects.push({
        txt: `${target.username} heals ${c.heal_cp} CP`,
        color: "green",
      });
    }
    if (c.reflect !== undefined && c.reflect >= 0) {
      // Reflect caps against the source hit before Diffuse and shields; leech uses the remainder.
      const preShieldDamage = c.preDiffuseDamage ?? c.preShieldDamage ?? 0;
      const maxReflect = preShieldDamage * REFLECT_CAP_RATIO;
      const finalReflect = Math.min(c.reflect, maxReflect);
      accumulateCurseDamage(
        newUsersEffects,
        newUsersState,
        target.userId,
        user.userId,
        Math.min(user.curHealth, finalReflect),
        round,
      );
      creditDamageEnmity(
        target,
        user,
        Math.min(user.curHealth, finalReflect),
        usersEffects,
      );
      // Reflect belongs to the defender and converts only its capped return.
      if (target.userId !== user.userId) {
        accumulateShieldConversion(
          shieldConversionsByUser,
          target.userId,
          finalReflect,
          "consume",
        );
        accumulateShieldConversion(
          shieldConversionsByUser,
          user.userId,
          Math.min(user.curHealth, finalReflect),
          "siphon",
        );
      }
      user.curHealth -= finalReflect;
      user.curHealth = Math.max(0, user.curHealth);
      actionEffects.push({
        txt: `${user.username} takes ${finalReflect.toFixed(2)} reflect damage`,
        color: "red",
        hp: { userId: user.userId, amount: -finalReflect },
      });
    }
    if (c.recoil !== undefined && c.recoil >= 0) {
      user.curHealth -= c.recoil;
      user.curHealth = Math.max(0, user.curHealth);
      actionEffects.push({
        txt: `${user.username} takes ${c.recoil.toFixed(2)} recoil damage`,
        color: "red",
        hp: { userId: user.userId, amount: -c.recoil },
      });
    }
    if (c.afterburn !== undefined && c.afterburn >= 0) {
      recordHpLoss("afterburn");
      target.curHealth -= c.afterburn;
      target.curHealth = Math.max(0, target.curHealth);
      creditDamageDealt(damageCreditUser, target, c.afterburn);
      actionEffects.push({
        txt: `${target.username} takes ${c.afterburn.toFixed(2)} afterburn damage`,
        color: "red",
        hp: { userId: target.userId, amount: -c.afterburn },
      });
    }
    // Lifesteal shares the leech budget with vamp: it takes whatever vamp left unused
    // (both cap the combined heal at DAMAGE_LEECH_CAP_RATIO of the pre-shield damage).
    // Still requires the target to have survived the whole tick and the attacker alive.
    if (
      c.lifesteal_hp !== undefined &&
      c.lifesteal_hp >= 0 &&
      !curseHolders.has(user.userId) &&
      target.curHealth > 0 &&
      user.curHealth > 0
    ) {
      const remaining = Math.max(0, leechBudget - leechConsumed);
      const finalLifesteal = Math.min(c.lifesteal_hp, remaining);
      if (finalLifesteal > 0) {
        leechConsumed += finalLifesteal;
        user.curHealth += finalLifesteal;
        user.curHealth = Math.min(cap(user, "Health"), user.curHealth);
        actionEffects.push({
          txt: `${user.username} steals ${finalLifesteal.toFixed(2)} damage as health`,
          color: "green",
          hp: { userId: user.userId, amount: finalLifesteal },
        });
      }
    }
    if (
      c.absorb_hp !== undefined &&
      c.absorb_hp >= 0 &&
      target.curHealth > 0 &&
      !curseHolders.has(target.userId)
    ) {
      // Use pre-shield damage for the absorb cap to avoid shield interference
      const preShieldDamage = c.preShieldDamage ?? 0;
      const maxAbsorb =
        (c.diffuseImmediateDamage ?? preShieldDamage) * ABSORB_CAP_RATIO;
      const absorbAmount = Math.min(c.absorb_hp, maxAbsorb);
      target.curHealth += absorbAmount;
      target.curHealth = Math.min(cap(target, "Health"), target.curHealth);
      actionEffects.push({
        txt: `${target.username} absorbs ${absorbAmount.toFixed(2)} damage and converts it to health`,
        color: "green",
        hp: { userId: target.userId, amount: absorbAmount },
      });
    }
    if (
      c.absorb_sp !== undefined &&
      c.absorb_sp >= 0 &&
      !curseHolders.has(target.userId)
    ) {
      target.curStamina += c.absorb_sp;
      target.curStamina = Math.min(cap(target, "Stamina"), target.curStamina);
      actionEffects.push({
        txt: `${target.username} absorbs ${c.absorb_sp.toFixed(2)} damage and converts it to stamina`,
        color: "green",
      });
    }
    if (
      c.absorb_cp !== undefined &&
      c.absorb_cp >= 0 &&
      !curseHolders.has(target.userId)
    ) {
      target.curChakra += c.absorb_cp;
      target.curChakra = Math.min(cap(target, "Chakra"), target.curChakra);
      actionEffects.push({
        txt: `${target.username} absorbs ${c.absorb_cp.toFixed(2)} damage and converts it to chakra`,
        color: "green",
      });
    }
    // Handle drain effects for each pool
    if (c.drain_hp !== undefined && c.drain_hp >= 0 && target.curHealth > 0) {
      recordHpLoss("drain_hp");
      target.curHealth = Math.max(0, target.curHealth - c.drain_hp);
      creditDamageDealt(damageCreditUser, target, c.drain_hp);
      actionEffects.push({
        txt: `${target.username} loses ${c.drain_hp.toFixed(2)} HP to drain`,
        color: "purple",
        hp: { userId: target.userId, amount: -c.drain_hp },
      });
    }
    if (c.drain_cp !== undefined && c.drain_cp >= 0 && target.curChakra > 0) {
      target.curChakra = Math.max(0, target.curChakra - c.drain_cp);
      actionEffects.push({
        txt: `${target.username} loses ${c.drain_cp.toFixed(2)} CP to drain`,
        color: "purple",
      });
    }
    if (c.drain_sp !== undefined && c.drain_sp >= 0 && target.curStamina > 0) {
      target.curStamina = Math.max(0, target.curStamina - c.drain_sp);
      actionEffects.push({
        txt: `${target.username} loses ${c.drain_sp.toFixed(2)} SP to drain`,
        color: "purple",
      });
    }
    if (c.poison !== undefined && c.poison >= 0) {
      recordHpLoss("poison");
      target.curHealth = Math.max(
        0,
        Math.min(cap(target, "Health"), target.curHealth - c.poison),
      );
      creditDamageDealt(damageCreditUser, target, c.poison);
      actionEffects.push({
        txt: `${target.username} takes ${c.poison.toFixed(2)} poison damage`,
        color: "purple",
        hp: { userId: target.userId, amount: -c.poison },
      });
    }
    // Process disappear animation of characters
    for (const fighter of [target, user]) {
      if (fighter.curHealth <= 0 && !fighter.isOriginal) {
        newGroundEffects.push(
          getVisualOrSound(
            fighter.longitude,
            fighter.latitude,
            ID_ANIMATION_SMOKE,
            undefined,
            round,
          ),
        );
      }
    }
  }
};

/** Grant shields after all damage, sharing each recipient's HP cap proportionally. */
const grantConversionShields = (
  { newUsersState, newUsersEffects, actionEffects, battle }: EffectResolution,
  shieldConversionsByUser: ShieldConversionsByUser,
) => {
  shieldConversionsByUser.forEach(({ shields }, userId) => {
    const user = newUsersState.find((u) => u.userId === userId);
    if (!user || user.curHealth <= 0) return;
    const totalHp = shields.reduce((total, shield) => total + shield.hp, 0);
    const scale = totalHp > SHIELD_MAX_HEALTH ? SHIELD_MAX_HEALTH / totalHp : 1;
    shields.forEach(({ hp, type, rounds }) => {
      const shieldHp = Math.floor(hp * scale);
      if (shieldHp <= 0) return;
      newUsersEffects.push(
        createConversionShieldEffect(user, shieldHp, rounds, battle.round),
      );
      actionEffects.push({
        txt: `${user.username} ${type === "siphon" ? "siphons" : "consumes"} ${shieldHp} damage as a shield for ${rounds} rounds`,
        color: "blue",
      });
    });
  });
};

/** Every hit on a user wears each piece of armor they have equipped by 1. */
const wearArmor = (battle: CompleteBattle, wearer: BattleUserState) => {
  wearer.items.forEach((userItem) => {
    const item = getItem(battle, userItem.itemId);
    if (item?.itemType === "ARMOR" && userItem.equipped !== "NONE") {
      wearBattleItem(battle, userItem, item, 1);
    }
  });
};

/** State shared by the effects resolved for one action; the collections are mutated. */
export type EffectResolution = {
  consequences: Map<string, Consequence>;
  newUsersState: BattleUserState[];
  newUsersEffects: UserEffect[];
  newGroundEffects: GroundEffect[];
  actionEffects: ActionEffect[];
  appliedEffects: Set<string>;
  battle: CompleteBattle;
  actorId: string;
  action?: CombatAction;
  /** Per-action totals for outgoing and incoming conversion */
  shieldConversionsByUser?: ShieldConversionsByUser;
  /** Shared instant-cast eligibility; Clear removes canceled IDs */
  instantConsumeIds?: Set<string>;
};

/**
 * Function for processing a single effect. Note that this function is not pure,
 * but mutates the resolution's collections.
 */
export const applySingleEffect = (resolution: EffectResolution, effect: UserEffect) => {
  const {
    consequences,
    newUsersState,
    newUsersEffects,
    newGroundEffects,
    actionEffects,
    appliedEffects,
    battle,
    actorId,
    action,
    shieldConversionsByUser,
    instantConsumeIds,
  } = resolution;
  if (effect.timedBuffExpiresAt && effect.timedBuffExpiresAt <= Date.now()) return;
  // Derive damage config from battle state
  const config = battle.extraState.dmgConfig ?? defaultDmgConfig;
  // Destructure
  const { usersState, usersEffects, round } = battle;
  // Get the round information for the effect
  const { startRound, curRound } = calcEffectRoundInfo(effect, battle);
  effect.castThisRound = startRound === curRound;
  // Bookkeeping
  let longitude: number | undefined;
  let latitude: number | undefined;
  let info: ActionEffect | undefined;
  // Get user now and next
  const curUser = usersState.find((u) => u.userId === effect.creatorId);
  const newUser = newUsersState.find((u) => u.userId === effect.creatorId);
  // Remember the effect
  const idx = getEffectStackKey(effect);
  // Determine whether the tags should stack
  const cacheCheck = canStackEffect(effect, appliedEffects);
  // Special cases
  if (
    BARRIER_DAMAGE_TAG_TYPES.has(effect.type) &&
    effect.targetType === "barrier" &&
    curUser
  ) {
    // For barrier damage, only apply if target is the actor (not if effect is new)
    // This prevents residual damage from applying to barriers on every action
    const isTarget = effect.targetId === actorId;
    const ratio = calcApplyRatio(effect, battle, effect.targetId, isTarget);
    if (ratio > 0) {
      const result = damageBarrier(newGroundEffects, curUser, effect, config);
      if (result) {
        longitude = result.barrier.longitude;
        latitude = result.barrier.latitude;
        actionEffects.push(result.info);
      }
    }
  } else if (effect.targetType === "user" && cacheCheck) {
    // Get the user && effect details
    const curTarget = usersState.find((u) => u.userId === effect.targetId);
    const newTarget = newUsersState.find((u) => u.userId === effect.targetId);
    const isSealed =
      effect.fromType === "bloodline" &&
      sealCheck(effect, getActiveSealEffects(usersEffects));
    const isTargetOrNew = effect.targetId === actorId || effect.isNew;
    if (curUser && newUser && curTarget && newTarget && !isSealed) {
      appliedEffects.add(idx);
      longitude = curTarget?.longitude;
      latitude = curTarget?.latitude;

      // Figure if tag should be applied
      const ratio = calcApplyRatio(effect, battle, effect.targetId, isTargetOrNew);
      if (ratio > 0) {
        // Build only for handlers that check prevention, using the current resolution state.
        // Prefer resolved Sage protections and retain unprocessed originals for seal checks.
        const getPreventionEffects = () => {
          const resolvedEffectIds = new Set(newUsersEffects.map((e) => e.id));
          return [
            ...newUsersEffects,
            ...usersEffects.filter((e) => !resolvedEffectIds.has(e.id)),
          ];
        };
        // Record the APPLIED (resolved, ratio>0) tag type for the tag_usage_win tracker.
        // The damage-modifier loop in applyEffects records the same way past its preventInfo
        // guard, so both write sites share recordUsedTag's single definition of "applied".
        recordUsedTag(newUsersState, newUser, effect.type);
        // Tags only applied when target is user or new
        if (isTargetOrNew) {
          if (effect.type === "damage") {
            const modifier = calcDmgModifier(effect, curTarget, usersEffects);
            info = damageUser(
              effect,
              curUser,
              curTarget,
              consequences,
              modifier,
              config,
            );
          } else if (effect.type === "pierce") {
            const modifier =
              calcDmgModifier(effect, curTarget, usersEffects) *
              getCurseDamageMultiplier(newUsersEffects, effect.creatorId, usersEffects);
            info = damageUser(
              effect,
              newUser,
              newTarget,
              consequences,
              modifier,
              config,
            );
          } else if (effect.type === "heal") {
            info = heal(effect, getPreventionEffects(), curTarget, consequences, ratio);
          } else if (effect.type === "flee" && !battle.extraState.dungeon) {
            info = flee(effect, getPreventionEffects(), newTarget);
          } else if (effect.type === "increasepoolcost") {
            info = increasepoolcost(effect, curTarget);
          } else if (effect.type === "decreasepoolcost") {
            info = decreasepoolcost(effect, curTarget);
          } else if (effect.type === "drain") {
            info = drain(effect, usersEffects, consequences, curTarget);
          } else if (effect.type === "clear") {
            info = clear(effect, usersEffects, curTarget, instantConsumeIds);
          } else if (effect.type === "cleanse") {
            info = cleanse(effect, usersEffects, curTarget);
          } else if (effect.type === "increasedamagegiven") {
            info = increaseDamageGiven(effect, usersEffects, consequences, curTarget);
          } else if (effect.type === "decreasedamagegiven") {
            info = decreaseDamageGiven(effect, usersEffects, consequences, curTarget);
          } else if (
            effect.type === "increaseaggro" ||
            effect.type === "decreaseaggro"
          ) {
            info = adjustAggro(effect, usersEffects, newTarget);
          } else if (effect.type === "onehitkill") {
            const healthBefore = newTarget.curHealth;
            info = onehitkill(effect, getPreventionEffects(), newTarget);
            const healthLost = healthBefore - newTarget.curHealth;
            if (healthLost > 0) {
              consequences.set(effect.id, {
                userId: newUser.userId,
                targetId: newTarget.userId,
                instantKillDamage: healthLost,
              });
            }
            // Count the HP an instant kill removes as damage dealt, so raid
            // progress (capped at the attackers' damageDealt) includes it.
            creditDamageDealt(
              resolveDamageCreditUser(newUsersState, newUser),
              newTarget,
              healthLost,
            );
            creditDamageEnmity(newUser, newTarget, healthLost, usersEffects);
          } else if (effect.type === "rob") {
            info = rob(
              effect,
              getPreventionEffects(),
              newUser,
              newTarget,
              battle.battleType,
            );
          } else if (effect.type === "seal") {
            info = seal(effect, getPreventionEffects(), curTarget);
          } else if (effect.type === "stun") {
            info = stun(effect, getPreventionEffects(), curTarget);
          } else if (effect.type === "wound") {
            info = wound(effect, usersEffects, consequences, curTarget);
          }
        }

        // Always apply
        if (effect.type === "absorb") {
          info = absorb(effect, usersEffects, consequences, curTarget);
        } else if (effect.type === "increasestat") {
          const timedEffect = nonStackingTimedStatEffect(
            effect,
            usersEffects,
            curTarget,
          );
          if (timedEffect)
            info = increaseStats(timedEffect, getPreventionEffects(), curTarget);
        } else if (effect.type === "increasemastery") {
          info = increaseMastery(effect, getPreventionEffects(), newTarget);
        } else if (effect.type === "decreasemastery") {
          info = decreaseMastery(effect, getPreventionEffects(), newTarget);
        } else if (effect.type === "increasemaxpools") {
          info = increaseMaxPools(effect, getPreventionEffects(), newTarget);
        } else if (effect.type === "decreasemaxpools") {
          info = decreaseMaxPools(effect, getPreventionEffects(), newTarget);
        } else if (effect.type === "increasecooldown") {
          info = increaseCooldown(effect, usersEffects, curTarget);
        } else if (effect.type === "decreasecooldown") {
          info = decreaseCooldown(effect, usersEffects, curTarget);
        } else if (effect.type === "increaserange") {
          info = increaseRange(effect, usersEffects, curTarget);
        } else if (effect.type === "decreasestat") {
          info = decreaseStats(effect, getPreventionEffects(), curTarget);
        } else if (effect.type === "increasedamagetaken") {
          info = increaseDamageTaken(effect, usersEffects, consequences, curTarget);
        } else if (effect.type === "decreasedamagetaken") {
          info = decreaseDamageTaken(effect, usersEffects, consequences, curTarget);
        } else if (
          effect.type === "increasepotency" ||
          effect.type === "decreasepotency"
        ) {
          info = potency(effect, usersEffects, curTarget);
        } else if (effect.type === "increaseheal") {
          info = increaseHealGiven(effect, usersEffects, consequences, curTarget);
        } else if (effect.type === "decreaseheal") {
          info = decreaseHealGiven(effect, usersEffects, consequences, curTarget);
        } else if (effect.type === "curse") {
          info = curse(effect, getPreventionEffects(), curTarget, round);
        } else if (effect.type === "parry") {
          info = parry(effect, usersEffects, consequences, curTarget);
        } else if (effect.type === "reflect") {
          info = reflect(effect, usersEffects, consequences, curTarget);
        } else if (effect.type === "recoil") {
          info = recoil(effect, usersEffects, consequences, curTarget);
        } else if (effect.type === "afterburn") {
          info = afterburn(effect, usersEffects, consequences, curTarget);
        } else if (effect.type === "lifesteal") {
          info = lifesteal(effect, usersEffects, consequences, curTarget);
        } else if (effect.type === "vamp") {
          info = vamp(effect, usersEffects, consequences, curTarget);
        } else if (isPreventEffect(effect)) {
          info = applyPreventTag(effect, usersEffects, curTarget);
        } else if (effect.type === "stealth") {
          info = stealth(effect, curTarget);
        } else if (effect.type === "elementalseal") {
          info = elementalseal(effect, curTarget);
        } else if (effect.type === "weakness") {
          info = weakness(effect, curTarget);
        } else if (
          (effect.type === "consume" || effect.type === "siphon") &&
          shieldConversionsByUser
        ) {
          info = registerShieldConversion(
            effect,
            shieldConversionsByUser,
            usersEffects,
            curTarget,
          );
        } else if (effect.type === "shield") {
          info = shield(effect, curTarget);
        } else if (effect.type === "immunity") {
          info = immunity(effect, curTarget);
        } else if (effect.type === "poison" && action) {
          info = poison(effect, action, actorId, consequences, curTarget, usersEffects);
        } else if (effect.type === "injectjutsus") {
          info = injectjutsus(effect, newTarget);
        } else if (effect.type === "activatesagemode") {
          info = applyActivateSageMode(resolution, effect, newTarget);
        } else if (effect.type === "copy") {
          info = copy(effect, usersEffects, curUser, curTarget);
        } else if (effect.type === "mirror") {
          info = mirror(effect, usersEffects, curUser, curTarget);
        } else if (
          effect.type === "timecompression" ||
          effect.type === "timedilation"
        ) {
          info = temporalShift(effect, usersEffects, curTarget);
        } else if (effect.type === "redirection") {
          info = redirection(
            battle,
            effect,
            usersEffects,
            newUser,
            newTarget,
            newUsersState,
            newGroundEffects,
          );
        } else if (effect.type === "finalstand") {
          info = finalStand(effect, curTarget);
        } else if (effect.type === "diffuse" && effect.isNew) {
          info = {
            txt: `${curTarget.username} can diffuse incoming damage for ${effect.rounds} rounds`,
            color: "blue",
            types: ["diffuse"],
          };
        }
        if (effect.type !== "activatesagemode") {
          updateStatUsage(newTarget, effect, true);
        }
      }
    }
  }

  // Show text results of actions
  if (info) {
    actionEffects.push(info);
  }

  // Show once appearing visual/audio
  if (
    (effect.appearAnimation || effect.appearSfx) &&
    effect.isNew &&
    longitude !== undefined &&
    latitude !== undefined
  ) {
    newGroundEffects.push(
      getVisualOrSound(
        longitude,
        latitude,
        effect.appearAnimation,
        effect.appearSfx,
        battle.round,
        effect.animationScale,
      ),
    );
  }

  if ((isEffectActive(effect) && !effect.fromGround) || effect.type === "visual") {
    effect.isNew = false;
    newUsersEffects.push(effect);
  } else if (
    (effect.disappearAnimation || effect.disappearSfx) &&
    longitude !== undefined &&
    latitude !== undefined
  ) {
    newGroundEffects.push(
      getVisualOrSound(
        longitude,
        latitude,
        effect.disappearAnimation,
        effect.disappearSfx,
        round,
        effect.animationScale,
      ),
    );
  }
};

/**
 * Realize authored sage tags for activation (`sageMode`) or exhaustion
 * (`sageModeAfter`). Lasting tags take `rounds` from the SageMode row and are
 * backdated one round so they tick on the current apply pass. `rounds === 0`
 * stays a one-shot and is not overwritten.
 *
 * @param props.tags - Catalog `effects`, `level2Effects`, or `afterEffects`.
 * @param props.user - Actor who owns the mode (also the tag target).
 * @param props.fromType - Source used by clear/copy/mirror exclusions.
 * @param props.rounds - `activationRounds` or `afterEffectRounds`.
 * @param props.actionId - Activation jutsu id, or `"sageModeAfter"`.
 * @param props.level - Combat level from `getActiveSageLevel` (scales `powerPerLevel`).
 * @param props.battle - Current battle (round + extra state).
 */
function realizeSageTags(props: {
  tags: readonly ZodAllTags[];
  user: BattleUserState;
  fromType: "sageMode" | "sageModeAfter";
  rounds: number;
  actionId: string;
  level: number;
  battle: CompleteBattle;
}): UserEffect[] {
  const { tags, user, fromType, rounds, actionId, level, battle } = props;
  const sorted = [...tags].sort((a, b) =>
    sortEffects(a as UserEffect, b as UserEffect),
  );
  return sorted.map((raw) => {
    const tag = structuredClone(raw) as UserEffect;
    const realized = realizePassiveEffect({
      tag,
      user,
      actionId,
      level,
      fromType,
      round: battle.round,
    });
    realized.longitude = user.longitude;
    realized.latitude = user.latitude;
    if (realized.rounds !== 0) {
      realized.rounds = rounds;
      realized.timeTracker = {};
      realized.createdRound = Math.max(0, battle.round - 1);
    }
    return realized;
  });
}

/**
 * Charge activation pools and apply the equipped mode's `effects` (plus
 * `level2Effects` at combat level 2). Only the injected Activation jutsu
 * (`SAGE_MODE_ACTIVATION_JUTSU_ID`) may call this; authored jutsu/items are
 * rejected by `SuperRefineEffects` and again here.
 *
 * @returns Combat-log line, or a gray refusal if a guard fails.
 */
function applyActivateSageMode(
  resolution: EffectResolution,
  effect: UserEffect,
  newTarget: BattleUserState,
): ActionEffect | undefined {
  const { battle, actorId } = resolution;
  if (effect.actionId !== SAGE_MODE_ACTIVATION_JUTSU_ID) {
    return {
      txt: "Sage mode can only be activated through the Activation action",
      color: "gray",
    };
  }
  if (effect.targetId !== actorId) {
    return { txt: "Sage mode can only be activated on yourself", color: "gray" };
  }
  if (SAGE_MODE_DISABLED_BATTLES.includes(battle.battleType)) {
    return { txt: "Sage mode cannot be used in this battle type", color: "gray" };
  }
  const sageModeId = newTarget.sageModeId;
  if (!sageModeId) {
    return { txt: `${newTarget.username} has no sage mode equipped`, color: "gray" };
  }
  const sageMode: SageMode | undefined = battle.extraState.sageModes?.[sageModeId];
  if (!sageMode) {
    return { txt: "Sage mode data is missing", color: "gray" };
  }
  if (newTarget.sageModeActivated) {
    return { txt: `${newTarget.username} is already in sage mode`, color: "gray" };
  }
  if (newTarget.sageModeUsedThisBattle) {
    return { txt: "Sage mode can only be used once per battle", color: "gray" };
  }
  if (
    (newTarget.dailySageActivations ?? 0) >=
    getSageDailyCap(newTarget.sageMasteryExperience)
  ) {
    return {
      txt: "You have reached today's sage mode activation limit",
      color: "gray",
    };
  }

  // "Active Duration (rounds)" on the SageMode row (`activationRounds`) — duration for all sage effects.
  const activeDurationRounds = sageMode.activationRounds;

  const { cpCost, spCost } = getSageModeActivationCost(
    sageMode,
    newTarget.maxChakra,
    newTarget.maxStamina,
  );
  if (newTarget.curChakra < cpCost || newTarget.curStamina < spCost) {
    return {
      txt: `${newTarget.username} does not have enough chakra or stamina to enter sage mode`,
      color: "gray",
    };
  }

  newTarget.curChakra = Math.max(0, newTarget.curChakra - cpCost);
  newTarget.curStamina = Math.max(0, newTarget.curStamina - spCost);

  newTarget.sageModeActivated = true;
  newTarget.sageModeUsedThisBattle = true;
  newTarget.dailySageActivations = (newTarget.dailySageActivations ?? 0) + 1;
  newTarget.sageModeActivatedRound = battle.round;
  newTarget.sageModeExpiresRound = battle.round + activeDurationRounds;

  const activeLevel = getActiveSageLevel(newTarget.sageMasteryExperience, sageMode);
  // At level 2, level2Effects apply IN ADDITION to base effects; sort together so
  // ordering-sensitive tags (shields before damage, etc.) interleave correctly.
  const activeEffects =
    activeLevel >= SAGE_MODE_MAX_LEVEL
      ? [...sageMode.effects, ...(sageMode.level2Effects ?? [])]
      : sageMode.effects;
  for (const realized of realizeSageTags({
    tags: activeEffects,
    user: newTarget,
    fromType: "sageMode",
    rounds: activeDurationRounds,
    actionId: effect.actionId,
    level: activeLevel,
    battle,
  })) {
    // Instant-conversion eligibility stays with the casting pass, out of reach of granted tags.
    applySingleEffect({ ...resolution, instantConsumeIds: undefined }, realized);
  }

  return {
    txt: `${newTarget.username} enters sage mode`,
    color: "green",
  };
}

/**
 * After a round advances: once `sageModeExpiresRound` (activation round +
 * `activationRounds`) has elapsed, queue lasting `afterEffects` and resolve
 * instant ones immediately. Also prunes spent active/exhaustion auras.
 *
 * Instant after-effects cannot wait for the next `applyEffects` actor — they
 * are queued with `isNew=false` and would be dropped if that actor is not the sage.
 *
 * @param battle - Live battle mutated in place.
 */
export function applySageModeAfterRoundTransition(battle: CompleteBattle): void {
  // Prune exhaustion-phase auras whose rounds have run out (visuals otherwise persist).
  battle.usersEffects = battle.usersEffects.filter(
    (e) =>
      !(e.type === "visual" && e.fromType === "sageModeAfter" && !isEffectActive(e)),
  );

  battle.usersState.forEach((u) => {
    if (!u.sageModeActivated) return;

    // The active window is duration-driven: honor the full `activationRounds` window via
    // `sageModeExpiresRound` even when no lasting buff remains (a mode whose active effects
    // are all instant would otherwise collapse into exhaustion the next round).
    if (battle.round < (u.sageModeExpiresRound ?? 0)) return;

    const sageModeId = u.sageModeId;
    const sageMode: SageMode | undefined = sageModeId
      ? battle.extraState.sageModes?.[sageModeId]
      : undefined;

    const afterRounds = sageMode?.afterEffectRounds ?? 0;

    if (afterRounds > 0 && sageMode?.afterEffects?.length) {
      const realized = realizeSageTags({
        tags: sageMode.afterEffects,
        user: u,
        fromType: "sageModeAfter",
        rounds: afterRounds,
        actionId: "sageModeAfter",
        level: getActiveSageLevel(u.sageMasteryExperience, sageMode),
        battle,
      });
      // Lasting tags stay queued for the normal apply pipeline. Instant tags
      // (rounds === 0) must resolve now: the next applyEffects actor is often
      // not the sage, and isNew=false + isTargetOrNew would drop them.
      const lasting = realized.filter((tag) => tag.rounds !== 0);
      const instant = realized.filter((tag) => tag.rounds === 0);
      battle.usersEffects.push(...lasting);
      if (instant.length > 0) {
        applyInstantSageAfterEffects(battle, u.userId, instant);
      }
    }

    // Sage mode is spent for the rest of the battle. `u` is a live element of
    // `battle.usersState` (never reassigned here), so mutate it directly.
    u.sageModeUsedThisBattle = true;
    u.sageModeActivated = false;
    u.sageModeActivatedRound = null;
    u.sageModeExpiresRound = null;

    // The active aura is a `visual` effect that bypasses normal round expiry
    // (applySingleEffect re-pushes visuals unconditionally). Remove it now that the
    // active phase is over; the exhaustion phase gets its own visual from afterEffects.
    battle.usersEffects = battle.usersEffects.filter(
      (e) =>
        !(e.type === "visual" && e.fromType === "sageMode" && e.targetId === u.userId),
    );
  });
}

/**
 * Run one-shot (`rounds === 0`) exhaustion tags through `applySingleEffect` with
 * the sage as actor, then fold heal/damage/drain onto pools. These resolve silently,
 * with no combat log lines, and pool changes bypass shields, Final Stand, enmity and
 * damage credit. Lasting tags must not be passed here — they stay queued on `usersEffects`.
 *
 * @param battle - Live battle mutated in place.
 * @param sageUserId - Actor/target for the after-effects.
 * @param instant - Realized tags whose `rounds === 0`.
 */
function applyInstantSageAfterEffects(
  battle: CompleteBattle,
  sageUserId: string,
  instant: UserEffect[],
) {
  const consequences = new Map<string, Consequence>();
  const newUsersEffects: UserEffect[] = [];
  const newGroundEffects: GroundEffect[] = [];
  const resolution: EffectResolution = {
    consequences,
    newUsersState: battle.usersState,
    newUsersEffects,
    newGroundEffects,
    actionEffects: [],
    appliedEffects: new Set(),
    battle,
    actorId: sageUserId,
  };
  for (const tag of instant) applySingleEffect(resolution, tag);
  battle.usersEffects.push(...newUsersEffects);
  battle.groundEffects.push(...newGroundEffects);
  consequences.forEach((c) => {
    const target = battle.usersState.find((user) => user.userId === c.targetId);
    if (!target) return;
    const cap = (pool: PoolType) =>
      getEffectiveMaxPool(target, battle.usersEffects, pool);
    if (c.heal_hp !== undefined && c.heal_hp >= 0 && target.curHealth > 0) {
      target.curHealth = Math.min(cap("Health"), target.curHealth + c.heal_hp);
    }
    if (c.heal_sp !== undefined && c.heal_sp >= 0) {
      target.curStamina = Math.min(cap("Stamina"), target.curStamina + c.heal_sp);
    }
    if (c.heal_cp !== undefined && c.heal_cp >= 0) {
      target.curChakra = Math.min(cap("Chakra"), target.curChakra + c.heal_cp);
    }
    if (c.damage !== undefined && c.damage >= 0) {
      target.curHealth = Math.max(0, target.curHealth - c.damage);
    }
    if (c.drain_hp !== undefined && c.drain_hp >= 0) {
      target.curHealth = Math.max(0, target.curHealth - c.drain_hp);
    }
    if (c.drain_cp !== undefined && c.drain_cp >= 0) {
      target.curChakra = Math.max(0, target.curChakra - c.drain_cp);
    }
    if (c.drain_sp !== undefined && c.drain_sp >= 0) {
      target.curStamina = Math.max(0, target.curStamina - c.drain_sp);
    }
  });
}
