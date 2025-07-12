import { useEffect } from "react";
import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { effectFilters } from "@/libs/train";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { searchJutsuSchema } from "@/validators/jutsu";
import { Filter } from "lucide-react";
import Toggle from "@/components/control/Toggle";
import { useUserData } from "@/utils/UserContext";
import { canChangeContent } from "@/utils/permissions";
import type { SearchJutsuSchema } from "@/validators/jutsu";
import type { EffectType } from "@/libs/train";

interface SkillTreeFilteringProps {
  state: SkillTreeFilteringState;
}

const SkillTreeFiltering: React.FC<SkillTreeFilteringProps> = (props) => {
  // Global state
  const { data: userData } = useUserData();

  // Destructure the state
  const { setName, setEffect, setHidden, setTier, setCostSkillPoints } = props.state;
  const { name, effect, hidden, tier, costSkillPoints } = props.state;

  // Name search schema
  const form = useForm<SearchJutsuSchema>({
    resolver: zodResolver(searchJutsuSchema),
    defaultValues: { name: name },
  });
  const watchName = useWatch({ control: form.control, name: "name", defaultValue: "" });

  // Update the state
  useEffect(() => {
    const delayDebounceFn = setTimeout(() => {
      setName(watchName);
    }, 500);
    return () => clearTimeout(delayDebounceFn);
  }, [watchName, setName]);

  // Tier options (1-10)
  const tierOptions = Array.from({ length: 10 }, (_, i) => i + 1);
  
  // Cost options (common skill point costs)
  const costOptions = [1, 2, 3, 4, 5, 10, 15, 20];

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button id="filter-skill">
          <Filter className="sm:mr-2 h-6 w-6 hover:text-orange-500" />
          <p className="hidden sm:block">Filter</p>
        </Button>
      </PopoverTrigger>
      <PopoverContent>
        <div className="grid grid-cols-2 gap-1 gap-x-3">
          {/* SKILL NAME */}
          <div>
            <Form {...form}>
              <Label htmlFor="name">Name</Label>
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Input id="name" placeholder="Search skill" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </Form>
          </div>
          
          {/* Effect */}
          <div>
            <Select onValueChange={(e) => setEffect(e as EffectType)}>
              <Label htmlFor="effect">Effect</Label>
              <SelectTrigger>
                <SelectValue placeholder={effect} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem key={"Any-effect"} value={"ANY"}>
                  ANY
                </SelectItem>
                {effectFilters.map((ef) => (
                  <SelectItem key={ef} value={ef}>
                    {ef}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Tier */}
          <div>
            <Select onValueChange={(e) => setTier(e === "ANY" ? "ANY" : parseInt(e))}>
              <Label htmlFor="tier">Tier</Label>
              <SelectTrigger>
                <SelectValue placeholder={tier === "ANY" ? "ANY" : tier?.toString()} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem key={"Any-tier"} value={"ANY"}>
                  ANY
                </SelectItem>
                {tierOptions.map((t) => (
                  <SelectItem key={t} value={t.toString()}>
                    Tier {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Cost */}
          <div>
            <Select onValueChange={(e) => setCostSkillPoints(e === "ANY" ? "ANY" : parseInt(e))}>
              <Label htmlFor="cost">Skill Points Cost</Label>
              <SelectTrigger>
                <SelectValue placeholder={costSkillPoints === "ANY" ? "ANY" : costSkillPoints?.toString()} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem key={"Any-cost"} value={"ANY"}>
                  ANY
                </SelectItem>
                {costOptions.map((c) => (
                  <SelectItem key={c} value={c.toString()}>
                    {c} points
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Hidden */}
          {userData && canChangeContent(userData.role) && (
            <div className="mt-1 col-span-2">
              <Toggle
                verticalLayout
                id="toggle-hidden-only"
                value={hidden}
                setShowActive={setHidden}
                labelActive="Hidden"
                labelInactive="Non-Hidden"
              />
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default SkillTreeFiltering;

/** tRPC filter to be used on api.skillTree.getAll */
export const getFilter = (state: SkillTreeFilteringState) => {
  return {
    name: state.name ? state.name : undefined,
    effect: state.effect !== "ANY" ? state.effect : undefined,
    tier: state.tier !== "ANY" ? state.tier : undefined,
    costSkillPoints: state.costSkillPoints !== "ANY" ? state.costSkillPoints : undefined,
    hidden: state.hidden ? state.hidden : undefined,
  };
};

/** State for the SkillTree Filtering component */
export const useFiltering = () => {
  // State variables
  const [name, setName] = useState<string>("");
  const [effect, setEffect] = useState<(typeof effectFilters)[number] | "ANY">("ANY");
  const [tier, setTier] = useState<number | "ANY">("ANY");
  const [costSkillPoints, setCostSkillPoints] = useState<number | "ANY">("ANY");
  const [hidden, setHidden] = useState<boolean | undefined>(false);

  // Return all
  return {
    name,
    effect,
    tier,
    costSkillPoints,
    hidden,
    setName,
    setEffect,
    setTier,
    setCostSkillPoints,
    setHidden,
  };
};

/** State type */
export type SkillTreeFilteringState = ReturnType<typeof useFiltering>;