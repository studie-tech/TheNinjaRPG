import { Filter } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MultiSelect } from "@/components/ui/multi-select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { EffectType } from "@/validators/combat";
import { effectFilters } from "@/validators/combat";

/**
 * STATE HOOK
 */
export const useFiltering = () => {
  const [minCount, setMinCount] = useState<number>(1);
  const [skillEffects, setSkillEffects] = useState<EffectType[]>([]);
  const [tiers, setTiers] = useState<number[]>([]);

  return {
    minCount,
    skillEffects,
    tiers,
    setMinCount,
    setSkillEffects,
    setTiers,
  };
};

export type SkillTreeBalanceFilteringState = ReturnType<typeof useFiltering>;

interface SkillTreeBalanceFilteringProps {
  state: SkillTreeBalanceFilteringState;
}

/**
 * MAIN COMPONENT
 */
const SkillTreeBalanceFiltering: React.FC<SkillTreeBalanceFilteringProps> = (props) => {
  const { minCount, skillEffects, tiers, setMinCount, setSkillEffects, setTiers } =
    props.state;

  // Count filters
  const numSkillEffects = skillEffects.length;
  const numTiers = tiers.length;
  const numMinCount = minCount > 1 ? 1 : 0;
  const numFilters = numSkillEffects + numTiers + numMinCount;

  // Tier options (1-10)
  const tierOptions = Array.from({ length: 10 }, (_, i) => i + 1);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button count={numFilters}>
          <Filter className="h-6 w-6 hover:text-orange-500 sm:mr-2" />
          <p className="hidden sm:block">Filter</p>
        </Button>
      </PopoverTrigger>

      <PopoverContent className="min-w-96">
        <div className="grid grid-cols-1 gap-4">
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

          {/* Skill Effects */}
          <div>
            <Label>Skill Effects</Label>
            <MultiSelect
              selected={skillEffects}
              options={effectFilters.map((effect) => ({
                value: effect,
                label: effect,
              }))}
              onChange={(e) => setSkillEffects(e as EffectType[])}
            />
          </div>

          {/* Tiers */}
          <div>
            <Label>Skill Tiers</Label>
            <MultiSelect
              selected={tiers.map((tier) => tier.toString())}
              options={tierOptions.map((tier) => ({
                value: tier.toString(),
                label: `Tier ${tier}`,
              }))}
              onChange={(selectedTiers) => {
                const tiersArray =
                  typeof selectedTiers === "function"
                    ? selectedTiers(tiers.map((tier) => tier.toString()))
                    : selectedTiers;
                setTiers(tiersArray.map((tier) => parseInt(tier, 10)));
              }}
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default SkillTreeBalanceFiltering;

/**
 * Combine filters into final object
 */
export const getFilter = (state: SkillTreeBalanceFilteringState) => {
  return {
    minCount: state.minCount,
    skillEffects: state.skillEffects.length > 0 ? state.skillEffects : undefined,
    tiers: state.tiers.length > 0 ? state.tiers : undefined,
  };
};
