import { Filter, X } from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/app/_trpc/client";
import { TriStateToggle } from "@/components/control/Toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MultiSelect } from "@/components/ui/multi-select";
import { NumberInput } from "@/components/ui/number-input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { BattleType } from "@/drizzle/constants";
import { BattleTypes } from "@/drizzle/constants";
import { canChangeContent } from "@/utils/permissions";
import { useUserData } from "@/utils/UserContext";

/**
 * Generic, type-safe filtering system.
 *
 * This module lets feature pages declare a schema that defines:
 * - What fields exist (text/number/select/multi/tri-state)
 * - Optional exclusion categories
 * - Defaults, option sources, visibility rules, and normalization
 *
 * From that single schema it derives:
 * - Strongly-typed values, debounced values, and setters
 * - A reusable UI component
 * - A buildFilter helper to emit API-ready filters
 *
 * Key guarantees:
 * - No hooks-in-loops (one state map, one debounce over the typed inputs)
 * - Field keys and value unions are inferred from the schema (no any/unknown)
 */

/** Discrete UI option for (single|multi)-select fields */
export type Option<V extends string = string> = { value: V; label: string };

/** Built-in option lists a select field can load instead of static options */
export type FilteringDataSource =
  | "bloodlines"
  | "assets"
  | "villages"
  | "referralSources"
  | "visitorUtmSources";

// Field config types (discriminated unions ensure correct value types)

/** Members every field shares; `T` discriminates the field and `V` is its value. */
interface BaseFieldConfig<Id extends string, T extends string, V> {
  id: Id;
  label: string;
  type: T;
  defaultValue: V;
  filterKey?: string;
  doubleWidth?: boolean;
  countActive?: (value: V) => number;
  normalizeForFilter?: (value: V) => unknown;
  visibleIf?: (ctx?: unknown) => boolean;
}

/** Free-text input */
export type TextFieldConfig<Id extends string> = BaseFieldConfig<Id, "text", string>;

/** Date input (string yyyy-mm-dd) */
export type DateFieldConfig<Id extends string> = BaseFieldConfig<Id, "date", string>;

/**
 * Numeric input (undefined considered empty).
 *
 * Bounds should mirror the endpoint's input validator. Stepping down from a blank input
 * starts at 0, so without `min` a single click or arrow key produces -1. Values outside
 * the bounds stay editable, but are treated as empty and never reach the API.
 */
export interface NumberFieldConfig<Id extends string>
  extends BaseFieldConfig<Id, "number", number | undefined> {
  /** Lowest accepted value; defaults to 0 since no content filter takes negatives. */
  min?: number;
  /** Highest accepted value; unbounded when omitted. */
  max?: number;
}

/** Single-select (supports an optional sentinel 'none' value) */
export interface SingleSelectFieldConfig<
  Id extends string,
  V extends string,
  NV extends string = never,
> extends BaseFieldConfig<Id, "single-select", V | NV> {
  options?: Option<V>[];
  dataSource?: FilteringDataSource;
  filterOptions?: (options: Option<string>[], ctx?: unknown) => Option<string>[];
  includeNone?: boolean;
  noneOption?: Option<NV>;
  emptyValues?: ReadonlyArray<V | NV> | (V | NV)[];
}

/** Multi-select (empty array is considered empty) */
export interface MultiSelectFieldConfig<Id extends string, V extends string>
  extends BaseFieldConfig<Id, "multi-select", V[]> {
  options?: Option<V>[];
  dataSource?: FilteringDataSource;
  filterOptions?: (options: Option<string>[], ctx?: unknown) => Option<string>[];
  includeNone?: boolean;
  noneOption?: Option<string>;
  emptyValues?: never;
}

/** Tri-state toggle (undefined represents "All") */
export interface TriStateFieldConfig<Id extends string>
  extends BaseFieldConfig<Id, "tri-state", boolean | undefined> {
  triStateLabels?: { labelActive: string; labelInactive: string; labelAll: string };
}

export type AnyFieldConfig<Id extends string = string> =
  | TextFieldConfig<Id>
  | DateFieldConfig<Id>
  | NumberFieldConfig<Id>
  | SingleSelectFieldConfig<Id, string, string>
  | MultiSelectFieldConfig<Id, string>
  | TriStateFieldConfig<Id>;

/** Exclusion list config (each is a separate category) */
export interface ExclusionCategoryConfig<Key extends string = string> {
  key: Key;
  label: string;
  options: string[];
  filterKey?: string; // if omitted, uses key
}

/** Full schema that defines a filter UI and type-inferred state */
export interface FilteringSchema<
  F extends readonly AnyFieldConfig[],
  E extends readonly ExclusionCategoryConfig<string>[] | undefined =
    | readonly ExclusionCategoryConfig<string>[]
    | undefined,
> {
  fields: F;
  exclusions?: E;
}

/**
 * Helper that preserves literal field ids/unions when authoring schemas.
 * Usage: defineFilteringSchema({ fields: [...] as const, exclusions: [...] as const })
 */
export function defineFilteringSchema<
  const F extends readonly AnyFieldConfig[],
  const E extends readonly ExclusionCategoryConfig<string>[] | undefined,
>(schema: { fields: F; exclusions?: E }) {
  return schema as unknown as FilteringSchema<F, E>;
}

/** Convenience: map a string union/tuple into options */
export const toOptions = <T extends readonly string[]>(arr: T): Option<T[number]>[] =>
  arr.map((x) => ({ value: x, label: x })) as Option<T[number]>[];

// ---------- Shared fields ----------

/** Minimum row count for statistics; anything below 1 sends no minimum. */
export const minCountField = {
  id: "minCount",
  label: "Minimum Count",
  type: "number",
  defaultValue: undefined,
  normalizeForFilter: (value: number | undefined) =>
    value !== undefined && value >= 1 ? value : undefined,
} as const satisfies NumberFieldConfig<"minCount">;

/** Battle type multi-select starting from `defaultValue`. */
export const battleTypesField = (defaultValue: BattleType[]) =>
  ({
    id: "battleTypes",
    label: "Battle Types",
    type: "multi-select",
    defaultValue,
    options: toOptions(BattleTypes),
  }) as const satisfies MultiSelectFieldConfig<"battleTypes", BattleType>;

/** Hidden-content toggle, shown to viewers `useContentEditContext` reports as editors. */
export const hiddenVisibilityField = (defaultValue?: boolean) =>
  ({
    id: "hidden",
    label: "Visibility",
    type: "tri-state",
    defaultValue,
    visibleIf: (ctx?: unknown) =>
      Boolean((ctx as ContentEditContext | undefined)?.canEdit),
    triStateLabels: {
      labelActive: "Hidden",
      labelInactive: "Visible",
      labelAll: "All Visibility",
    },
  }) as const satisfies TriStateFieldConfig<"hidden">;

/** `ContentFiltering` context telling content editors from players. */
export const useContentEditContext = (): ContentEditContext => {
  const { data: userData } = useUserData();
  return { canEdit: Boolean(userData && canChangeContent(userData.role)) };
};

// ---------- Derived Types ----------

// Compute the value type for a given field variant
type FieldValueFromField<F> =
  F extends TextFieldConfig<any>
    ? string
    : F extends DateFieldConfig<any>
      ? string
      : F extends NumberFieldConfig<any>
        ? number | undefined
        : F extends SingleSelectFieldConfig<any, infer V, infer NV>
          ? V | NV
          : F extends MultiSelectFieldConfig<any, infer V>
            ? V[]
            : F extends TriStateFieldConfig<any>
              ? boolean | undefined
              : never;

// Map field ids to their value types, based on the schema
type ValuesFromSchema<F extends readonly AnyFieldConfig[]> = {
  [K in F[number] as K["id"]]: FieldValueFromField<K>;
};

// Map field ids to setters with the correct setter type
type SettersFromSchema<F extends readonly AnyFieldConfig[]> = {
  [K in F[number] as K["id"]]: React.Dispatch<
    React.SetStateAction<FieldValueFromField<K>>
  >;
};

// Exclusion maps
type ExcludedFromSchema<
  E extends readonly ExclusionCategoryConfig<string>[] | undefined,
> = E extends readonly ExclusionCategoryConfig<string>[]
  ? {
      [K in E[number] as K["key"]]: string[];
    }
  : Record<string, never>;

type ExcludedSettersFromSchema<
  E extends readonly ExclusionCategoryConfig<string>[] | undefined,
> = E extends readonly ExclusionCategoryConfig<string>[]
  ? {
      [K in E[number] as K["key"]]: React.Dispatch<React.SetStateAction<string[]>>;
    }
  : Record<string, never>;

/** Fully-typed filter state, derived from a schema */
export interface ContentFilteringState<
  F extends readonly AnyFieldConfig[] = readonly AnyFieldConfig[],
  E extends readonly ExclusionCategoryConfig<string>[] | undefined =
    | readonly ExclusionCategoryConfig<string>[]
    | undefined,
> {
  values: ValuesFromSchema<F>;
  debounced: ValuesFromSchema<F>;
  setters: SettersFromSchema<F>;
  excluded: ExcludedFromSchema<E>;
  debouncedExcluded: ExcludedFromSchema<E>;
  setExcluded: ExcludedSettersFromSchema<E>;
}

/** Debounce delay for free-typing filter changes */
const DEBOUNCE_MS = 500;

const isTypingField = (field: AnyFieldConfig) =>
  field.type === "text" || field.type === "number" || field.type === "date";

/**
 * Hook: derives typed state maps (values, debounced, setters, exclusions) from a schema.
 * - Uses single state objects and one timer (no hooks-in-loops)
 * - Text, number and date inputs apply together once none has changed for DEBOUNCE_MS;
 *   discrete choices apply immediately
 */
export const useContentFiltering = <
  F extends readonly AnyFieldConfig[],
  E extends readonly ExclusionCategoryConfig<string>[] | undefined =
    | readonly ExclusionCategoryConfig<string>[]
    | undefined,
>(
  schema: FilteringSchema<F, E>,
): ContentFilteringState<F, E> => {
  // Build initial maps from schema defaults
  const initialValues = useMemo(() => {
    const obj = {} as ValuesFromSchema<F>;
    for (const field of schema.fields) {
      (obj as Record<string, unknown>)[field.id] = field.defaultValue as unknown;
    }
    return obj;
  }, [schema]);

  const [{ values, debounced }, setFieldState] = useState({
    values: initialValues,
    debounced: initialValues,
  });

  // Keep values in sync if schema changes
  useEffect(() => {
    setFieldState((prev) =>
      prev.values === initialValues && prev.debounced === initialValues
        ? prev
        : { values: initialValues, debounced: initialValues },
    );
  }, [initialValues]);

  // Any change restarts the timer; when it fires, every typed input applies at once.
  useEffect(() => {
    const timer = setTimeout(() => {
      setFieldState((prev) => {
        let next = prev.debounced;
        for (const field of schema.fields) {
          if (!isTypingField(field)) continue;
          const key = field.id as keyof ValuesFromSchema<F> & string;
          if (next[key] !== values[key]) next = { ...next, [key]: values[key] };
        }
        return next === prev.debounced ? prev : { ...prev, debounced: next };
      });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [schema.fields, values]);

  // Generate typed setters (stable across renders for the same schema)
  const setters = useMemo(() => {
    const out = {} as SettersFromSchema<F>;
    for (const field of schema.fields) {
      const id = field.id as keyof ValuesFromSchema<F> & string;
      (out as Record<string, React.Dispatch<React.SetStateAction<unknown>>>)[id] = (
        updater,
      ) => {
        setFieldState((prev) => {
          const current = prev.values[id];
          const next =
            typeof updater === "function"
              ? (updater as (p: typeof current) => typeof current)(current)
              : updater;
          return current === next
            ? prev
            : {
                values: { ...prev.values, [id]: next } as ValuesFromSchema<F>,
                // Resolve functional updaters once so both maps share the same selection.
                debounced: isTypingField(field)
                  ? prev.debounced
                  : ({ ...prev.debounced, [id]: next } as ValuesFromSchema<F>),
              };
        });
      };
    }
    return out;
  }, [schema.fields]);

  // Exclusions are discrete choices, so their displayed and applied values are identical.
  const initialExcluded = useMemo(() => {
    const obj = {} as ExcludedFromSchema<E>;
    if (schema.exclusions) {
      for (const cat of schema.exclusions) {
        (obj as Record<string, string[]>)[cat.key] = [];
      }
    }
    return obj;
  }, [schema.exclusions]);

  const [excluded, setExcludedState] = useState<ExcludedFromSchema<E>>(initialExcluded);

  useEffect(() => {
    setExcludedState(initialExcluded);
  }, [initialExcluded]);

  const setExcluded = useMemo(() => {
    const out = {} as ExcludedSettersFromSchema<E>;
    if (schema.exclusions) {
      for (const cat of schema.exclusions) {
        const key = cat.key as keyof ExcludedFromSchema<E> & string;
        (out as Record<string, React.Dispatch<React.SetStateAction<string[]>>>)[key] = (
          updater,
        ) => {
          setExcludedState((prev) => {
            const current = (prev as Record<string, string[]>)[key] ?? [];
            const next =
              typeof updater === "function"
                ? (updater as (p: string[]) => string[])(current)
                : updater;
            return current === next
              ? prev
              : ({ ...prev, [key]: next } as ExcludedFromSchema<E>);
          });
        };
      }
    }
    return out;
  }, [schema.exclusions]);

  return {
    values,
    debounced,
    setters,
    excluded,
    debouncedExcluded: excluded,
    setExcluded,
  };
};

/**
 * Build a filter payload from debounced values and the schema.
 * - Omits empty values based on field type and optional emptyValues
 * - Applies normalizeForFilter if provided
 * - Adds exclusions if any are non-empty
 */
/** Whether a field's value leaves the filter off, per its type and `emptyValues`. */
const isFieldEmpty = (field: AnyFieldConfig, value: unknown) => {
  if (field.type === "multi-select") return !Array.isArray(value) || value.length === 0;
  if (field.type === "text" || field.type === "date")
    return typeof value !== "string" || value.length === 0;
  if (field.type === "tri-state") return value === undefined;
  if (field.type === "number") return !Number.isFinite(value);
  if (
    "emptyValues" in field &&
    Array.isArray(field.emptyValues) &&
    (field.emptyValues as unknown[]).includes(value)
  )
    return true;
  return !value;
};

export const buildFilter = <
  F extends readonly AnyFieldConfig[],
  E extends readonly ExclusionCategoryConfig<string>[] | undefined =
    | readonly ExclusionCategoryConfig<string>[]
    | undefined,
>(
  state: ContentFilteringState<F, E>,
  schema: FilteringSchema<F, E>,
) => {
  const filter: Record<string, unknown> = {};

  for (const field of schema.fields) {
    const outKey = "filterKey" in field && field.filterKey ? field.filterKey : field.id;
    const id = field.id as keyof ValuesFromSchema<F> & string;
    const debouncedValue = state.debounced[id];

    if (!isFieldEmpty(field, debouncedValue)) {
      const normalized =
        "normalizeForFilter" in field && field.normalizeForFilter
          ? field.normalizeForFilter(debouncedValue as never)
          : debouncedValue;
      filter[outKey] = normalized;
    }
  }

  if (schema.exclusions) {
    for (const cat of schema.exclusions) {
      const key = cat.filterKey ?? cat.key;
      const arr = (state.debouncedExcluded as Record<string, string[]>)[cat.key] || [];
      if (arr.length > 0) filter[key] = arr;
    }
  }

  return filter;
};

// ---------- UI ----------

const FilterSelect: React.FC<{
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  options: Option[];
  includeNone?: boolean;
  noneOption?: Option;
  disabled?: boolean;
}> = ({
  label,
  value,
  onValueChange,
  options,
  includeNone = true,
  noneOption,
  disabled,
}) => {
  const resolvedNone = noneOption ?? { value: "None", label: "None" };
  return (
    <div>
      <Label>{label}</Label>
      <Select onValueChange={onValueChange} value={value} disabled={disabled}>
        <SelectTrigger disabled={disabled}>
          <SelectValue>
            {options.find((opt) => opt.value === value)?.label ||
              (includeNone ? resolvedNone.label : "")}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {includeNone && (
            <SelectItem key={resolvedNone.value} value={resolvedNone.value}>
              {resolvedNone.label}
            </SelectItem>
          )}
          {options.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};

const ExcludedItemsList: React.FC<{
  title: string;
  items: string[];
  onRemove: (item: string) => void;
  disabled?: boolean;
}> = ({ title, items, onRemove, disabled }) => {
  if (items.length === 0) return null;
  return (
    <p className="mt-2 text-sm">
      <strong>{title}:</strong>{" "}
      {items.map((item, i) => (
        <span key={`${item}-${i}`} className="mr-2 inline-flex items-center">
          {item}
          <Button
            variant="destructive"
            size="sm"
            disabled={disabled}
            className="ml-1 px-2"
            onClick={() => onRemove(item)}
          >
            <X className="h-4 w-4" />
          </Button>
        </span>
      ))}
    </p>
  );
};

/**
 * Generic filtering UI.
 * Renders controls based on the provided schema and updates the given state maps.
 */
export const ContentFiltering = <
  F extends readonly AnyFieldConfig[],
  E extends readonly ExclusionCategoryConfig<string>[] | undefined =
    | readonly ExclusionCategoryConfig<string>[]
    | undefined,
>({
  schema,
  state,
  context,
  triggerButtonId = "filter-generic",
  popoverClassName,
  disabled = false,
}: {
  schema: FilteringSchema<F, E>;
  state: ContentFilteringState<F, E>;
  context?: unknown;
  triggerButtonId?: string;
  popoverClassName?: string;
  disabled?: boolean;
}) => {
  // Local UI state
  const [filterOpen, setFilterOpen] = useState(false);
  const [showExclusionPopover, setShowExclusionPopover] = useState(false);
  const [exclusionCategoryKey, setExclusionCategoryKey] = useState<string>(
    schema.exclusions?.[0]?.key ?? "",
  );
  const [tempExclusions, setTempExclusions] = useState<string[]>([]);

  useEffect(() => {
    if (disabled) setFilterOpen(false);
  }, [disabled]);

  // Apply visibleIf guards at render-time
  const fieldsToRender = schema.fields.filter((f) =>
    f.visibleIf ? f.visibleIf(context) : true,
  );

  // Determine which dynamic data sources are needed by the currently visible fields
  const needsDataSource = useMemo(() => {
    const mutableRequired: Record<FilteringDataSource, boolean> = {
      bloodlines: false,
      assets: false,
      villages: false,
      referralSources: false,
      visitorUtmSources: false,
    };
    for (const field of fieldsToRender) {
      if (!("dataSource" in field) || !field.dataSource) continue;
      const hasStaticOptions =
        "options" in field && Array.isArray(field.options) && field.options.length > 0;
      if (hasStaticOptions) continue;
      mutableRequired[field.dataSource] = true;
    }
    return mutableRequired;
  }, [fieldsToRender]);

  // Built-in data sources (queries are always called but only enabled when needed)
  const { data: bloodlineNames } = api.bloodline.getAllNames.useQuery(undefined, {
    enabled: needsDataSource.bloodlines,
  });
  const { data: assetNames } = api.misc.getAllGameAssetNames.useQuery(undefined, {
    enabled: needsDataSource.assets,
  });
  const { data: villageNames } = api.village.getAllNames.useQuery(undefined, {
    enabled: needsDataSource.villages,
  });
  const { data: referralSources } = api.data.getReferralSources.useQuery(undefined, {
    enabled: needsDataSource.referralSources,
  });
  const { data: utmSources } = api.data.getVisitorUtmSources.useQuery(undefined, {
    enabled: needsDataSource.visitorUtmSources,
  });

  const dataSourceOptions: Record<FilteringDataSource, Option[]> = {
    bloodlines: (bloodlineNames ?? []).map((b) => ({ value: b.id, label: b.name })),
    assets: (assetNames ?? []).map((a) => ({ value: a.id, label: a.name })),
    villages: (villageNames ?? []).map((v) => ({ value: v.id, label: v.name })),
    referralSources: (referralSources ?? []).map((s) => ({ value: s, label: s })),
    visitorUtmSources: (utmSources ?? []).map((s) => ({ value: s, label: s })),
  };

  // Resolve options for a field: prefer static options, otherwise derive from data source
  const resolveOptions = (field: AnyFieldConfig): Option[] => {
    let opts: Option[] | undefined = "options" in field ? field.options : undefined;
    if (!opts && "dataSource" in field && field.dataSource) {
      opts = dataSourceOptions[field.dataSource];
    }
    const finalOpts = opts ?? [];
    return "filterOptions" in field && field.filterOptions
      ? field.filterOptions(finalOpts, context)
      : finalOpts;
  };

  // Compute # of active filters for the badge on the trigger button
  const computeCount = () => {
    let total = 0;
    for (const field of fieldsToRender) {
      const id = field.id as keyof ContentFilteringState<F, E>["values"] & string;
      const val = state.values[id];
      if ("countActive" in field && field.countActive) {
        total += (field.countActive as (v: unknown) => number)(val);
        continue;
      }
      if (isFieldEmpty(field, val)) continue;
      total += field.type === "multi-select" ? (val as unknown[]).length : 1;
    }
    return total;
  };

  const totalFilters = computeCount();

  const getExclusionCategory = (key: string | undefined) =>
    schema.exclusions?.find((e) => e.key === key);

  return (
    <Popover
      modal
      open={disabled ? false : filterOpen}
      onOpenChange={(nextOpen) => {
        if (!disabled) setFilterOpen(nextOpen);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          id={triggerButtonId}
          count={totalFilters}
          hoverText="Filter"
          disabled={disabled}
        >
          <Filter className="h-6 w-6 hover:text-orange-500" />
        </Button>
      </PopoverTrigger>

      <PopoverContent className={popoverClassName ?? "min-w-96"}>
        <div className="grid grid-cols-2 gap-1 gap-x-3">
          {fieldsToRender.map((field) => {
            const id = field.id as keyof ContentFilteringState<F, E>["values"] & string;
            const value = state.values[id];
            const setter = state.setters[id] as (v: unknown) => void;
            const options = resolveOptions(field);

            switch (field.type) {
              case "text":
                return (
                  <div key={field.id} className={field.doubleWidth ? "col-span-2" : ""}>
                    <Label>{field.label}</Label>
                    <Input
                      value={(value as string) ?? ""}
                      disabled={disabled}
                      placeholder={field.label}
                      onChange={(e) => setter(e.target.value)}
                    />
                  </div>
                );
              case "date":
                return (
                  <div key={field.id} className={field.doubleWidth ? "col-span-2" : ""}>
                    <Label>{field.label}</Label>
                    <Input
                      type="date"
                      disabled={disabled}
                      value={(value as string) ?? ""}
                      onChange={(e) => setter(e.target.value)}
                    />
                  </div>
                );
              case "number":
                return (
                  <div key={field.id} className={field.doubleWidth ? "col-span-2" : ""}>
                    <Label>{field.label}</Label>
                    <NumberInput
                      disabled={disabled}
                      value={(value as number | undefined) ?? ""}
                      placeholder={field.label}
                      optional
                      onOptionalValueChange={setter}
                      step="any"
                      min={field.min ?? 0}
                      max={field.max}
                    />
                  </div>
                );
              case "single-select":
                return (
                  <div key={field.id} className={field.doubleWidth ? "col-span-2" : ""}>
                    <FilterSelect
                      key={field.id}
                      label={field.label}
                      value={value as string}
                      onValueChange={(v) => setter(v)}
                      options={options}
                      includeNone={"includeNone" in field ? field.includeNone : true}
                      noneOption={"noneOption" in field ? field.noneOption : undefined}
                      disabled={disabled}
                    />
                  </div>
                );
              case "multi-select":
                return (
                  <div key={field.id} className={field.doubleWidth ? "col-span-2" : ""}>
                    <Label>{field.label}</Label>
                    <MultiSelect
                      selected={(value as string[]) ?? []}
                      options={options}
                      onChange={
                        setter as React.Dispatch<React.SetStateAction<string[]>>
                      }
                      disabled={disabled}
                    />
                  </div>
                );
              case "tri-state":
                return (
                  <div
                    key={field.id}
                    className={field.doubleWidth ? "col-span-2 mt-1" : "mt-1"}
                  >
                    <Label>{field.label}</Label>
                    <TriStateToggle
                      verticalLayout
                      id={`toggle-${field.id}`}
                      value={value as boolean | undefined}
                      setShowActive={(v) => setter(v)}
                      disabled={disabled}
                      labelActive={
                        "triStateLabels" in field
                          ? field.triStateLabels?.labelActive
                          : undefined
                      }
                      labelInactive={
                        "triStateLabels" in field
                          ? field.triStateLabels?.labelInactive
                          : undefined
                      }
                      labelAll={
                        "triStateLabels" in field
                          ? field.triStateLabels?.labelAll
                          : undefined
                      }
                    />
                  </div>
                );
              default:
                return null;
            }
          })}
        </div>

        {schema.exclusions && schema.exclusions.length > 0 && (
          <div className="mt-3 border-gray-300 border-t p-2">
            <div className="flex items-center justify-between">
              <Label>Exclusions</Label>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowExclusionPopover(true)}
                disabled={disabled}
              >
                + Add Exclusion
              </Button>
            </div>

            {schema.exclusions.map((cat) => (
              <ExcludedItemsList
                key={cat.key}
                title={`Excluded ${cat.label}`}
                items={(state.excluded as Record<string, string[]>)[cat.key] ?? []}
                onRemove={(item) => {
                  const setter = (
                    state.setExcluded as Record<
                      string,
                      React.Dispatch<React.SetStateAction<string[]>>
                    >
                  )[cat.key];
                  if (setter) setter((prev) => prev.filter((x) => x !== item));
                }}
                disabled={disabled}
              />
            ))}

            {showExclusionPopover && (
              <div className="mt-2 rounded border p-2">
                <Label>Pick Category</Label>
                <Select
                  disabled={disabled}
                  onValueChange={(val) => {
                    setExclusionCategoryKey(val);
                    setTempExclusions([]);
                  }}
                  defaultValue={exclusionCategoryKey}
                >
                  <SelectTrigger disabled={disabled}>
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    {schema.exclusions.map((cat) => (
                      <SelectItem key={cat.key} value={cat.key}>
                        {cat.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Label className="mt-2">Exclude Items</Label>
                <MultiSelect
                  selected={tempExclusions}
                  options={(
                    getExclusionCategory(exclusionCategoryKey)?.options ?? []
                  ).map((val) => ({
                    value: val,
                    label: val,
                  }))}
                  onChange={setTempExclusions}
                  disabled={disabled}
                />

                <div className="mt-3 flex gap-2">
                  <Button
                    onClick={() => {
                      const apply = (
                        state.setExcluded as Record<
                          string,
                          React.Dispatch<React.SetStateAction<string[]>>
                        >
                      )[exclusionCategoryKey];
                      const newExclusions = [...new Set(tempExclusions)];
                      if (exclusionCategoryKey && apply) {
                        apply(newExclusions);
                      }
                      setTempExclusions([]);
                      setShowExclusionPopover(false);
                    }}
                    disabled={disabled}
                  >
                    Confirm
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={disabled}
                    onClick={() => setShowExclusionPopover(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
};

/** Read by `visibleIf`/`filterOptions` of fields reserved for content editors. */
export type ContentEditContext = { canEdit: boolean };
