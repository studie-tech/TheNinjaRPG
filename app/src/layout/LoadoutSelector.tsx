"use client";

import { Folder, Pencil } from "lucide-react";
import type React from "react";
import { useState } from "react";
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
  onSelectOverride?: (loadoutId: string) => void;
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
  const renameMutation = props.config.renameMutation?.();

  // Derived values (calculated after all hooks)
  const maxLoadouts = userData ? props.config.maxLoadoutsFn(userData) : 0;
  const iconSize = props?.size === "small" ? "h-6 w-6" : "h-10 w-10";
  const textSize = props?.size === "small" ? "text-xs" : "text-sm mt-1";
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
      props.onSelectOverride(id);
    } else {
      selectLoadout({ id });
    }
  };

  const submitRename = (id: string, value: string, currentName?: string) => {
    const trimmed = value.trim();
    setEditingId(null);
    // Skip the mutation on a no-op rename so it does not round-trip or toast.
    if (trimmed.length > 0 && trimmed !== (currentName ?? "").trim()) {
      renameMutation?.mutate({ id, name: trimmed });
    }
  };

  // Show loadout selectors
  return (
    <div>
      {props.label && <p className="text-sm">{props.label}</p>}
      <div className="flex flex-row gap-1">
        {data?.map((loadout, index) => {
          const isSelected = selectedId === loadout.id;
          const displayName =
            loadout.name || `${props.label || "Loadout"} ${index + 1}`;
          const isEditing = editingId === loadout.id;
          return (
            <div key={loadout.id} className="flex flex-col items-center">
              <button
                type="button"
                className="relative"
                onClick={() => handleSelect(loadout.id)}
                disabled={isPending}
                aria-label={`${displayName}${isSelected ? " (selected)" : ""}`}
                aria-pressed={isSelected}
              >
                <Folder
                  className={`${iconSize} ${isSelected ? "fill-primary" : "hover:cursor-pointer hover:fill-primary"} ${isPending ? "opacity-50" : ""}`}
                />
                <div
                  className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 font-bold ${textSize}`}
                  aria-hidden="true"
                >
                  {isPending ? "..." : index + 1}
                </div>
              </button>
              {renameMutation &&
                (isEditing ? (
                  <input
                    // biome-ignore lint/a11y/noAutofocus: Inline rename input must focus immediately on edit activation for usability
                    autoFocus
                    aria-label={`Rename ${displayName}`}
                    defaultValue={loadout.name ?? ""}
                    maxLength={LOADOUT_NAME_MAX_LENGTH}
                    className="mt-1 w-16 rounded border bg-background px-1 text-center text-xs"
                    onBlur={(e) =>
                      submitRename(loadout.id, e.target.value, loadout.name)
                    }
                    onKeyDown={(e) => {
                      // Commit on Enter via the single onBlur path (no double
                      // submit); Escape clears first so the blur-commit no-ops.
                      if (e.key === "Enter") e.currentTarget.blur();
                      if (e.key === "Escape") {
                        e.currentTarget.value = "";
                        e.currentTarget.blur();
                      }
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="mt-1 flex items-center gap-0.5 text-xs hover:text-primary disabled:opacity-50"
                    aria-label={`Rename ${displayName}`}
                    disabled={renameMutation?.isPending}
                    onClick={() => setEditingId(loadout.id)}
                  >
                    <span className="max-w-16 truncate">{displayName}</span>
                    <Pencil className="h-3 w-3 shrink-0" />
                  </button>
                ))}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default LoadoutSelector;
