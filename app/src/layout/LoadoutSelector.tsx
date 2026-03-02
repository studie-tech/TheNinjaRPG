"use client";

import { Folder } from "lucide-react";
import type React from "react";
import type { UserData } from "@/drizzle/schema";
import Loader from "@/layout/Loader";
import { useRequiredUserData } from "@/utils/UserContext";

interface LoadoutData {
  id: string;
}

interface LoadoutSelectorConfig<T extends LoadoutData> {
  loadoutType: "item" | "jutsu";
  getQuery: () => {
    data: T[] | undefined;
    isFetching: boolean;
  };
  selectMutation: () => {
    mutate: (variables: { id: string }) => void;
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

  // Show loadout selectors
  return (
    <div>
      {props.label && <p className="text-sm">{props.label}</p>}
      <div className="flex flex-row gap-1">
        {data?.map((loadout, index) => {
          const isSelected = selectedId === loadout.id;
          return (
            <button
              type="button"
              className="relative"
              key={loadout.id}
              onClick={() => handleSelect(loadout.id)}
              disabled={isPending}
              aria-label={`${props.label || "Loadout"} ${index + 1}${isSelected ? " (selected)" : ""}`}
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
          );
        })}
      </div>
    </div>
  );
};

export default LoadoutSelector;
