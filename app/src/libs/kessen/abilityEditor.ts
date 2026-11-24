/**
 * Form description of Kessen abilities for the staff card editor. Fields, options and
 * limits are read from `kessenAbilitySchema`; only their wording lives here. Pure.
 */
import { z } from "zod";
import {
  KESSEN_ABILITY_KINDS,
  KESSEN_LEADER_ONLY_ABILITIES,
  type KessenAbility,
  type KessenAbilityKind,
  kessenAbilitySchema,
} from "@/validators/itemCard";
import { ROW_LABELS } from "./text";

/** Staff-facing name of each ability verb. */
export const ABILITY_KIND_LABELS: Record<KessenAbilityKind, string> = {
  strike: "Strike",
  empower: "Empower",
  rally: "Rally",
  bond: "Bond",
  meditate: "Meditate",
  summon: "Summon",
  infiltrator: "Infiltrator",
  revive: "Revive",
  substitution: "Substitution",
  resilient: "Resilient",
  grantResilient: "Grant Resilient",
  purge: "Purge",
  terrain: "Terrain",
  clearSkies: "Clear Skies",
  unyielding: "Unyielding",
  seal: "Seal",
  draw: "Draw",
  fence: "Fence",
  recall: "Recall",
  allHands: "All Hands",
  cycle: "Cycle",
};

/** Fields of an ability verb besides `k`, in schema order; empty for an unknown verb. */
export const abilityFields = (kind: unknown): readonly AbilityField[] =>
  (isAbilityKind(kind) && ABILITY_FIELDS.get(kind)) || [];

export const isAbilityKind = (kind: unknown): kind is KessenAbilityKind =>
  (KESSEN_ABILITY_KINDS as readonly unknown[]).includes(kind);

export const isLeaderOnlyAbility = (kind: KessenAbilityKind) =>
  (KESSEN_LEADER_ONLY_ABILITIES as readonly string[]).includes(kind);

/**
 * The ability with one field replaced; `undefined` drops an optional field. Every other
 * stored value, including keys the editor does not know, is kept as it is.
 */
export const withAbilityField = (
  ability: DraftAbility,
  name: string,
  value: unknown,
): DraftAbility => {
  const next = { ...ability, [name]: value };
  if (value === undefined) delete next[name];
  return next;
};

/**
 * A new ability of `kind`. Required fields keep the value `from` already has where the new
 * verb accepts it; the rest take the first option, the lowest amount or `group`.
 */
export const draftAbility = (
  kind: KessenAbilityKind,
  { from = {}, group = "" }: { from?: DraftAbility; group?: string } = {},
): DraftAbility => {
  const draft: DraftAbility = { k: kind };
  for (const field of abilityFields(kind)) {
    if (field.type === "flag") continue;
    const kept = from[field.name];
    if (kept !== undefined && field.schema.safeParse(kept).success)
      draft[field.name] = kept;
    else if (field.type === "amount") draft[field.name] = field.min;
    else if (field.type === "option") draft[field.name] = field.options[0]?.value;
    else draft[field.name] = group;
  }
  return draft;
};

/** Problems of one ability: by field name, and those that belong to the whole entry. */
export const abilityIssues = (ability: DraftAbility) => {
  const fields: Record<string, string> = {};
  const entry: string[] = [];
  const parsed = kessenAbilitySchema.safeParse(ability);
  if (parsed.success) return { fields, entry };
  const known = new Map(abilityFields(ability.k).map((field) => [field.name, field]));
  for (const issue of parsed.error.issues) {
    const field = known.get(String(issue.path[0]));
    if (field) fields[field.name] = fieldMessage(field);
    else if (!isAbilityKind(ability.k)) entry.push("Choose an ability");
    else entry.push(issue.message);
  }
  return { fields, entry };
};

/** The ability as the engine reads it, or null while it is incomplete. */
export const parsedAbility = (ability: DraftAbility): KessenAbility | null =>
  kessenAbilitySchema.safeParse(ability).data ?? null;

const fieldMessage = (field: AbilityField) => {
  switch (field.type) {
    case "amount":
      return `Use ${field.min} to ${field.max}`;
    case "group":
      return `Enter a group name of up to ${field.maxLength} characters`;
    default:
      return "Choose an option";
  }
};

/** Labels of the row and target options, by verb and field where they differ. */
const OPTION_LABELS: Record<string, string> = {
  ...ROW_LABELS,
  single: "One enemy unit",
  oppositeRow: "Opposite enemy row",
  chosenRow: "A chosen enemy row",
  allEnemies: "Every enemy unit",
  eachEnemyRow: "Each enemy row",
  chosen: "A chosen row",
  enemyMostUnits: "Enemy row with most units",
  chosenEnemyRow: "A chosen enemy row",
  joinRowOthers: "Others in the row it joins",
  upTo2: "Up to 2 enemy units",
  "empower.single": "One of your other units",
  "empower.ownRowOthers": "Others in its row",
  "empower.chosenRow": "One of your rows",
  "empower.allMine": "All your units",
};

const FIELD_LABELS: Record<string, string> = {
  x: "Amount",
  mode: "Target",
  row: "Row",
  group: "Group",
  sameTarget: "Hit the unit just sealed",
  ifKilled: "Only if the strike destroys",
  times: "Revive a second unit",
};

const describeField = (
  kind: KessenAbilityKind,
  name: string,
  schema: z.core.$ZodType,
): AbilityField => {
  const label = FIELD_LABELS[name];
  if (label === undefined) throw new Error(`Unlabelled ability field ${kind}.${name}`);
  if (schema instanceof z.ZodOptional) {
    const literal = schema.unwrap();
    if (literal instanceof z.ZodLiteral)
      return { name, label, schema, type: "flag", value: literal.value };
  }
  if (schema instanceof z.ZodEnum) {
    const options = schema.options.map((value) => {
      const text = OPTION_LABELS[`${kind}.${value}`] ?? OPTION_LABELS[value];
      if (text === undefined) throw new Error(`Unlabelled option ${kind}.${value}`);
      return { value: String(value), label: text };
    });
    return { name, label, schema, type: "option", options };
  }
  if (schema instanceof z.ZodNumber)
    return {
      name,
      label,
      schema,
      type: "amount",
      min: schema.minValue ?? 0,
      max: schema.maxValue ?? Number.MAX_SAFE_INTEGER,
    };
  if (schema instanceof z.ZodString)
    return { name, label, schema, type: "group", maxLength: schema.maxLength ?? 191 };
  throw new Error(`No control for ability field ${kind}.${name}`);
};

const ABILITY_FIELDS: ReadonlyMap<string, readonly AbilityField[]> = new Map(
  kessenAbilitySchema.options.map((option) => {
    const { k, ...shape } = option.shape;
    return [
      k.value,
      Object.entries(shape).map(([name, schema]) =>
        describeField(k.value, name, schema),
      ),
    ];
  }),
);

/** An ability while it is edited: any stored or half-entered value. */
export type DraftAbility = Record<string, unknown>;

export type AbilityField = { name: string; label: string; schema: z.ZodType } & (
  | { type: "amount"; min: number; max: number }
  | { type: "group"; maxLength: number }
  | { type: "option"; options: { value: string; label: string }[] }
  | { type: "flag"; value: unknown }
);
