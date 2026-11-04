import { api } from "@/app/_trpc/client";
import { selectedLoadoutName } from "@/libs/battleArena";
import { fedItemLoadouts, fedJutsuLoadouts } from "@/utils/paypal";
import { useUserDataSelector } from "@/utils/UserContext";

/**
 * Names of the selected jutsu and item loadouts, as the loadout pickers label them. A name is
 * null while loading and for players with a single loadout, who have nothing to switch.
 */
export function useLoadoutNames() {
  const { data: selection } = useUserDataSelector((user) => ({
    jutsuSlots: fedJutsuLoadouts(user),
    itemSlots: fedItemLoadouts(user),
    jutsuId: user.jutsuLoadout,
    itemId: user.itemLoadout,
  }));
  const hasJutsuLoadouts = (selection?.jutsuSlots ?? 0) > 1;
  const hasItemLoadouts = (selection?.itemSlots ?? 0) > 1;
  const { data: jutsuLoadouts } = api.jutsu.getLoadouts.useQuery(undefined, {
    enabled: hasJutsuLoadouts,
  });
  const { data: itemLoadouts } = api.item.getItemLoadouts.useQuery(undefined, {
    enabled: hasItemLoadouts,
  });
  return {
    jutsu: hasJutsuLoadouts
      ? selectedLoadoutName(jutsuLoadouts, selection?.jutsuId, "Jutsu loadout")
      : null,
    item: hasItemLoadouts
      ? selectedLoadoutName(itemLoadouts, selection?.itemId, "Item loadout")
      : null,
  };
}
