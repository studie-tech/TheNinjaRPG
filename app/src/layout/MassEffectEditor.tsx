"use client";

import { Loader2 } from "lucide-react";
import type React from "react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MultiSelect, type OptionType } from "@/components/ui/multi-select";
import { NumberInput, validateNumberInputs } from "@/components/ui/number-input";
import { Switch } from "@/components/ui/switch";
import { useSingleFlight } from "@/hooks/useSingleFlight";
import { unwrapFieldSchema } from "@/layout/EditContent";
import { SearchSelect } from "@/layout/SearchSelect";
import type { ColumnDefinitionType } from "@/layout/Table";
import Table from "@/layout/Table";
import { showRetryableErrorToast } from "@/libs/retryableToast";
import { cn } from "@/libs/shadui";
import { showMutationToast } from "@/libs/toast";
import type {
  ZodAllTags,
  ZodBloodlineType,
  ZodItemType,
  ZodJutsuType,
} from "@/validators/combat";
import {
  BloodlineValidator,
  getTagSchema,
  ItemValidator,
  JutsuValidator,
} from "@/validators/combat";

/**
 * Edit selected effect fields across many entries of one content kind; each row saves
 * every effect of its entry.
 */
export const MassEffectEditor = <
  T extends { id: string; name: string; effects: ZodAllTags[]; updatedAt: Date },
>(props: {
  kind: "item" | "jutsu" | "bloodline";
  entries: T[] | undefined;
  selectedFields: string[];
  onEntriesUpdated?: () => unknown;
  onPendingChange?: (pending: boolean) => void;
  filterEffectTypes?: string[];
}) => {
  const { kind, entries, selectedFields } = props;

  const editorRef = useRef<HTMLDivElement>(null);
  const [modified, setModified] = useState<Record<string, ZodAllTags[]>>({});
  const [committed, setCommitted] = useState<
    Record<string, { effects: ZodAllTags[]; baseUpdatedAt: number }>
  >({});
  // Hold the same entry's claim through both the write and its awaited list refresh.
  const saveFlight = useSingleFlight<string>();
  const { pending: pendingId, isPending: editorPending } = saveFlight;

  useEffect(
    () => () => {
      props.onPendingChange?.(false);
    },
    [props.onPendingChange],
  );

  // A successful save becomes the local source of truth immediately. Retain it
  // only while the list still carries the exact pre-save revision. Once the
  // server revision advances it is authoritative, including when another editor
  // has since committed different effects.
  useEffect(() => {
    setCommitted((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const entry of entries ?? []) {
        const snapshot = next[entry.id];
        if (
          snapshot &&
          (entry.updatedAt.getTime() > snapshot.baseUpdatedAt ||
            JSON.stringify(entry.effects) === JSON.stringify(snapshot.effects))
        ) {
          delete next[entry.id];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [entries, kind]);

  // Options: the field selector lists damage-tag fields, so only asset pickers need data
  const { data: assetData } = api.misc.getAllGameAssetNames.useQuery(undefined);

  const options = useMemo(
    () =>
      ({
        animation: (assetData || [])
          .filter((a) => a.type === "ANIMATION")
          .map((a) => ({ label: a.id, value: a.id })),
        staticAsset: (assetData || [])
          .filter((a) => a.type === "STATIC")
          .map((a) => ({ label: a.id, value: a.id })),
      }) as const,
    [assetData],
  );

  // One stable handler for every cell, so a keystroke re-renders only the edited cell.
  const editField = useCallback(
    (
      entryId: string,
      idx: number,
      field: string,
      value: unknown,
      baseEffects: ZodAllTags[],
    ) =>
      setModified((prev) => {
        const updated = [...(prev[entryId] ?? baseEffects)];
        const current = updated[idx] ?? baseEffects[idx];
        if (!current) return prev;
        updated[idx] = { ...current, [field]: value } as ZodAllTags;
        return { ...prev, [entryId]: updated };
      }),
    [],
  );

  const baseEffectsOf = (entry: T) => committed[entry.id]?.effects ?? entry.effects;

  type Row = {
    id: string;
    name: string;
    effectType: string;
    entryId: string;
    effectIndex: number;
  } & Record<string, React.ReactNode>;
  const rows: Row[] = [];
  for (const entry of entries ?? []) {
    const baseEffects = baseEffectsOf(entry);
    const draft = modified[entry.id];
    const hiddenDrafts = draft
      ? draftFieldsOutside(baseEffects, draft, selectedFields, props.filterEffectTypes)
      : [];
    entry.effects.forEach((effect, idx) => {
      // If effect type filter is set, only include matching effect rows
      if (props.filterEffectTypes && props.filterEffectTypes.length > 0) {
        if (!props.filterEffectTypes.includes(effect.type)) return;
      }
      const row: Row = {
        id: `${entry.id}:${idx}`,
        name: entry.name,
        nameCell: (
          <div>
            <span>{entry.name}</span>
            {draft && (
              <p className="font-semibold text-amber-600 text-xs">
                Unsaved
                {hiddenDrafts.length > 0 && ` · also saves ${hiddenDrafts.join(", ")}`}
              </p>
            )}
          </div>
        ),
        effectType: effect.type,
        entryId: entry.id,
        effectIndex: idx,
      };
      for (const field of selectedFields) {
        row[field] = (
          <EffectFieldCell
            entryId={entry.id}
            idx={idx}
            field={field}
            effect={draft?.[idx] ?? baseEffects[idx] ?? effect}
            baseEffects={baseEffects}
            onEdit={editField}
            options={options}
            disabled={editorPending}
          />
        );
      }
      rows.push(row);
    });
  }
  const dirtyEntryIds = (entries ?? [])
    .filter((entry) => modified[entry.id])
    .map((entry) => entry.id);

  // Mutations
  const itemUpdate = api.item.update.useMutation({
    meta: { handlesTransportError: true },
  });
  const jutsuUpdate = api.jutsu.update.useMutation({
    meta: { handlesTransportError: true },
  });
  const bloodlineUpdate = api.bloodline.update.useMutation({
    meta: { handlesTransportError: true },
  });

  /** Save every effect of one entry; true when the write succeeded. */
  const saveEntry = async (entryId: string): Promise<boolean> => {
    const entry = (entries || []).find((e) => e.id === entryId);
    if (!entry) return false;
    // Saving one row submits every effect for its entry, including sibling rows.
    const fields = editorRef.current?.querySelectorAll<HTMLElement>(
      "[data-effect-entry-id]",
    );
    for (const field of fields ?? []) {
      if (field.dataset.effectEntryId === entry.id && !validateNumberInputs(field)) {
        return false;
      }
    }
    const effects = modified[entryId] ?? committed[entryId]?.effects ?? entry.effects;
    const validator =
      kind === "item"
        ? ItemValidator
        : kind === "jutsu"
          ? JutsuValidator
          : BloodlineValidator;
    // Drafts remain in the payload when their field or effect row is hidden.
    const parsed = validator.shape.effects.safeParse(effects);
    if (!parsed.success) {
      showMutationToast({
        success: false,
        message: parsed.error.issues.map((issue) => issue.message).join("; "),
      });
      return false;
    }
    if (!saveFlight.claim(entry.id)) return false;
    props.onPendingChange?.(true);
    try {
      const res =
        kind === "item"
          ? await itemUpdate.mutateAsync({
              id: entry.id,
              data: { ...(entry as unknown as ZodItemType), effects } as ZodItemType,
            })
          : kind === "jutsu"
            ? await jutsuUpdate.mutateAsync({
                id: entry.id,
                data: {
                  ...(entry as unknown as ZodJutsuType),
                  effects,
                } as ZodJutsuType,
              })
            : await bloodlineUpdate.mutateAsync({
                id: entry.id,
                data: {
                  ...(entry as unknown as ZodBloodlineType),
                  effects,
                } as ZodBloodlineType,
              });
      showMutationToast(res);
      if (!res.success) return false;
      setCommitted((prev) => ({
        ...prev,
        [entry.id]: { effects, baseUpdatedAt: entry.updatedAt.getTime() },
      }));
      setModified((prev) => {
        const next = { ...prev };
        delete next[entryId];
        return next;
      });
      try {
        await props.onEntriesUpdated?.();
      } catch {
        // The committed local snapshot keeps the successful write truthful if
        // the authoritative list cannot be refreshed immediately.
      }
      return true;
    } catch (error) {
      // The draft is retained for a retry.
      showRetryableErrorToast(
        error,
        `Could not confirm whether the ${kind} effects saved. Refresh before retrying.`,
      );
      return false;
    } finally {
      saveFlight.release(entry.id);
      props.onPendingChange?.(false);
    }
  };

  /** Save each entry with drafts in list order, one at a time, stopping at a failure. */
  const saveAll = async () => {
    for (const entryId of dirtyEntryIds) {
      if (!(await saveEntry(entryId))) return;
    }
  };

  const columns: ColumnDefinitionType<Row, keyof Row>[] = useMemo(() => {
    const base: ColumnDefinitionType<Row, keyof Row>[] = [
      { key: "nameCell", header: "Name", type: "jsx" },
      { key: "effectType", header: "Effect", type: "string" },
    ];
    selectedFields.forEach((f) => {
      base.push({ key: f, header: f, type: "jsx" });
    });
    return base;
  }, [selectedFields]);

  if (selectedFields.length === 0) {
    return (
      <p className="p-3 text-muted-foreground">
        Pick one or more effect fields above to start editing.
      </p>
    );
  }

  return (
    <div ref={editorRef} className="flex flex-col gap-2" aria-busy={editorPending}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 pt-2">
        <p className="text-muted-foreground text-sm" aria-live="polite">
          {dirtyEntryIds.length === 0
            ? "No unsaved changes"
            : `${dirtyEntryIds.length} ${dirtyEntryIds.length === 1 ? "entry" : "entries"} with unsaved changes`}
        </p>
        <Button
          id="mass-edit-save-all"
          size="sm"
          disabled={editorPending || dirtyEntryIds.length === 0}
          onClick={() => void saveAll()}
        >
          Save all
        </Button>
      </div>
      <Table<Row, keyof Row>
        data={rows}
        columns={columns}
        buttons={[
          {
            label: (row: Row) =>
              pendingId === row.entryId ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                  Saving
                </>
              ) : (
                "Save"
              ),
            ariaLabel: (row: Row) =>
              pendingId === row.entryId
                ? `Saving ${kind} effects for ${row.name}`
                : `Save ${kind} effects for ${row.name}`,
            disabled: (row: Row) => editorPending || !modified[row.entryId],
            onClick: (r: Row) => void saveEntry(r.entryId),
          },
        ]}
      />
      {editorPending && (
        <p
          className="px-3 pb-2 text-muted-foreground text-sm"
          role="status"
          aria-live="polite"
        >
          Saving
        </p>
      )}
    </div>
  );
};

/** One editable effect field; memoised so editing a cell leaves the other cells alone. */
const EffectFieldCell = memo(
  (props: {
    entryId: string;
    idx: number;
    field: string;
    effect: ZodAllTags;
    baseEffects: ZodAllTags[];
    onEdit: (
      entryId: string,
      idx: number,
      field: string,
      value: unknown,
      baseEffects: ZodAllTags[],
    ) => void;
    options: { animation?: OptionType[]; staticAsset?: OptionType[] };
    disabled: boolean;
  }) => {
    const { entryId, idx, field, baseEffects, onEdit } = props;
    return (
      <div data-effect-entry-id={entryId}>
        <EffectFieldInputGeneric
          effect={props.effect}
          field={field}
          onChange={(value) => onEdit(entryId, idx, field, value, baseEffects)}
          options={props.options}
          disabled={props.disabled}
        />
      </div>
    );
  },
);

/** Select editable effect columns from the combat damage schema's shared field names. */
export const EffectFieldSelector: React.FC<{
  selected: string[];
  setSelected: React.Dispatch<React.SetStateAction<string[]>>;
  className?: string;
  disabled?: boolean;
}> = ({ selected, setSelected, className, disabled }) => {
  // The selectable fields are the damage tag's fields
  const fieldOptions = useMemo<OptionType[]>(() => {
    const all = getTagSchema("damage").shape as Record<string, unknown>;
    return Object.keys(all)
      .filter((k) => !["type", "timeTracker"].includes(k))
      .sort((a, b) => a.localeCompare(b))
      .map((f) => ({ label: f, value: f }));
  }, []);

  return (
    <div className={cn("min-w-[240px]", className)}>
      <MultiSelect
        selected={selected}
        options={fieldOptions}
        onChange={setSelected}
        isDirty={false}
        disabled={disabled}
      />
    </div>
  );
};

/**
 * EFFECT FIELD RENDERER (generic): Renders a single effect field input based on its zod type
 */
export const EffectFieldInputGeneric = <E extends ZodAllTags>(opts: {
  effect: E;
  field: string;
  onChange: (value: unknown) => void;
  options?: {
    animation?: OptionType[];
    staticAsset?: OptionType[];
  };
  disabled?: boolean;
}) => {
  const { effect, field, onChange } = opts;
  const schema = getTagSchema(effect.type);
  const fieldSchema = (schema.shape as Record<string, z.ZodType>)[field] as
    | z.ZodType
    | undefined;
  if (!fieldSchema) return <div className="text-muted-foreground">N/A</div>;
  const inner = unwrapFieldSchema(fieldSchema);
  const eff = effect as unknown as Record<string, unknown>;

  if (["appearAnimation", "disappearAnimation", "staticAnimation"].includes(field)) {
    const raw = eff[field];
    const value = typeof raw === "string" ? raw : "";
    return (
      <SearchSelect
        label={field}
        placeholder="Select"
        value={value}
        onChange={(v) => onChange(v)}
        options={opts.options?.animation || []}
        disabled={opts.disabled}
      />
    );
  }
  if (field === "staticAssetPath") {
    const raw = eff[field];
    const value = typeof raw === "string" ? raw : "";
    return (
      <SearchSelect
        label={field}
        placeholder="Select"
        value={value}
        onChange={(v) => onChange(v)}
        options={opts.options?.staticAsset || []}
        disabled={opts.disabled}
      />
    );
  }

  // Primitives
  if (inner instanceof z.ZodNumber) {
    const value = eff[field];
    const numVal =
      typeof value === "number"
        ? value
        : Number(value ?? (field === "animationScale" ? 1 : 0));
    return (
      <NumberInput
        value={numVal}
        disabled={opts.disabled}
        onValueChange={onChange}
        step="any"
      />
    );
  }
  if (inner instanceof z.ZodBoolean) {
    const value = eff[field];
    const boolVal = typeof value === "boolean" ? value : Boolean(value);
    return (
      <Switch
        checked={boolVal}
        onCheckedChange={(v) => onChange(v)}
        disabled={opts.disabled}
      />
    );
  }
  if (inner instanceof z.ZodEnum) {
    const values = inner.options as string[];
    const options = values.map((v) => ({ label: v, value: v }));
    const raw = eff[field];
    const cur = typeof raw === "string" ? raw : "";
    const handle = (v: string) => onChange(v);
    return (
      <SearchSelect
        label={field}
        placeholder="Select"
        value={cur}
        onChange={handle}
        options={options}
        disabled={opts.disabled}
      />
    );
  }
  if (inner instanceof z.ZodArray) {
    const elementSchema = unwrapFieldSchema(inner.element as z.ZodType);
    if (elementSchema instanceof z.ZodEnum) {
      const values = (elementSchema as unknown as { options: string[] }).options || [];
      const options = values.map((v) => ({ label: String(v), value: String(v) }));
      const selected = Array.isArray(eff[field])
        ? (eff[field] as unknown[]).filter((x): x is string => typeof x === "string")
        : [];
      const onChangeMs: React.Dispatch<React.SetStateAction<string[]>> = (v) =>
        onChange(v);
      return (
        <MultiSelect
          selected={selected}
          onChange={onChangeMs}
          options={options}
          disabled={opts.disabled}
        />
      );
    }
    if (elementSchema instanceof z.ZodString) {
      const selected = Array.isArray(eff[field])
        ? (eff[field] as unknown[]).filter((x): x is string => typeof x === "string")
        : [];
      const onChangeMs: React.Dispatch<React.SetStateAction<string[]>> = (v) =>
        onChange(v);
      return (
        <MultiSelect
          selected={selected}
          onChange={onChangeMs}
          options={[]}
          allowAddNew
          disabled={opts.disabled}
        />
      );
    }
  }
  const rawFinal = eff[field];
  const textVal =
    typeof rawFinal === "string" || typeof rawFinal === "number"
      ? String(rawFinal)
      : "";
  return (
    <Input
      type="text"
      value={textVal}
      onChange={(e) => onChange(e.target.value)}
      disabled={opts.disabled}
    />
  );
};

/**
 * Fields an entry's draft changes that the editor does not show: unselected columns and
 * effects outside the effect type filter. Saving the entry still writes them.
 */
export const draftFieldsOutside = (
  base: ZodAllTags[],
  draft: ZodAllTags[],
  visibleFields: string[],
  visibleTypes?: string[],
) => {
  const hidden = new Set<string>();
  draft.forEach((effect, idx) => {
    const before = (base[idx] ?? {}) as Record<string, unknown>;
    const after = effect as Record<string, unknown>;
    const isRowVisible =
      !visibleTypes || visibleTypes.length === 0 || visibleTypes.includes(effect.type);
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (JSON.stringify(before[key]) === JSON.stringify(after[key])) continue;
      if (isRowVisible && visibleFields.includes(key)) continue;
      hidden.add(key);
    }
  });
  return [...hidden].sort();
};
