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
  invalidateQueries: () => Promise<void>;
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
  // State
  const { data: userData } = useRequiredUserData();

  // How many loadouts?
  const maxLoadouts = userData ? props.config.maxLoadoutsFn(userData) : 0;

  // Get loadouts
  const { data, isFetching } = props.config.getQuery();

  // Mutations
  const { mutate: selectLoadout, isPending } = props.config.selectMutation();

  // Derived size vars
  const iconSize = props?.size === "small" ? "h-6 w-6" : "h-10 w-10";
  const textSize = props?.size === "small" ? "text-xs" : "text-sm mt-1";
  const selectedId =
    props.selectedOverrideId ||
    (userData ? props.config.getSelectedId(userData) : null);

  // Loaders
  if (!userData) return <Loader />;
  if (isFetching) return <Loader />;
  if (isPending) return <Loader />;

  if (maxLoadouts <= 0) return null;

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
        {data?.map((loadout, i) => {
          return (
            <button
              type="button"
              className="relative"
              key={loadout.id}
              onClick={() => handleSelect(loadout.id)}
            >
              <Folder
                className={`${iconSize} ${selectedId === loadout.id ? "fill-orange-300" : "hover:cursor-pointer hover:fill-orange-300"}`}
              />
              <div
                className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 font-bold ${textSize}`}
              >
                {i + 1}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default LoadoutSelector;
