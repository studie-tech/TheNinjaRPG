import type { ContentProposalEntityType } from "@/drizzle/constants";
import { ENTITY_CONFIG } from "./entities";
import { getAtPath, setAtPath, topLevelField } from "./paths";
import { sameValue } from "./version";

/**
 * Reason the audit may not turn `before` into `after`, or null. Reputation points and seichi
 * silver stay with staff wherever they appear: as a price, or as a reward of a quest or a
 * consumable item. A new entity is checked against no fields, so a draft cannot bring any.
 */
export const agentChangeViolation = (
  before: Record<string, unknown>,
  after: Record<string, unknown>,
) => {
  const was = protectedAmounts(before);
  const now = protectedAmounts(after);
  const changed = [...new Set([...was.keys(), ...now.keys()])].find(
    (path) => was.get(path) !== now.get(path),
  );
  return changed
    ? `${changed}: reputation points and seichi silver are off limits for the audit`
    : null;
};

/**
 * Apply field assignments in order to a copy of an entity's editable fields. Returns the
 * result, or the reason for the first assignment that cannot be made, such as a path outside
 * the editable fields.
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

/**
 * Top-level fields whose values differ, with their before and after values; a field missing
 * on one side reads as null there.
 */
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

/** Non-zero reputation point and seichi silver amounts in the fields, by dotted path. */
const protectedAmounts = (fields: Record<string, unknown>) => {
  const found = new Map<string, number>();
  const walk = (node: unknown, path: string) => {
    if (Array.isArray(node)) {
      for (const [index, entry] of node.entries()) walk(entry, `${path}.${index}`);
    } else if (node && typeof node === "object") {
      for (const [key, value] of Object.entries(node)) {
        const at = path ? `${path}.${key}` : key;
        if (!AGENT_PROTECTED_KEYS.has(key)) walk(value, at);
        else if (Number(value)) found.set(at, Number(value));
      }
    }
  };
  walk(fields, "");
  return found;
};

/** Keys that hold an amount of reputation points or seichi silver, as a price or a reward. */
const AGENT_PROTECTED_KEYS = new Set([
  "repsCost",
  "seichiSilverCost",
  "reward_reputation",
  "reward_seichi_silver",
]);

/** One field assignment: a dotted path into the editable fields and the value to write. */
export type SetOperation = { path: string; value: unknown };
