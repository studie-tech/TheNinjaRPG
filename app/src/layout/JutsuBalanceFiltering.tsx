import React, { useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { MultiSelect } from "@/components/ui/multi-select";
import { Filter } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { api } from "@/app/_trpc/client";

import { BattleTypes } from "@/drizzle/constants";
import { effectFilters } from "@/libs/train";
import type { BattleType } from "@/drizzle/constants";
import type { EffectType } from "@/libs/train";

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
  const [jutsuEffects, setJutsuEffects] = useState<EffectType[]>([]);
  const [bloodlineIds, setBloodlineIds] = useState<string[]>([]);

  return {
    battleTypes,
    minCount,
    jutsuEffects,
    bloodlineIds,
    setBattleTypes,
    setMinCount,
    setJutsuEffects,
    setBloodlineIds,
  };
};

export type JutsuBalanceFilteringState = ReturnType<typeof useFiltering>;

interface JutsuBalanceFilteringProps {
  state: JutsuBalanceFilteringState;
}

/**
 * MAIN COMPONENT
 */
const JutsuBalanceFiltering: React.FC<JutsuBalanceFilteringProps> = (props) => {
  const {
    battleTypes,
    minCount,
    jutsuEffects,
    bloodlineIds,
    setBattleTypes,
    setMinCount,
    setJutsuEffects,
    setBloodlineIds,
  } = props.state;

  // Fetch bloodline names for filtering
  const { data: bloodlines } = api.bloodline.getAllNames.useQuery(undefined);

  // Count filters
  const numBattleTypes = battleTypes.length;
  const numJutsuEffects = jutsuEffects.length;
  const numBloodlineIds = bloodlineIds.length;
  const numMinCount = minCount > 1 ? 1 : 0;
  const numFilters = numBattleTypes + numJutsuEffects + numBloodlineIds + numMinCount;

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

          {/* Jutsu Effects */}
          <div>
            <Label>Jutsu Effects</Label>
            <MultiSelect
              selected={jutsuEffects}
              options={effectFilters.map((effect) => ({
                value: effect,
                label: effect,
              }))}
              onChange={(e) => setJutsuEffects(e as EffectType[])}
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

export default JutsuBalanceFiltering;

/**
 * Combine filters into final object
 */
export const getFilter = (state: JutsuBalanceFilteringState) => {
  return {
    battleTypes: state.battleTypes.length > 0 ? state.battleTypes : undefined,
    minCount: state.minCount,
    jutsuEffects: state.jutsuEffects.length > 0 ? state.jutsuEffects : undefined,
    bloodlineIds: state.bloodlineIds.length > 0 ? state.bloodlineIds : undefined,
  };
};
