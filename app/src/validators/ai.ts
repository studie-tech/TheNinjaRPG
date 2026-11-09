import { detailedDiff } from "deep-object-diff";
import { z } from "zod";
import { IMG_ORIENTATIONS } from "@/drizzle/constants";
import { literalType } from "@/validators/base";
import { isActivityBonus, tagTypes } from "@/validators/combat";
import { bossArrivalSchema } from "@/validators/coop";

/** Shared content-image generation input; provider defaults to NANO_BANANA. */
export const contentImageInputSchema = z.object({
  preprompt: z.string(),
  prompt: z.string(),
  previousImg: z.string().optional(),
  removeBg: z.boolean(),
  relationId: z.string(),
  size: z.enum(IMG_ORIENTATIONS),
  maxDim: z.number(),
  provider: z.enum(["NANO_BANANA", "OPENAI"]).prefault("NANO_BANANA"),
});

/** Image-generation providers supported by the content editor. */
export type ContentImageProvider = z.infer<typeof contentImageInputSchema>["provider"];

/** An AI's next form and its arrival, as edited on the AI page. */
export const aiTransformationSchema = bossArrivalSchema.extend({
  nextAiId: z.string().min(1, "Choose the next form."),
});
export type AiTransformationInput = z.infer<typeof aiTransformationSchema>;
export const updateAiTransformationSchema = z.object({
  aiId: z.string().min(1),
  transformation: aiTransformationSchema.nullable(),
});

export const AvailableTargets = [
  "BARRIER_BETWEEN",
  "BARRIER_BLOCKING_CLOSEST_OPPONENT",
  "CLOSEST_ALLY",
  "CLOSEST_OPPONENT",
  "HIGHEST_ENMITY_OPPONENT",
  "LOWEST_ENMITY_OPPONENT",
  "HIGHEST_MAX_HEALTH_ALLY",
  "HIGHEST_MAX_HEALTH_OPPONENT",
  "LOWEST_HEALTH_OPPONENT",
  "LOWEST_MAX_HEALTH_ALLY",
  "EMPTY_GROUND_CLOSEST_TO_OPPONENT",
  "EMPTY_GROUND_CLOSEST_TO_SELF",
  "RANDOM_ALLY",
  "RANDOM_OPPONENT",
  "SELF",
] as const;

export type AvailableTarget = (typeof AvailableTargets)[number];

/*********************************/
/*          Conditions           */
/*********************************/
export const ConditionHealthBelow = z.object({
  type: z.literal("health_below").prefault("health_below"),
  description: z.string().prefault("Health below given percentage"),
  value: z.coerce.number().int().positive().prefault(10),
});

export const ConditionDistanceHigherThan = z.object({
  type: z.literal("distance_higher_than").prefault("distance_higher_than"),
  description: z.string().prefault("Distance higher than or equal given value"),
  value: z.coerce.number().int().positive().prefault(3),
  target: z.enum(AvailableTargets).prefault("RANDOM_OPPONENT"),
});

export const ConditionDistanceLowerThan = z.object({
  type: z.literal("distance_lower_than").prefault("distance_lower_than"),
  description: z.string().prefault("Distance lower than or equal given value"),
  value: z.coerce.number().int().positive().prefault(2),
  target: z.enum(AvailableTargets).prefault("RANDOM_OPPONENT"),
});

export const ConditionSpecificRound = z.object({
  type: z.literal("specific_round").prefault("specific_round"),
  description: z.string().prefault("A specific round number"),
  value: z.coerce.number().int().positive().prefault(10),
});

export const ConditionRoundGreaterThan = z.object({
  type: z.literal("round_greater_than").prefault("round_greater_than"),
  description: z.string().prefault("Current round is greater than specified value"),
  value: z.coerce.number().int().positive().prefault(5),
});

export const ConditionRoundLowerThan = z.object({
  type: z.literal("round_lower_than").prefault("round_lower_than"),
  description: z.string().prefault("Current round is lower than specified value"),
  value: z.coerce.number().int().positive().prefault(3),
});

export const ConditionDoesNotHaveSummon = z.object({
  type: z.literal("does_not_have_summon").prefault("does_not_have_summon"),
  description: z.string().prefault("Does not have a summon active"),
});

const rangeSettings = {
  minRange: z.coerce.number().int().min(0).prefault(0),
  maxRange: z.coerce.number().int().min(0).prefault(3),
};

export const ConditionPlayerWithinRange = z.object({
  type: z.literal("player_within_range").prefault("player_within_range"),
  description: z.string().prefault("An enemy player is within the inclusive hex range"),
  ...rangeSettings,
});

export const ConditionSummonWithinRange = z.object({
  type: z.literal("summon_within_range").prefault("summon_within_range"),
  description: z.string().prefault("An enemy summon is within the inclusive hex range"),
  ...rangeSettings,
});

// Elemental Damage resolves to damage before AI selection and effect conditions.
export const AvailableEffectTypes = tagTypes.filter(
  (type) =>
    type !== "elementaldamage" &&
    type !== "increasejutsuslots" &&
    !isActivityBonus({ type }),
) as [string, ...string[]];

export const ConditionHasEffect = z.object({
  type: z.literal("has_effect").prefault("has_effect"),
  description: z.string().prefault("AI is affected by a specific effect"),
  effectType: z.enum(AvailableEffectTypes).prefault("damage"),
  threshold: z.coerce.number().int().min(0).max(100).prefault(0),
});

export const ConditionTargetHasEffect = z.object({
  type: z.literal("target_has_effect").prefault("target_has_effect"),
  description: z.string().prefault("Target is affected by a specific effect"),
  effectType: z.enum(AvailableEffectTypes).prefault("damage"),
  target: z.enum(AvailableTargets).prefault("CLOSEST_OPPONENT"),
  threshold: z.coerce.number().int().min(0).max(100).prefault(0),
});

export const ZodAllAiConditions = z.union([
  ConditionHealthBelow,
  ConditionSpecificRound,
  ConditionRoundGreaterThan,
  ConditionRoundLowerThan,
  ConditionDistanceHigherThan,
  ConditionDistanceLowerThan,
  ConditionDoesNotHaveSummon,
  ConditionHasEffect,
  ConditionTargetHasEffect,
  ConditionPlayerWithinRange,
  ConditionSummonWithinRange,
]);

export const AiConditionTypes = ZodAllAiConditions.options.map(literalType);

export type ZodAllAiCondition = z.infer<typeof ZodAllAiConditions>;

export const getConditionSchema = (type: ZodAllAiCondition["type"]) => {
  const schema = ZodAllAiConditions.options.find((o) => literalType(o) === type);
  if (!schema) throw new Error(`No schema found for type ${type}`);
  return schema;
};

/*********************************/
/*            Actions            */
/*********************************/
export const AvailableActionTargets = [...AvailableTargets, "COORDINATE"] as const;

const coordinateAxis = z
  .union([z.number(), z.string().trim().min(1)])
  .pipe(z.coerce.number<string | number>().int().nonnegative());

export const aiCoordinatesSchema = z.object({
  longitude: coordinateAxis,
  latitude: coordinateAxis,
});

const actionTargetSettings = {
  target: z.enum(AvailableActionTargets).prefault("RANDOM_OPPONENT"),
  coordinates: aiCoordinatesSchema.optional(),
};

export const ActionMoveTowardsOpponent = z.object({
  type: z.literal("move_towards_opponent").prefault("move_towards_opponent"),
  description: z.string().prefault("Move towards opponent"),
  ...actionTargetSettings,
});

export const ActionEndTurn = z.object({
  type: z.literal("end_turn").prefault("end_turn"),
  description: z.string().prefault("End turn"),
});

export const ActionUseSpecificJutsu = z.object({
  type: z.literal("use_specific_jutsu").prefault("use_specific_jutsu"),
  description: z.string().prefault("Select specific jutsu"),
  jutsuId: z.string().prefault(""),
  ...actionTargetSettings,
});

export const ActionUseRandomJutsu = z.object({
  type: z.literal("use_random_jutsu").prefault("use_random_jutsu"),
  description: z.string().prefault("Use random jutsu"),
  ...actionTargetSettings,
});

export const ActionWithHighestPowerJutsuEffect = z.object({
  type: z.literal("use_highest_power_jutsu").prefault("use_highest_power_jutsu"),
  description: z.string().prefault("Use jutsu with given effect with highest power"),
  ...actionTargetSettings,
  effect: z.string().prefault("damage"),
});

export const ActionUseSpecificItem = z.object({
  type: z.literal("use_specific_item").prefault("use_specific_item"),
  description: z.string().prefault("Select specific item"),
  itemId: z.string().prefault(""),
  ...actionTargetSettings,
});

export const ActionUseRandomItem = z.object({
  type: z.literal("use_random_item").prefault("use_random_item"),
  description: z.string().prefault("Use random item"),
  ...actionTargetSettings,
});

export const ActionWithHighestPowerItemEffect = z.object({
  type: z.literal("use_highest_power_item").prefault("use_highest_power_item"),
  description: z.string().prefault("Use item with given effect with highest power"),
  ...actionTargetSettings,
  effect: z.string().prefault("damage"),
});

export const ActionWithEffectHighestPower = z.object({
  type: z.literal("use_highest_power_action").prefault("use_highest_power_action"),
  description: z.string().prefault("Use action with given effect with highest power"),
  ...actionTargetSettings,
  effect: z.string().prefault("damage"),
});

export const ActionSpecificCombo = z.object({
  type: z.literal("use_combo_action").prefault("use_combo_action"),
  description: z.string().prefault("Cycly through a specific combo of jutsu & items"),
  comboIds: z.array(z.string()).prefault([]),
  ...actionTargetSettings,
});

export const ZodAllAiActions = z.union([
  ActionMoveTowardsOpponent,
  ActionEndTurn,
  ActionUseSpecificJutsu,
  ActionUseSpecificItem,
  ActionUseRandomJutsu,
  ActionUseRandomItem,
  ActionWithEffectHighestPower,
  ActionWithHighestPowerJutsuEffect,
  ActionWithHighestPowerItemEffect,
  ActionSpecificCombo,
]);

export const AiActionTypes = ZodAllAiActions.options.map(literalType);

export type ZodAllAiAction = z.infer<typeof ZodAllAiActions>;

export const getActionSchema = (type: ZodAllAiAction["type"]) => {
  const schema = ZodAllAiActions.options.find((o) => literalType(o) === type);
  if (!schema) throw new Error(`No schema found for type ${type}`);
  return schema;
};

/*********************************/
/*            Rules              */
/*********************************/
export const AiRule = z
  .object({
    id: z.string().optional(),
    group: z
      .object({
        id: z.string().min(1),
        name: z.string().trim().min(1).max(100),
        note: z.string().max(1000).prefault(""),
      })
      .optional(),
    conditions: z.array(ZodAllAiConditions),
    action: ZodAllAiActions,
  })
  .superRefine((rule, ctx) => {
    if (
      "target" in rule.action &&
      rule.action.target === "COORDINATE" &&
      !rule.action.coordinates
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Coordinate targets require X and Y coordinates",
        path: ["action", "coordinates"],
      });
    }
    rule.conditions.forEach((condition, index) => {
      if ("minRange" in condition && condition.minRange > condition.maxRange) {
        ctx.addIssue({
          code: "custom",
          message: "Minimum range must not exceed maximum range",
          path: ["conditions", index, "minRange"],
        });
      }
    });
  });

export const updateAiProfileSchema = z.object({
  id: z.string(),
  rules: z.array(AiRule),
  includeDefaultRules: z.boolean(),
});

export type AiRuleType = z.infer<typeof AiRule>;

/**
 * Returns the catch-all rules enforced at the end of user AI profiles and profiles with
 * includeDefaultRules:
 * 1-3. distance_higher_than 2: move towards the opponent (three identical rules).
 * 4. distance_lower_than 2: use the highest-power damage action.
 * 5. No conditions: use the highest-power damage action on the barrier blocking the
 *    closest opponent.
 *
 * The AI evaluates rules from the first on every call, so the second and third move rules
 * evaluate exactly as the first. Saved profiles store this tail, and the profile editor
 * counts and locks the trailing getBackupRules().length rules.
 */
export const getBackupRules = () => {
  const rules: AiRuleType[] = [];
  rules.push(
    AiRule.parse({
      conditions: [ConditionDistanceHigherThan.parse({ value: 2 })],
      action: ActionMoveTowardsOpponent.parse({}),
    }),
    AiRule.parse({
      conditions: [ConditionDistanceHigherThan.parse({ value: 2 })],
      action: ActionMoveTowardsOpponent.parse({}),
    }),
    AiRule.parse({
      conditions: [ConditionDistanceHigherThan.parse({ value: 2 })],
      action: ActionMoveTowardsOpponent.parse({}),
    }),
    AiRule.parse({
      conditions: [ConditionDistanceLowerThan.parse({ value: 2 })],
      action: ActionWithEffectHighestPower.parse({ effect: "damage" }),
    }),
    AiRule.parse({
      conditions: [],
      action: ActionWithEffectHighestPower.parse({
        effect: "damage",
        target: "BARRIER_BLOCKING_CLOSEST_OPPONENT",
      }),
    }),
  );
  return rules;
};

/**
 * Enforces the backup rules by comparing the provided rules with the backup rules.
 * If the backup rules are not present in the provided rules, they are added.
 *
 * @param rules - The array of AI rules to be validated and potentially updated.
 */
export const enforceExtraRules = (rules: AiRuleType[], enforced: AiRuleType[]) => {
  // Labels and editor identities do not change the behavior of a fallback rule.
  const behavior = (rule: AiRuleType) => ({
    conditions: rule.conditions,
    action: rule.action,
  });
  const diff = detailedDiff(
    enforced.map(behavior),
    rules.slice(-enforced.length).map(behavior),
  );
  const hasEnforcedRules =
    Object.keys(diff.added).length === 0 &&
    Object.keys(diff.deleted).length === 0 &&
    Object.keys(diff.updated).length === 0;
  if (!hasEnforcedRules) {
    rules.push(...enforced);
  }
};

// Prompt form schema for AI image generation
export const promptFormSchema = z.object({
  systemPrompt: z.string(),
  userPrompt: z.string(),
  editPrompt: z.string(),
});
export type PromptFormSchema = z.infer<typeof promptFormSchema>;
