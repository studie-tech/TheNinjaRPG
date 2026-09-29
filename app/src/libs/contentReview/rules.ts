import type {
  ContentProposalEntityType,
  ContentProposalMediaKind,
} from "@/drizzle/constants";
import { ENTITY_CONFIG } from "./entities";
import { getAtPath, setAtPath, topLevelField } from "./paths";
import { canonicalJson, sameValue } from "./version";

/** Effect fields that reference a GameAsset of the matching kind. */
const MEDIA_FIELDS: Record<ContentProposalMediaKind, readonly string[]> = {
  SFX: ["appearSfx", "disappearSfx"],
  ANIMATION: ["appearAnimation", "staticAnimation", "disappearAnimation"],
  IMAGE: ["image", "avatar"],
};

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

/** Whether `path` names a field a media candidate of `kind` may fill. */
export const isMediaPath = (kind: ContentProposalMediaKind, path: string) => {
  const last = path.split(".").pop() ?? "";
  return MEDIA_FIELDS[kind].includes(last);
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
