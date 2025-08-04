import React, { useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { MultiSelect } from "@/components/ui/multi-select";
import { Filter } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import { BattleTypes, LetterRanks, StatTypes } from "@/drizzle/constants";
import type { BattleType, LetterRank, StatType } from "@/drizzle/constants";

/**
 * STATE HOOK
 */
export const useFiltering = () => {
  const [battleTypes, setBattleTypes] = useState<BattleType[]>([]);
  const [minCount, setMinCount] = useState<number>(1);
  const [bloodlineRanks, setBloodlineRanks] = useState<LetterRank[]>([]);
  const [statClassifications, setStatClassifications] = useState<StatType[]>([]);

  return {
    battleTypes,
    minCount,
    bloodlineRanks,
    statClassifications,
    setBattleTypes,
    setMinCount,
    setBloodlineRanks,
    setStatClassifications,
  };
};

export type BloodlineBalanceFilteringState = ReturnType<typeof useFiltering>;

interface BloodlineBalanceFilteringProps {
  state: BloodlineBalanceFilteringState;
}

/**
 * MAIN COMPONENT
 */
const BloodlineBalanceFiltering: React.FC<BloodlineBalanceFilteringProps> = (props) => {
  const {
    battleTypes,
    minCount,
    bloodlineRanks,
    statClassifications,
    setBattleTypes,
    setMinCount,
    setBloodlineRanks,
    setStatClassifications,
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

          {/* Bloodline Ranks */}
          <div>
            <Label>Bloodline Ranks</Label>
            <MultiSelect
              selected={bloodlineRanks}
              options={LetterRanks.map((rank) => ({
                value: rank,
                label: rank,
              }))}
              onChange={(e) => setBloodlineRanks(e as LetterRank[])}
            />
          </div>

          {/* Stat Classifications */}
          <div>
            <Label>Stat Classifications</Label>
            <MultiSelect
              selected={statClassifications}
              options={StatTypes.map((stat) => ({
                value: stat,
                label: stat,
              }))}
              onChange={(e) => setStatClassifications(e as StatType[])}
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default BloodlineBalanceFiltering;

/**
 * Combine filters into final object
 */
export const getFilter = (state: BloodlineBalanceFilteringState) => {
  return {
    battleTypes: state.battleTypes.length > 0 ? state.battleTypes : undefined,
    minCount: state.minCount,
    bloodlineRanks: state.bloodlineRanks.length > 0 ? state.bloodlineRanks : undefined,
    statClassifications:
      state.statClassifications.length > 0 ? state.statClassifications : undefined,
  };
};
