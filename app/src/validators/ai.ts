import { detailedDiff } from "deep-object-diff";
import { z } from "zod";
import { tagTypes } from "@/validators/combat";

export const AvailableTargets = [
  "BARRIER_BETWEEN",
  "BARRIER_BLOCKING_CLOSEST_OPPONENT",
  "CLOSEST_ALLY",
  "CLOSEST_OPPONENT",
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

// Import effect types from the combat system
export const AvailableEffectTypes = (tagTypes.length > 0 ? tagTypes : ["damage"]) as [
  string,
  ...string[],
];
export type AvailableEffectType = (typeof AvailableEffectTypes)[number];

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
]);

export const AiConditionTypes = ZodAllAiConditions.options.map((o) => {
  const typeField = o.shape.type;
  const literal = typeField.unwrap(); // ZodLiteral
  return literal.value as string;
});

export type AiConditionType = (typeof AiConditionTypes)[number];

export type ZodAllAiCondition = z.infer<typeof ZodAllAiConditions>;

export const getConditionSchema = (type: ZodAllAiCondition["type"]) => {
  const schema = ZodAllAiConditions.options.find((o) => {
    const typeField = o.shape.type;
    const literal = typeField.unwrap();
    return literal.value === type;
  });
  if (!schema) throw new Error(`No schema found for type ${type}`);
  return schema;
};

/*********************************/
/*            Actions            */
/*********************************/
export const ActionMoveTowardsOpponent = z.object({
  type: z.literal("move_towards_opponent").prefault("move_towards_opponent"),
  description: z.string().prefault("Move towards opponent"),
  target: z.enum(AvailableTargets).prefault("RANDOM_OPPONENT"),
});

export const ActionEndTurn = z.object({
  type: z.literal("end_turn").prefault("end_turn"),
  description: z.string().prefault("End turn"),
});

export const ActionUseSpecificJutsu = z.object({
  type: z.literal("use_specific_jutsu").prefault("use_specific_jutsu"),
  description: z.string().prefault("Select specific jutsu"),
  jutsuId: z.string().prefault(""),
  target: z.enum(AvailableTargets).prefault("RANDOM_OPPONENT"),
});

export const ActionUseRandomJutsu = z.object({
  type: z.literal("use_random_jutsu").prefault("use_random_jutsu"),
  description: z.string().prefault("Use random jutsu"),
  target: z.enum(AvailableTargets).prefault("RANDOM_OPPONENT"),
});

export const ActionWithHighestPowerJutsuEffect = z.object({
  type: z.literal("use_highest_power_jutsu").prefault("use_highest_power_jutsu"),
  description: z.string().prefault("Use jutsu with given effect with highest power"),
  target: z.enum(AvailableTargets).prefault("RANDOM_OPPONENT"),
  effect: z.string().prefault("damage"),
});

export const ActionUseSpecificItem = z.object({
  type: z.literal("use_specific_item").prefault("use_specific_item"),
  description: z.string().prefault("Select specific item"),
  itemId: z.string().prefault(""),
  target: z.enum(AvailableTargets).prefault("RANDOM_OPPONENT"),
});

export const ActionUseRandomItem = z.object({
  type: z.literal("use_random_item").prefault("use_random_item"),
  description: z.string().prefault("Use random item"),
  target: z.enum(AvailableTargets).prefault("RANDOM_OPPONENT"),
});

export const ActionWithHighestPowerItemEffect = z.object({
  type: z.literal("use_highest_power_item").prefault("use_highest_power_item"),
  description: z.string().prefault("Use item with given effect with highest power"),
  target: z.enum(AvailableTargets).prefault("RANDOM_OPPONENT"),
  effect: z.string().prefault("damage"),
});

export const ActionWithEffectHighestPower = z.object({
  type: z.literal("use_highest_power_action").prefault("use_highest_power_action"),
  description: z.string().prefault("Use action with given effect with highest power"),
  target: z.enum(AvailableTargets).prefault("RANDOM_OPPONENT"),
  effect: z.string().prefault("damage"),
});

export const ActionSpecificCombo = z.object({
  type: z.literal("use_combo_action").prefault("use_combo_action"),
  description: z.string().prefault("Cycly through a specific combo of jutsu & items"),
  comboIds: z.array(z.string()).prefault([]),
  target: z.enum(AvailableTargets).prefault("RANDOM_OPPONENT"),
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

export const AiActionTypes = ZodAllAiActions.options.map((o) => {
  const typeField = o.shape.type;
  const literal = typeField.unwrap(); // ZodLiteral
  return literal.value as string;
});

export type AiActionType = (typeof AiActionTypes)[number];

export type ZodAllAiAction = z.infer<typeof ZodAllAiActions>;

export const getActionSchema = (type: ZodAllAiAction["type"]) => {
  const schema = ZodAllAiActions.options.find((o) => {
    const typeField = o.shape.type;
    const literal = typeField.unwrap();
    return literal.value === type;
  });
  if (!schema) throw new Error(`No schema found for type ${type}`);
  return schema;
};

/*********************************/
/*            Rules              */
/*********************************/
export const AiRule = z.object({
  conditions: z.array(ZodAllAiConditions),
  action: ZodAllAiActions,
});

export type AiRuleType = z.infer<typeof AiRule>;

/**
 * Get a set of backup AI rules to the provided rules array.
 *
 * The rules are as follows:
 * 1. If the distance to the opponent is greater than 2, move towards the opponent.
 * 2. If the distance to the opponent is less than 2, perform an action with the highest power effect that causes damage.
 * 3. If no conditions are met, perform an action with the highest power effect
 *
 * @param rules - The array of AI rules to which the backup rules will be added.
 * @returns void
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
  const diff = detailedDiff(enforced, rules.slice(-enforced.length));
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
