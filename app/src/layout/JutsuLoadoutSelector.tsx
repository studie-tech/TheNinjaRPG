import React from "react";
import Loader from "@/layout/Loader";
import { api } from "@/app/_trpc/client";
import { fedJutsuLoadouts } from "@/utils/paypal";
import { Folder } from "lucide-react";
import { showMutationToast } from "@/libs/toast";
import { useRequiredUserData } from "@/utils/UserContext";

interface JutsuLoadoutSelectorProps {
  size?: "small" | "large";
  label?: string;
  onSelectOverride?: (loadoutId: string) => void;
  selectedOverrideId?: string | null;
  battleType?: "PVP" | "PVE";
}

const JutsuLoadoutSelector: React.FC<JutsuLoadoutSelectorProps> = (props) => {
  // State
  const { data: userData } = useRequiredUserData();

  // tRPC utility
  const utils = api.useUtils();

  // Determine battle type (default to PVP)
  const battleType = props.battleType || "PVP";
  const isPvE = battleType === "PVE";

  // How many loadouts?
  const maxLoadouts = isPvE ? 1 : fedJutsuLoadouts(userData);

  // Get loadouts based on battle type
  const { data: pvpData, isFetching: isFetchingPvp } = api.jutsu.getLoadouts.useQuery(
    undefined,
    {
      enabled: !isPvE && maxLoadouts > 1,
    },
  );
  const { data: pveData, isFetching: isFetchingPve } = api.jutsu.getPveLoadouts.useQuery(
    undefined,
    {
      enabled: isPvE,
    },
  );

  const data = isPvE ? pveData : pvpData;
  const isFetching = isPvE ? isFetchingPve : isFetchingPvp;

  // Mutations
  const { mutate: selectJutsuLoadout, isPending: isPendingPvp } =
    api.jutsu.selectJutsuLoadout.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await utils.profile.getUser.invalidate();
          await utils.item.getUserItems.invalidate();
          await utils.jutsu.getUserJutsus.invalidate();
        }
      },
    });

  const { mutate: selectPveJutsuLoadout, isPending: isPendingPve } =
    api.jutsu.selectPveJutsuLoadout.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await utils.profile.getUser.invalidate();
          await utils.item.getUserItems.invalidate();
          await utils.jutsu.getUserJutsus.invalidate();
        }
      },
    });

  const isPending = isPvE ? isPendingPve : isPendingPvp;

  // Derived size vars
  const iconSize = props?.size === "small" ? "h-6 w-6" : "h-10 w-10";
  const textSize = props?.size === "small" ? "text-xs" : "text-sm mt-1";
  const selectedId =
    props.selectedOverrideId ||
    (isPvE ? userData?.pveJutsuLoadout : userData?.jutsuLoadout);

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
      if (isPvE) {
        selectPveJutsuLoadout({ id });
    } else {
      selectJutsuLoadout({ id });
      }
    }
  };

  // Show loadout selectors
  return (
    <div>
      {props.label && <p className="text-sm">{props.label}</p>}
      <div className="flex flex-row gap-1">
        {data?.map((loadout, i) => {
          return (
            <div className="relative" key={i}>
              <Folder
                className={`${iconSize} ${selectedId === loadout.id ? "fill-orange-300" : "hover:cursor-pointer hover:fill-orange-300"}`}
                onClick={() => handleSelect(loadout.id)}
              />
              <div
                className={`absolute font-bold top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 hover:cursor-pointer ${textSize}`}
                onClick={() => handleSelect(loadout.id)}
              >
                {i + 1}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default JutsuLoadoutSelector;
