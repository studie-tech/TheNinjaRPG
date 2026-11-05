import { Dna, Gem } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import ItemWithEffects from "@/layout/ItemWithEffects";
import type { BattleState, ReturnedUserState } from "@/libs/combat/types";
import { getBloodline, getKeystoneItem } from "@/libs/combat/util";
import { cn } from "@/libs/shadui";

/** A fighter's bloodline and keystone, each opening its effects. */
export const BattleUserTraits = ({
  battle,
  battleUser,
  className,
  iconClassName = "mr-2 h-6 w-6",
}: {
  battle: NonNullable<BattleState["battle"]>;
  battleUser: ReturnedUserState;
  className?: string;
  iconClassName?: string;
}) => {
  const bloodline = getBloodline(battle, battleUser.bloodlineId);
  const keystoneItem = battleUser.keystoneName
    ? getKeystoneItem(battle, battleUser.keystoneItemId)
    : undefined;
  if (!bloodline && !keystoneItem) return null;
  return (
    <div className={cn("flex flex-col items-start", className)}>
      {bloodline && (
        <Popover>
          <PopoverTrigger>
            <div className="flex flex-row items-center hover:cursor-pointer hover:text-orange-500">
              <Dna className={iconClassName} /> {bloodline.name ?? "??"}
            </div>
          </PopoverTrigger>
          <PopoverContent>
            <div className="max-w-[320px]">
              <ItemWithEffects item={bloodline} key={bloodline.id} hideDetails />
            </div>
          </PopoverContent>
        </Popover>
      )}
      {keystoneItem && (
        <Popover>
          <PopoverTrigger>
            <div className="flex flex-row items-center hover:cursor-pointer hover:text-orange-500">
              <Gem className={iconClassName} /> {battleUser.keystoneName}
            </div>
          </PopoverTrigger>
          <PopoverContent className="w-[320px]">
            <div className="p-4">
              <ItemWithEffects item={keystoneItem} key={keystoneItem.id} hideDetails />
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
};
