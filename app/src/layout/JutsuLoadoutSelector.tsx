import { Folder } from "lucide-react";
import type React from "react";
import { api } from "@/app/_trpc/client";
import Loader from "@/layout/Loader";
import { showMutationToast } from "@/libs/toast";
import { fedJutsuLoadouts } from "@/utils/paypal";
import { useRequiredUserData } from "@/utils/UserContext";

interface JutsuLoadoutSelectorProps {
  size?: "small" | "large";
  label?: string;
  onSelectOverride?: (loadoutId: string) => void;
  selectedOverrideId?: string | null;
}

const JutsuLoadoutSelector: React.FC<JutsuLoadoutSelectorProps> = (props) => {
  // State
  const { data: userData } = useRequiredUserData();

  // tRPC utility
  const utils = api.useUtils();

  // How many loadouts?
  const maxLoadouts = fedJutsuLoadouts(userData);

  // Get loadouts
  const { data, isFetching } = api.jutsu.getLoadouts.useQuery(undefined, {
    enabled: maxLoadouts > 1,
  });

  // Mutations
  const { mutate: selectJutsuLoadout, isPending } =
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

  // Derived size vars
  const iconSize = props?.size === "small" ? "h-6 w-6" : "h-10 w-10";
  const textSize = props?.size === "small" ? "text-xs" : "text-sm mt-1";
  const selectedId = props.selectedOverrideId || userData?.jutsuLoadout;

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
      selectJutsuLoadout({ id });
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

export default JutsuLoadoutSelector;
