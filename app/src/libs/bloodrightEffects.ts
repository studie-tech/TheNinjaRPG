import type { BloodrightOption, Jutsu } from "@/drizzle/schema";
import { JUTSU_EFFECT_COSMETICS } from "@/libs/jutsu/reskins";
import type {
  BloodrightAppliedChange,
  BloodrightChange,
} from "@/validators/bloodright";
import { AllTags, type ZodAllTags } from "@/validators/combat";

/** Resolve schema defaults for historical tags before comparing or increasing their values. */
export const normalizeBloodrightTag = (value: unknown): ZodAllTags | null => {
  const parsed = AllTags.safeParse(value);
  return parsed.success ? parsed.data : null;
};

/** List every numeric tag field, including nested values and array entries. */
export const bloodrightNumericFields = (value: unknown, prefix = ""): string[] => {
  if (typeof value === "number" && Number.isFinite(value)) return [prefix];
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) =>
    bloodrightNumericFields(child, prefix ? `${prefix}.${key}` : key),
  );
};

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${key}:${canonical(child)}`)
      .join(",")}}`;
  return JSON.stringify(value);
};

/** A changed or reordered source tag requires staff to reselect the tag. */
export const isBloodrightCurrent = (
  changes: BloodrightChange[],
  effects: ZodAllTags[],
) =>
  changes.length > 0 &&
  changes.every((change) => {
    const tag = normalizeBloodrightTag(effects[change.tagIndex]);
    const snapshot = normalizeBloodrightTag(change.tag);
    return (
      tag &&
      snapshot &&
      canonical(tag) === canonical(snapshot) &&
      bloodrightNumericFields(tag).includes(change.field)
    );
  });

/** Apply flat increases first, then summed percentages, to each original numeric value. */
export const applyBloodrightChanges = (
  effects: ZodAllTags[],
  changes: (BloodrightChange | BloodrightAppliedChange)[],
) => {
  const result: ZodAllTags[] = [];
  for (const effect of effects) {
    const tag = normalizeBloodrightTag(effect);
    if (!tag) return null;
    result.push(tag);
  }
  const groups = new Map<string, (BloodrightChange | BloodrightAppliedChange)[]>();
  for (const change of changes) {
    const key = `${change.tagIndex}:${change.field}`;
    groups.set(key, [...(groups.get(key) ?? []), change]);
  }
  for (const group of groups.values()) {
    const first = group[0];
    if (!first) continue;
    const tag = result[first.tagIndex];
    if (
      !tag ||
      tag.type !== ("tag" in first ? first.tag.type : first.tagType) ||
      !bloodrightNumericFields(tag).includes(first.field)
    )
      return null;
    const parts = first.field.split(".");
    let target: Record<string, unknown> = tag as unknown as Record<string, unknown>;
    for (const part of parts.slice(0, -1))
      target = target[part] as Record<string, unknown>;
    const key = parts.at(-1);
    if (!key) return null;
    const base = target[key] as number;
    const flat = group
      .filter((change) => change.mode === "FLAT")
      .reduce((sum, change) => sum + change.value, 0);
    const percent = group
      .filter((change) => change.mode === "PERCENT")
      .reduce((sum, change) => sum + change.value, 0);
    const value = (base + flat) * (1 + percent / 100);
    if (!Number.isFinite(value) || value < base) return null;
    target[key] = value;
  }
  // Rounds, chance and other constrained values must retain the tag's contract.
  return result.every((tag) => AllTags.safeParse(tag).success) ? result : null;
};

export type BloodrightJutsuIdentity = Pick<
  Jutsu,
  "id" | "parentJutsuId" | "reskinParentJutsuId"
>;

/** Resolve ancestors in memory, including both evolution and mechanics inheritance. */
const bloodrightJutsuAncestors = (
  id: string,
  byId: Map<string, BloodrightJutsuIdentity>,
) => {
  const found = new Set<string>();
  const pending = [id];
  while (pending.length) {
    const next = pending.pop();
    if (!next) continue;
    if (found.has(next)) continue;
    found.add(next);
    const entry = byId.get(next);
    if (entry?.parentJutsuId) pending.push(entry.parentJutsuId);
    if (entry?.reskinParentJutsuId) pending.push(entry.reskinParentJutsuId);
  }
  return found;
};

/** Match descendant tags by their nonnumeric mechanics; ambiguous matches stay inactive. */
export const inheritBloodrightChanges = (
  sourceId: string,
  target: Pick<Jutsu, "id" | "effects">,
  changes: BloodrightChange[],
) => {
  if (sourceId === target.id)
    return isBloodrightCurrent(changes, target.effects) ? changes : null;
  const mechanics = (value: unknown): unknown => {
    if (typeof value === "number") return "numeric";
    if (Array.isArray(value)) return value.map(mechanics);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !JUTSU_EFFECT_COSMETICS.some((cosmetic) => cosmetic === key))
        .map(([key, child]) => [key, mechanics(child)]),
    );
  };
  const result: BloodrightChange[] = [];
  for (const change of changes) {
    const matches = target.effects.flatMap((tag, index) =>
      canonical(mechanics(normalizeBloodrightTag(tag))) ===
      canonical(mechanics(normalizeBloodrightTag(change.tag)))
        ? [index]
        : [],
    );
    const tagIndex = matches[0];
    if (matches.length !== 1 || tagIndex === undefined) return null;
    result.push({ ...change, tagIndex });
  }
  return result;
};

/** Validate all selected options on each applicable descendant before claiming a purchase. */
export const validateBloodrightSelection = (
  jutsus: Pick<Jutsu, "id" | "effects">[],
  options: (BloodrightOption & { jutsu: Pick<Jutsu, "effects"> | null })[],
  catalog: BloodrightJutsuIdentity[],
) => {
  const byId = new Map(catalog.map((entry) => [entry.id, entry]));
  return jutsus.every((target) => {
    const ancestors = bloodrightJutsuAncestors(target.id, byId);
    const changes = options
      .filter(
        (option) =>
          ancestors.has(option.jutsuId) &&
          option.jutsu &&
          isBloodrightCurrent(option.changes, option.jutsu.effects),
      )
      .flatMap(
        (option) =>
          inheritBloodrightChanges(option.jutsuId, target, option.changes) ?? [],
      );
    return !changes.length || !!applyBloodrightChanges(target.effects, changes);
  });
};

/** Derive an actor's jutsu effects without changing the shared battle catalog. */
export const buildBloodrightChanges = (
  jutsus: Pick<Jutsu, "id" | "effects">[],
  options: (BloodrightOption & { jutsu: Pick<Jutsu, "effects"> | null })[],
  catalog: BloodrightJutsuIdentity[],
): Record<string, BloodrightAppliedChange[]> => {
  const result: Record<string, BloodrightAppliedChange[]> = {};
  const byId = new Map(catalog.map((entry) => [entry.id, entry]));
  // The last catalog copy is authoritative when initiation loaded the same jutsu twice.
  for (const jutsu of new Map(jutsus.map((entry) => [entry.id, entry])).values()) {
    const ancestors = bloodrightJutsuAncestors(jutsu.id, byId);
    const changes = options
      .filter(
        (option) =>
          ancestors.has(option.jutsuId) &&
          option.jutsu &&
          isBloodrightCurrent(option.changes, option.jutsu.effects),
      )
      .flatMap(
        (option) =>
          inheritBloodrightChanges(option.jutsuId, jutsu, option.changes) ?? [],
      );
    if (!changes.length) continue;
    const effects = applyBloodrightChanges(jutsu.effects, changes);
    if (effects)
      result[jutsu.id] = changes.map(({ tag, ...change }) => ({
        ...change,
        tagType: tag.type,
      }));
  }
  return result;
};
