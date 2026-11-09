"use client";

import { Loader2 } from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { api } from "@/app/_trpc/client";
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

  type Row = {
    id: string;
    name: string;
    effectType: string;
    entryId: string;
    effectIndex: number;
  } & Record<string, React.ReactNode>;
  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    (entries || []).forEach((entry) => {
      entry.effects.forEach((effect, idx) => {
        // If effect type filter is set, only include matching effect rows
        if (props.filterEffectTypes && props.filterEffectTypes.length > 0) {
          if (!props.filterEffectTypes.includes(effect.type)) return;
        }
        const row: Row = {
          id: `${entry.id}:${idx}`,
          name: entry.name,
          effectType: effect.type,
          entryId: entry.id,
          effectIndex: idx,
        };
        selectedFields.forEach((f) => {
          row[f] = (
            <div data-effect-entry-id={entry.id}>
              <EffectFieldInputGeneric
                effect={
                  modified[entry.id]?.[idx] ??
                  committed[entry.id]?.effects[idx] ??
                  effect
                }
                field={f}
                onChange={(v) =>
                  setModified((prev) => {
                    const next: Record<string, ZodAllTags[]> = { ...prev };
                    const baseEffs =
                      next[entry.id] ?? committed[entry.id]?.effects ?? entry.effects;
                    const updated = [...baseEffs];
                    const current = updated[idx] ?? effect;
                    updated[idx] = { ...current, [f]: v } as ZodAllTags;
                    next[entry.id] = updated;
                    return next;
                  })
                }
                options={options}
                disabled={editorPending}
              />
            </div>
          );
        });
        out.push(row);
      });
    });
    return out;
  }, [entries, selectedFields, modified, committed, options, editorPending]);

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

  const saveRow = async (row: Row) => {
    const entry = (entries || []).find((e) => e.id === row.entryId);
    if (!entry) return;
    // Saving one row submits every effect for its entry, including sibling rows.
    const fields = editorRef.current?.querySelectorAll<HTMLElement>(
      "[data-effect-entry-id]",
    );
    for (const field of fields ?? []) {
      if (field.dataset.effectEntryId === entry.id && !validateNumberInputs(field)) {
        return;
      }
    }
    const effects =
      modified[row.entryId] ?? committed[row.entryId]?.effects ?? entry.effects;
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
      return;
    }
    if (!saveFlight.claim(entry.id)) return;
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
      if (!res.success) return;
      setCommitted((prev) => ({
        ...prev,
        [entry.id]: { effects, baseUpdatedAt: entry.updatedAt.getTime() },
      }));
      setModified((prev) => {
        const next = { ...prev };
        delete next[row.entryId];
        return next;
      });
      try {
        await props.onEntriesUpdated?.();
      } catch {
        // The committed local snapshot keeps the successful write truthful if
        // the authoritative list cannot be refreshed immediately.
      }
    } catch (error) {
      // The draft is retained for a retry.
      showRetryableErrorToast(
        error,
        `Could not confirm whether the ${kind} effects saved. Refresh before retrying.`,
      );
    } finally {
      saveFlight.release(entry.id);
      props.onPendingChange?.(false);
    }
  };

  const columns: ColumnDefinitionType<Row, keyof Row>[] = useMemo(() => {
    const base: ColumnDefinitionType<Row, keyof Row>[] = [
      { key: "name", header: "Name", type: "string" },
      { key: "effectType", header: "Effect", type: "string" },
    ];
    selectedFields.forEach((f) => {
      base.push({ key: f, header: f, type: "jsx" });
    });
    return base;
  }, [selectedFields]);

  return (
    <div ref={editorRef} className="flex flex-col gap-2" aria-busy={editorPending}>
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
            disabled: () => editorPending,
            onClick: (r: Row) => void saveRow(r),
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
