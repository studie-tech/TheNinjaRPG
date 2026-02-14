import { Filter, X } from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/app/_trpc/client";
import { TriStateToggle } from "@/components/control/Toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MultiSelect } from "@/components/ui/multi-select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDelayState } from "@/hooks/useDelayState";

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
 * - No hooks-in-loops (one state map + per-key debouncing)
 * - Field keys and value unions are inferred from the schema (no any/unknown)
 */

/** Discrete UI option for (single|multi)-select fields */
export type Option<V extends string = string> = { value: V; label: string };

/** Supported field control types */
export type FieldType =
  | "text"
  | "date"
  | "number"
  | "single-select"
  | "multi-select"
  | "tri-state";

// Field config types (discriminated unions ensure correct value types)

/** Free-text input */
export interface TextFieldConfig<Id extends string> {
  id: Id;
  label: string;
  type: "text";
  defaultValue: string;
  filterKey?: string;
  doubleWidth?: boolean;
  countActive?: (value: string) => number;
  normalizeForFilter?: (value: string) => unknown;
  visibleIf?: (ctx?: unknown) => boolean;
}

/** Date input (string yyyy-mm-dd) */
export interface DateFieldConfig<Id extends string> {
  id: Id;
  label: string;
  type: "date";
  defaultValue: string;
  filterKey?: string;
  doubleWidth?: boolean;
  countActive?: (value: string) => number;
  normalizeForFilter?: (value: string) => unknown;
  visibleIf?: (ctx?: unknown) => boolean;
}

/** Numeric input (undefined considered empty) */
export interface NumberFieldConfig<Id extends string> {
  id: Id;
  label: string;
  type: "number";
  defaultValue: number | undefined;
  filterKey?: string;
  doubleWidth?: boolean;
  countActive?: (value: number | undefined) => number;
  normalizeForFilter?: (value: number | undefined) => unknown;
  visibleIf?: (ctx?: unknown) => boolean;
}

/** Single-select (supports an optional sentinel 'none' value) */
export interface SingleSelectFieldConfig<
  Id extends string,
  V extends string,
  NV extends string = never,
> {
  id: Id;
  label: string;
  type: "single-select";
  defaultValue: V | NV;
  options?: Option<V>[];
  dataSource?:
    | "bloodlines"
    | "assets"
    | "villages"
    | "referralSources"
    | "visitorUtmSources";
  filterOptions?: (options: Option<string>[], ctx?: unknown) => Option<string>[];
  includeNone?: boolean;
  noneOption?: Option<NV>;
  emptyValues?: ReadonlyArray<V | NV> | (V | NV)[];
  filterKey?: string;
  doubleWidth?: boolean;
  countActive?: (value: V | NV) => number;
  normalizeForFilter?: (value: V | NV) => unknown;
  visibleIf?: (ctx?: unknown) => boolean;
}

/** Multi-select (empty array is considered empty) */
export interface MultiSelectFieldConfig<Id extends string, V extends string> {
  id: Id;
  label: string;
  type: "multi-select";
  defaultValue: V[];
  options?: Option<V>[];
  dataSource?:
    | "bloodlines"
    | "assets"
    | "villages"
    | "referralSources"
    | "visitorUtmSources";
  filterOptions?: (options: Option<string>[], ctx?: unknown) => Option<string>[];
  includeNone?: boolean;
  noneOption?: Option<string>;
  emptyValues?: never;
  filterKey?: string;
  doubleWidth?: boolean;
  countActive?: (value: V[]) => number;
  normalizeForFilter?: (value: V[]) => unknown;
  visibleIf?: (ctx?: unknown) => boolean;
}

/** Tri-state toggle (undefined represents "All") */
export interface TriStateFieldConfig<Id extends string> {
  id: Id;
  label: string;
  type: "tri-state";
  defaultValue: boolean | undefined;
  triStateLabels?: { labelActive: string; labelInactive: string; labelAll: string };
  filterKey?: string;
  doubleWidth?: boolean;
  countActive?: (value: boolean | undefined) => number;
  normalizeForFilter?: (value: boolean | undefined) => unknown;
  visibleIf?: (ctx?: unknown) => boolean;
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

/** Debounce delay for propagating field changes */
const DEBOUNCE_MS = 500;

/**
 * Hook: derives typed state maps (values, debounced, setters, exclusions) from a schema.
 * - Uses single state objects + per-key timers (no hooks-in-loops)
 * - Debounced values update after DEBOUNCE_MS per field
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

  const [values, setValues] = useState<ValuesFromSchema<F>>(initialValues);
  const [debounced, setDebounced] = useState<ValuesFromSchema<F>>(initialValues);

  // Keep values in sync if schema changes
  useEffect(() => {
    setValues(initialValues);
    setDebounced(initialValues);
  }, [initialValues]);

  // Debounce per field (one timer per key)
  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  useEffect(() => {
    const timers = timersRef.current;
    for (const field of schema.fields) {
      const key = field.id as keyof ValuesFromSchema<F> & string;
      const timer = timers[key];
      if (timer) clearTimeout(timer);
      timers[key] = setTimeout(() => {
        setDebounced((prev) =>
          prev[key] === values[key]
            ? prev
            : ({ ...prev, [key]: values[key] } as ValuesFromSchema<F>),
        );
      }, DEBOUNCE_MS);
    }
    return () => {
      for (const key of Object.keys(timers)) {
        clearTimeout(timers[key]);
      }
    };
  }, [schema.fields, values]);

  // Generate typed setters (stable across renders for the same schema)
  const setters = useMemo(() => {
    const out = {} as SettersFromSchema<F>;
    for (const field of schema.fields) {
      const id = field.id as keyof ValuesFromSchema<F> & string;
      (out as Record<string, React.Dispatch<React.SetStateAction<unknown>>>)[id] = (
        updater,
      ) => {
        setValues((prev) => {
          const current = prev[id];
          const next =
            typeof updater === "function"
              ? (updater as (p: typeof current) => typeof current)(current)
              : updater;
          return current === next
            ? prev
            : ({ ...prev, [id]: next } as ValuesFromSchema<F>);
        });
      };
    }
    return out;
  }, [schema.fields]);

  // Exclusions: initialize and debounce similarly
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
  const [debouncedExcluded, setDebouncedExcluded] =
    useState<ExcludedFromSchema<E>>(initialExcluded);

  useEffect(() => {
    setExcludedState(initialExcluded);
    setDebouncedExcluded(initialExcluded);
  }, [initialExcluded]);

  const excludedTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  useEffect(() => {
    if (!schema.exclusions) return;
    const timers = excludedTimersRef.current;
    for (const cat of schema.exclusions) {
      const key = cat.key as keyof ExcludedFromSchema<E> & string;
      const timer = timers[key];
      if (timer) clearTimeout(timer);
      timers[key] = setTimeout(() => {
        setDebouncedExcluded((prev) => {
          const prevArr = (prev as Record<string, string[]>)[key] ?? [];
          const nextArr = (excluded as Record<string, string[]>)[key] ?? [];
          if (prevArr.join("||") === nextArr.join("||")) return prev;
          return { ...(prev as object), [key]: nextArr } as ExcludedFromSchema<E>;
        });
      }, DEBOUNCE_MS);
    }
    return () => {
      for (const key of Object.keys(timers)) {
        clearTimeout(timers[key]);
      }
    };
  }, [schema.exclusions, excluded]);

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

  return { values, debounced, setters, excluded, debouncedExcluded, setExcluded };
};

/**
 * Build a filter payload from debounced values and the schema.
 * - Omits empty values based on field type and optional emptyValues
 * - Applies normalizeForFilter if provided
 * - Adds exclusions if any are non-empty
 */
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

    const isEmpty = () => {
      if (field.type === "multi-select")
        return Array.isArray(debouncedValue) && debouncedValue.length === 0;
      if (field.type === "text" || field.type === "date")
        return typeof debouncedValue !== "string" || debouncedValue.length === 0;
      if (field.type === "tri-state") return debouncedValue === undefined;
      if (field.type === "number") return debouncedValue === undefined;
      if (
        "emptyValues" in field &&
        Array.isArray(field.emptyValues) &&
        (field.emptyValues as unknown[]).includes(debouncedValue)
      )
        return true;
      return false;
    };

    if (!isEmpty()) {
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
}> = ({ label, value, onValueChange, options, includeNone = true, noneOption }) => {
  const resolvedNone = noneOption ?? { value: "None", label: "None" };
  return (
    <div>
      <Label>{label}</Label>
      <Select onValueChange={onValueChange} value={value}>
        <SelectTrigger>
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
}> = ({ title, items, onRemove }) => {
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
}: {
  schema: FilteringSchema<F, E>;
  state: ContentFilteringState<F, E>;
  context?: unknown;
  triggerButtonId?: string;
  popoverClassName?: string;
}) => {
  // Local UI state
  const [showExclusionPopover, , setShowExclusionPopover] = useDelayState(false);
  const [exclusionCategoryKey, , setExclusionCategoryKey] = useDelayState<string>(
    schema.exclusions?.[0]?.key ?? "",
  );
  const [tempExclusions, , setTempExclusions] = useDelayState<string[]>([]);

  // Apply visibleIf guards at render-time
  const fieldsToRender = schema.fields.filter((f) =>
    f.visibleIf ? f.visibleIf(context) : true,
  );

  // Determine which dynamic data sources are needed by the currently visible fields
  const needsDataSource = useMemo(() => {
    const mutableRequired: Record<
      "bloodlines" | "assets" | "villages" | "referralSources" | "visitorUtmSources",
      boolean
    > = {
      bloodlines: false,
      assets: false,
      villages: false,
      referralSources: false,
      visitorUtmSources: false,
    };
    for (const field of fieldsToRender) {
      if (!("dataSource" in field)) continue;
      const hasStaticOptions =
        "options" in field && Array.isArray(field.options) && field.options.length > 0;
      if (hasStaticOptions) continue;
      if (
        field.dataSource === "bloodlines" ||
        field.dataSource === "assets" ||
        field.dataSource === "villages" ||
        field.dataSource === "referralSources" ||
        field.dataSource === "visitorUtmSources"
      ) {
        mutableRequired[field.dataSource] = true;
      }
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

  // Resolve options for a field: prefer static options, otherwise derive from data source
  const resolveOptions = (field: AnyFieldConfig): Option[] => {
    let opts: Option[] | undefined = "options" in field ? field.options : undefined;
    if (!opts && "dataSource" in field && field.dataSource === "bloodlines") {
      opts = (bloodlineNames ?? []).map((b) => ({ value: b.id, label: b.name }));
    }
    if (!opts && "dataSource" in field && field.dataSource === "assets") {
      opts = (assetNames ?? []).map((a) => ({ value: a.id, label: a.name }));
    }
    if (!opts && "dataSource" in field && field.dataSource === "villages") {
      opts = (villageNames ?? []).map((v) => ({ value: v.id, label: v.name }));
    }
    if (!opts && "dataSource" in field && field.dataSource === "referralSources") {
      opts = (referralSources ?? []).map((s) => ({ value: s, label: s }));
    }
    if (!opts && "dataSource" in field && field.dataSource === "visitorUtmSources") {
      opts = (utmSources ?? []).map((s) => ({ value: s, label: s }));
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
      const isArray = Array.isArray(val);
      if ("countActive" in field && field.countActive) {
        total += (field.countActive as (v: unknown) => number)(val);
        continue;
      }
      if (field.type === "multi-select") {
        total += isArray ? (val as unknown[]).length : 0;
        continue;
      }
      if (field.type === "tri-state") {
        total += val !== undefined ? 1 : 0;
        continue;
      }
      if ("emptyValues" in field && Array.isArray(field.emptyValues)) {
        if ((field.emptyValues as unknown[]).includes(val)) continue;
      }
      if (field.type === "text") {
        total += typeof val === "string" && val.length > 0 ? 1 : 0;
        continue;
      }
      if (field.type === "date") {
        total += typeof val === "string" && val.length > 0 ? 1 : 0;
        continue;
      }
      if (field.type === "number") {
        total += Number.isFinite(val) ? 1 : 0;
        continue;
      }
      // single-select default
      total += val ? 1 : 0;
    }
    return total;
  };

  const totalFilters = computeCount();

  const getExclusionCategory = (key: string | undefined) =>
    schema.exclusions?.find((e) => e.key === key);

  return (
    <Popover modal>
      <PopoverTrigger asChild>
        <Button id={triggerButtonId} count={totalFilters} hoverText="Filter">
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
                      value={(value as string) ?? ""}
                      onChange={(e) => setter(e.target.value)}
                    />
                  </div>
                );
              case "number":
                return (
                  <div key={field.id} className={field.doubleWidth ? "col-span-2" : ""}>
                    <Label>{field.label}</Label>
                    <Input
                      type="number"
                      value={(value as number | undefined) ?? ""}
                      placeholder={field.label}
                      onChange={(e) =>
                        setter(
                          e.target.value === "" ? undefined : Number(e.target.value),
                        )
                      }
                    />
                  </div>
                );
              case "single-select":
                return (
                  <div key={field.id} className={field.doubleWidth ? "col-span-2" : ""}>
                    <FilterSelect
                      key={field.id}
                      label={field.label}
                      value={
                        (value as string) ??
                        ("noneOption" in field && field.noneOption?.value) ??
                        "None"
                      }
                      onValueChange={(v) => setter(v)}
                      options={options}
                      includeNone={"includeNone" in field ? field.includeNone : true}
                      noneOption={"noneOption" in field ? field.noneOption : undefined}
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
                      labelActive={
                        ("triStateLabels" in field &&
                          field.triStateLabels?.labelActive) ||
                        "Active"
                      }
                      labelInactive={
                        ("triStateLabels" in field &&
                          field.triStateLabels?.labelInactive) ||
                        "Inactive"
                      }
                      labelAll={
                        ("triStateLabels" in field && field.triStateLabels?.labelAll) ||
                        "All"
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
                  if (setter)
                    setter((prev: string[] = []) =>
                      (prev ?? []).filter((x) => x !== item),
                    );
                }}
              />
            ))}

            {showExclusionPopover && (
              <div className="mt-2 rounded border p-2">
                <Label>Pick Category</Label>
                <Select
                  onValueChange={(val) => {
                    setExclusionCategoryKey(val);
                    setTempExclusions([]);
                  }}
                  defaultValue={exclusionCategoryKey}
                >
                  <SelectTrigger>
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
                  >
                    Confirm
                  </Button>
                  <Button
                    variant="ghost"
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
