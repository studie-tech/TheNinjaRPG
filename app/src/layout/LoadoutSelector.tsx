"use client";

import type React from "react";
import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LOADOUT_NAME_MAX_LENGTH } from "@/drizzle/constants";
import type { UserData } from "@/drizzle/schema";
import Loader from "@/layout/Loader";
import { useRequiredUserData } from "@/utils/UserContext";

interface LoadoutData {
  id: string;
  name?: string;
}

interface LoadoutSelectorConfig<T extends LoadoutData> {
  getQuery: () => {
    data: T[] | undefined;
    isFetching: boolean;
  };
  selectMutation: () => {
    mutate: (variables: { id: string }) => void;
    isPending: boolean;
  };
  renameMutation?: () => {
    mutate: (variables: { id: string; name: string }) => void;
    isPending: boolean;
  };
  maxLoadoutsFn: (userData: UserData) => number;
  getSelectedId: (userData: UserData) => string | null;
}

interface LoadoutSelectorProps<T extends LoadoutData> {
  size?: "small" | "large";
  label?: string;
  /** "sheet" lists named loadouts under a chip; "dropdown" uses a compact select */
  variant?: "sheet" | "dropdown";
  onSelectOverride?: (loadoutId: string, displayName: string) => void;
  selectedOverrideId?: string | null;
  config: LoadoutSelectorConfig<T>;
}

const LoadoutSelector = <T extends LoadoutData>(
  props: LoadoutSelectorProps<T>,
): React.ReactElement | null => {
  // All hooks MUST be called before any early returns
  const { data: userData } = useRequiredUserData();
  const { data, isFetching } = props.config.getQuery();
  const { mutate: selectLoadout, isPending } = props.config.selectMutation();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const renameMutation = props.config.renameMutation?.();
  const variant = props.variant ?? "sheet";

  // Derived values (calculated after all hooks)
  const maxLoadouts = userData ? props.config.maxLoadoutsFn(userData) : 0;
  const selectedId =
    props.selectedOverrideId !== undefined && props.selectedOverrideId !== null
      ? props.selectedOverrideId
      : userData
        ? props.config.getSelectedId(userData)
        : null;

  // Early returns AFTER all hooks
  if (!userData) return <Loader />;
  if (isFetching) return <Loader />;

  if (maxLoadouts <= 1) return null;

  // Handle select
  const handleSelect = (id: string) => {
    if (props.onSelectOverride) {
      const selectedIndex = data?.findIndex((loadout) => loadout.id === id) ?? -1;
      const selectedLoadout = selectedIndex >= 0 ? data?.[selectedIndex] : undefined;
      props.onSelectOverride(
        id,
        selectedLoadout
          ? getDisplayName(selectedLoadout, selectedIndex)
          : props.label || "Loadout",
      );
    } else {
      selectLoadout({ id });
    }
  };

  const getDisplayName = (loadout: LoadoutData, index: number) =>
    loadout.name || `${props.label || "Loadout"} ${index + 1}`;

  if (variant === "dropdown") {
    return (
      <div className="min-w-0 flex-1">
        {props.label && <p className="mb-1 text-sm">{props.label}</p>}
        <Select
          value={selectedId ?? undefined}
          onValueChange={handleSelect}
          disabled={isPending}
        >
          <SelectTrigger className="h-8 w-full min-w-[8rem]">
            <SelectValue placeholder="Select loadout" />
          </SelectTrigger>
          <SelectContent>
            {data?.map((loadout, index) => (
              <SelectItem key={loadout.id} value={loadout.id}>
                {getDisplayName(loadout, index)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  const submitRename = (id: string, value: string, currentName?: string) => {
    const trimmed = value.trim();
    setEditingId(null);
    // Skip the mutation on a no-op rename so it does not round-trip or toast.
    if (trimmed.length > 0 && trimmed !== (currentName ?? "").trim()) {
      renameMutation?.mutate({ id, name: trimmed });
    }
  };

  const slots = (data ?? []).slice(0, maxLoadouts);
  const selectedIndex = slots.findIndex((loadout) => loadout.id === selectedId);
  const selected = selectedIndex >= 0 ? slots[selectedIndex] : undefined;
  const selectedName = selected ? getDisplayName(selected, selectedIndex) : "Loadout";
  // getDisplayName already starts unnamed slots with the label ("Jutsu 1").
  // Prefix only names that do not, so the chip does not read "Jutsu · Jutsu 1".
  const chipText =
    props.label &&
    selectedName !== props.label &&
    !selectedName.startsWith(`${props.label} `)
      ? `${props.label} · ${selectedName}`
      : selectedName;
  const chipClass =
    props.size === "small" ? "h-8 gap-2 px-2 text-xs" : "h-9 gap-3 px-3 text-sm";

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setEditingId(null);
      }}
    >
      <div className="inline-flex min-w-0 max-w-full self-start">
        <PopoverTrigger asChild>
          <button
            type="button"
            className={`flex min-w-0 items-center justify-between rounded-md border border-input bg-background text-left ${chipClass} ${isPending ? "opacity-50" : ""}`}
            disabled={isPending}
          >
            <span className="min-w-0 truncate">{chipText}</span>
            <span className="shrink-0 text-muted-foreground text-xs">
              {open ? "Close" : "Change"}
            </span>
          </button>
        </PopoverTrigger>
      </div>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={8}
        collisionPadding={{ top: 72, right: 8, bottom: 88, left: 8 }}
        className="w-auto min-w-56 p-2"
      >
        <p className="mb-1 font-medium text-sm">Loadouts</p>
        {slots.map((loadout, index) => {
          const isSelected = selectedId === loadout.id;
          const displayName = getDisplayName(loadout, index);
          const isEditing = editingId === loadout.id;
          if (isEditing) {
            return (
              <input
                key={loadout.id}
                // oxlint-disable-next-line jsx-a11y/no-autofocus -- Inline rename input must focus immediately on edit activation for usability
                autoFocus
                aria-label={`Rename ${displayName}`}
                defaultValue={loadout.name ?? ""}
                maxLength={LOADOUT_NAME_MAX_LENGTH}
                className="w-full rounded border bg-background px-2 py-1 text-sm"
                onBlur={(e) => submitRename(loadout.id, e.target.value, loadout.name)}
                onKeyDown={(e) => {
                  // Commit on Enter via the single onBlur path (no double
                  // submit); Escape clears first so the blur-commit no-ops.
                  if (e.key === "Enter") e.currentTarget.blur();
                  if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    e.currentTarget.value = "";
                    e.currentTarget.blur();
                  }
                }}
              />
            );
          }
          return (
            <div
              key={loadout.id}
              className="flex items-center justify-between gap-3 border-border border-t py-1.5"
            >
              <button
                type="button"
                className={`min-w-0 flex-1 truncate text-left text-sm ${isSelected ? "font-medium" : ""}`}
                aria-current={isSelected ? "true" : undefined}
                onClick={() => {
                  if (!isSelected) handleSelect(loadout.id);
                  setOpen(false);
                }}
              >
                {displayName}
              </button>
              <span className="flex shrink-0 items-center gap-2">
                {isSelected && (
                  <span className="text-muted-foreground text-xs">Active</span>
                )}
                {renameMutation && (
                  <button
                    type="button"
                    className="text-muted-foreground text-xs hover:text-foreground disabled:opacity-50"
                    aria-label={`Rename ${displayName}`}
                    disabled={renameMutation.isPending}
                    onClick={() => setEditingId(loadout.id)}
                  >
                    Rename
                  </button>
                )}
              </span>
            </div>
          );
        })}
      </PopoverContent>
    </Popover>
  );
};

export default LoadoutSelector;
