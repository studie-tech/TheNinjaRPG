import type { ContentProposalEntityType, QuestType } from "@/drizzle/constants";
import { ObjectiveReward } from "@/validators/rewards";
import { ENTITY_CONFIG } from "./entities";
import { getAtPath, setAtPath, topLevelField } from "./paths";
import { canonicalJson, sameValue } from "./version";

/** Every `reward_*` value inside a quest's content, as one comparable string. */
export const questRewardSignature = (content: unknown) => {
  const found: [string, unknown][] = [];
  const walk = (node: unknown, path: string) => {
    if (Array.isArray(node)) {
      for (const [index, entry] of node.entries()) walk(entry, `${path}.${index}`);
    } else if (node && typeof node === "object") {
      for (const [key, value] of Object.entries(node)) {
        if (key.startsWith("reward_")) found.push([`${path}.${key}`, value]);
        else walk(value, `${path}.${key}`);
      }
    }
  };
  walk(content, "content");
  return canonicalJson(found.sort(([a], [b]) => a.localeCompare(b)));
};

/**
 * Reason the audit may not make this change, or null. Economy values (prices, rewards,
 * loot), visibility and a few structural fields stay with staff.
 */
export const agentChangeViolation = (
  entityType: ContentProposalEntityType,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
) => {
  const config = ENTITY_CONFIG[entityType];
  for (const field of Object.keys(after)) {
    if (
      config.agentProtected.includes(field) &&
      !sameValue(before[field], after[field])
    ) {
      return `${config.label} field ${field} is off limits for the audit`;
    }
  }
  if (
    entityType === "QUEST" &&
    "content" in after &&
    questRewardSignature(before.content) !== questRewardSignature(after.content)
  ) {
    return "Quest rewards are off limits for the audit";
  }
  return null;
};

/**
 * A new entity drafted by the audit starts hidden and free, without loot, a recipe or
 * rewards, whatever the draft says: staff price and release it after approving it. Returns
 * the draft with those fields reset, or the reason it cannot be drafted at all.
 */
export const withCreateBaseline = (
  entityType: ContentProposalEntityType,
  editable: Record<string, unknown>,
): { ok: true; editable: Record<string, unknown> } | { ok: false; reason: string } => {
  if (entityType === "GAME_ASSET") {
    return { ok: false, reason: "New assets come from media candidates, not drafts" };
  }
  if (
    entityType === "QUEST" &&
    !DRAFTABLE_QUEST_TYPES.includes(editable.questType as QuestType)
  ) {
    return {
      ok: false,
      reason: `New ${String(editable.questType)} quests are for staff to set up`,
    };
  }
  const next = { ...editable };
  for (const field of ENTITY_CONFIG[entityType].agentProtected) {
    if (field in CREATE_BASELINE) next[field] = CREATE_BASELINE[field];
  }
  if ("content" in next) next.content = withoutRewards(next.content);
  return { ok: true, editable: next };
};

export type SetOperation = { path: string; value: unknown };

/**
 * Apply field assignments to an entity's editable fields. Returns the new editable fields,
 * or a reason when a path does not name an editable field.
 */
export const applySetOperations = (
  entityType: ContentProposalEntityType,
  editable: Record<string, unknown>,
  operations: SetOperation[],
): { ok: true; editable: Record<string, unknown> } | { ok: false; reason: string } => {
  const config = ENTITY_CONFIG[entityType];
  let next = editable;
  for (const operation of operations) {
    const field = topLevelField(operation.path);
    if (!config.editableKeys.includes(field)) {
      return { ok: false, reason: `${config.label} has no editable field ${field}` };
    }
    if (operation.path !== field && getAtPath(next, field) === undefined) {
      return { ok: false, reason: `${config.label} field ${field} is empty` };
    }
    try {
      next = setAtPath(next, operation.path, operation.value);
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }
  return { ok: true, editable: next };
};

/** Top-level fields whose values differ, with their before and after values. */
export const changedFields = (
  before: Record<string, unknown>,
  after: Record<string, unknown>,
) => {
  const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
    (field) => !sameValue(before[field], after[field]),
  );
  return {
    before: Object.fromEntries(fields.map((field) => [field, before[field] ?? null])),
    after: Object.fromEntries(fields.map((field) => [field, after[field] ?? null])),
  };
};

/** Protected fields of a new audit draft, as it starts before staff price and release it. */
const CREATE_BASELINE: Record<string, unknown> = {
  hidden: true,
  extraBaseCost: 0,
  cost: 0,
  repsCost: 0,
  seichiSilverCost: 0,
  inShop: false,
  isEventItem: false,
  expireFromStoreAt: null,
  farmSellValue: 0,
  farmYieldItemId: null,
  farmExtractSeedItemId: null,
  farmExtractSeedCount: 0,
  craftingRequirements: [],
  items: [],
  tierLevel: null,
};

/** Quest types the audit may draft; the others rank players up, run on schedules or teach. */
const DRAFTABLE_QUEST_TYPES: QuestType[] = [
  "mission",
  "errand",
  "crime",
  "story",
  "medical",
  "hunting",
  "gathering",
];

const EMPTY_REWARD: Record<string, unknown> = ObjectiveReward.parse({});

/** The same content with every `reward_*` value emptied, and unknown ones dropped. */
const withoutRewards = (node: unknown): unknown => {
  if (Array.isArray(node)) return node.map(withoutRewards);
  if (!node || typeof node !== "object") return node;
  return Object.fromEntries(
    Object.entries(node).flatMap(([key, value]) => {
      if (!key.startsWith("reward_")) return [[key, withoutRewards(value)]];
      return key in EMPTY_REWARD ? [[key, EMPTY_REWARD[key]]] : [];
    }),
  );
};
