import React, { useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { MultiSelect } from "@/components/ui/multi-select";
import { Filter } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import { BattleTypes, UserRanks, STARTER_VILLAGES } from "@/drizzle/constants";
import type { BattleType, UserRank, StarterVillage } from "@/drizzle/constants";

/**
 * STATE HOOK
 */
export const useFiltering = () => {
  const [battleTypes, setBattleTypes] = useState<BattleType[]>([]);
  const [minCount, setMinCount] = useState<number>(1);
  const [userRanks, setUserRanks] = useState<UserRank[]>([]);
  const [villages, setVillages] = useState<StarterVillage[]>([]);
  const [minLevel, setMinLevel] = useState<number>(1);
  const [maxLevel, setMaxLevel] = useState<number>(100);

  return {
    battleTypes,
    minCount,
    userRanks,
    villages,
    minLevel,
    maxLevel,
    setBattleTypes,
    setMinCount,
    setUserRanks,
    setVillages,
    setMinLevel,
    setMaxLevel,
  };
};

export type AiBalanceFilteringState = ReturnType<typeof useFiltering>;

interface AiBalanceFilteringProps {
  state: AiBalanceFilteringState;
}

/**
 * MAIN COMPONENT
 */
const AiBalanceFiltering: React.FC<AiBalanceFilteringProps> = (props) => {
  const {
    battleTypes,
    minCount,
    userRanks,
    villages,
    minLevel,
    maxLevel,
    setBattleTypes,
    setMinCount,
    setUserRanks,
    setVillages,
    setMinLevel,
    setMaxLevel,
  } = props.state;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button>
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

          {/* User Ranks */}
          <div>
            <Label>User Ranks</Label>
            <MultiSelect
              selected={userRanks}
              options={UserRanks.map((rank) => ({
                value: rank,
                label: rank,
              }))}
              onChange={(e) => setUserRanks(e as UserRank[])}
            />
          </div>

          {/* Villages */}
          <div>
            <Label>Villages</Label>
            <MultiSelect
              selected={villages}
              options={STARTER_VILLAGES.map((village) => ({
                value: village,
                label: village,
              }))}
              onChange={(e) => setVillages(e as StarterVillage[])}
            />
          </div>

          {/* Level Range */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Min Level</Label>
              <Input
                type="number"
                placeholder="Min level"
                min={1}
                max={100}
                value={minLevel}
                onChange={(e) => setMinLevel(Number(e.target.value) || 1)}
              />
            </div>
            <div>
              <Label>Max Level</Label>
              <Input
                type="number"
                placeholder="Max level"
                min={1}
                max={100}
                value={maxLevel}
                onChange={(e) => setMaxLevel(Number(e.target.value) || 100)}
              />
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default AiBalanceFiltering;

/**
 * Combine filters into final object
 */
export const getFilter = (state: AiBalanceFilteringState) => {
  return {
    battleTypes: state.battleTypes.length > 0 ? state.battleTypes : undefined,
    minCount: state.minCount,
    userRanks: state.userRanks.length > 0 ? state.userRanks : undefined,
    villages: state.villages.length > 0 ? state.villages : undefined,
    minLevel: state.minLevel,
    maxLevel: state.maxLevel,
  };
};
