import type React from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import ItemWithEffects, { type ItemWithEffectsProps } from "@/layout/ItemWithEffects";
import { formatPvpWinRate } from "@/libs/profile";

/** Named item on a profile whose effects open in a popover. */
export const EffectsPopover: React.FC<{
  item: ItemWithEffectsProps["item"] & { name: string };
}> = ({ item }) => (
  <Popover>
    <PopoverTrigger asChild>
      <button type="button" className="cursor-pointer font-bold hover:text-orange-500">
        {item.name}
      </button>
    </PopoverTrigger>
    <PopoverContent className="w-[500px] max-w-[90vw]">
      <ItemWithEffects item={item} />
    </PopoverContent>
  </Popover>
);

/** PvP wins, losses and win rate. */
export const PvpRecord: React.FC<{ wins: number; losses: number }> = ({
  wins,
  losses,
}) => (
  <>
    <p>PvP Wins: {wins}</p>
    <p>PvP Losses: {losses}</p>
    <p>PvP Win Rate: {formatPvpWinRate(wins, losses)}%</p>
  </>
);
