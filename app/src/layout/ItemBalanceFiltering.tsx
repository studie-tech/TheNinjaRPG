import React, { useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { MultiSelect } from "@/components/ui/multi-select";
import { Filter } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { api } from "@/app/_trpc/client";

import { BattleTypes, ItemTypes } from "@/drizzle/constants";
import type { BattleType, ItemType } from "@/drizzle/constants";

/**
 * STATE HOOK
 */
export const useFiltering = () => {
  const [battleTypes, setBattleTypes] = useState<BattleType[]>([
    "RANKED_PVP",
    "COMBAT",
    "RANKED_SPARRING",
    "SPARRING",
  ]);
  const [minCount, setMinCount] = useState<number>(1);
  const [itemTypes, setItemTypes] = useState<ItemType[]>([]);
  const [bloodlineIds, setBloodlineIds] = useState<string[]>([]);

  return {
    battleTypes,
    minCount,
    itemTypes,
    bloodlineIds,
    setBattleTypes,
    setMinCount,
    setItemTypes,
    setBloodlineIds,
  };
};

export type ItemBalanceFilteringState = ReturnType<typeof useFiltering>;

interface ItemBalanceFilteringProps {
  state: ItemBalanceFilteringState;
}

/**
 * MAIN COMPONENT
 */
const ItemBalanceFiltering: React.FC<ItemBalanceFilteringProps> = (props) => {
  const {
    battleTypes,
    minCount,
    itemTypes,
    bloodlineIds,
    setBattleTypes,
    setMinCount,
    setItemTypes,
    setBloodlineIds,
  } = props.state;

  // Fetch bloodline names for filtering
  const { data: bloodlines } = api.bloodline.getAllNames.useQuery(undefined);

  // Count filters
  const numBattleTypes = battleTypes.length;
  const numItemTypes = itemTypes.length;
  const numBloodlineIds = bloodlineIds.length;
  const numMinCount = minCount > 1 ? 1 : 0;
  const numFilters = numBattleTypes + numItemTypes + numBloodlineIds + numMinCount;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button count={numFilters}>
          <Filter className="sm:mr-2 h-6 w-6 hover:text-orange-500" />
          <p className="hidden sm:block">Filter</p>
        </Button>
      </PopoverTrigger>

      <PopoverContent className="min-w-96">
        <div className="grid grid-cols-1 gap-4">
          {/* Battle Types */}
          <div>
            <Label>Battle Types</Label>
            <MultiSelect
              selected={battleTypes}
              options={BattleTypes.map((type) => ({ value: type, label: type }))}
              onChange={(e) => setBattleTypes(e as BattleType[])}
            />
          </div>

          {/* Minimum Count */}
          <div>
            <Label>Minimum Count</Label>
            <Input
              type="number"
              placeholder="Minimum count"
              min={1}
              value={minCount}
              onChange={(e) => setMinCount(Number(e.target.value) || 1)}
            />
          </div>

          {/* Item Types */}
          <div>
            <Label>Item Types</Label>
            <MultiSelect
              selected={itemTypes}
              options={ItemTypes.map((type) => ({
                value: type,
                label: type,
              }))}
              onChange={(e) => setItemTypes(e as ItemType[])}
            />
          </div>

          {/* Bloodlines */}
          <div>
            <Label>Bloodlines</Label>
            <MultiSelect
              selected={bloodlineIds}
              options={
                bloodlines?.map((bloodline) => ({
                  value: bloodline.id,
                  label: bloodline.name,
                })) || []
              }
              onChange={(e) => setBloodlineIds(e as string[])}
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default ItemBalanceFiltering;

/**
 * Combine filters into final object
 */
export const getFilter = (state: ItemBalanceFilteringState) => {
  return {
    battleTypes: state.battleTypes.length > 0 ? state.battleTypes : undefined,
    minCount: state.minCount,
    itemTypes: state.itemTypes.length > 0 ? state.itemTypes : undefined,
    bloodlineIds: state.bloodlineIds.length > 0 ? state.bloodlineIds : undefined,
  };
};
