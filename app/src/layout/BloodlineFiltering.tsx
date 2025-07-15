import { useEffect } from "react";
import { useState } from "react";
import { api } from "@/app/_trpc/client";
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
import { MultiSelect } from "@/components/ui/multi-select";
import { ElementNames, LetterRanks } from "@/drizzle/constants";
import { statFilters, effectFilters } from "@/libs/train";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { searchJutsuSchema } from "@/validators/jutsu";
import { Filter } from "lucide-react";
import { StatTypes } from "@/drizzle/constants";
import { TriStateToggle } from "@/components/control/Toggle";
import { useUserData } from "@/utils/UserContext";
import { canChangeContent } from "@/utils/permissions";
import type { ElementName, LetterRank, StatType } from "@/drizzle/constants";
import type { SearchJutsuSchema } from "@/validators/jutsu";
import type { StatGenType, EffectType } from "@/libs/train";

interface BloodFilteringProps {
  state: BloodFilteringState;
  limitRanks?: LetterRank[];
}

const BloodFiltering: React.FC<BloodFilteringProps> = (props) => {
  // Global state
  const { data: userData } = useUserData();

  // Destructure the state
  const { setVillage, setStat, setEffect, setHidden } = props.state;
  const { setName, setElement, setRank, setClassification } = props.state;
  const limitRanks = props.limitRanks ? props.limitRanks : LetterRanks;

  const { name, village, stat, effect, element } = props.state;
  const { rank, classification, hidden } = props.state;

  // Get all villages
  const { data: villages } = api.village.getAllNames.useQuery(undefined);

  // Filter shown bloodlines
  const villageData = villages?.find((b) => b.id === village);

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

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button id="filter-bloodline">
          <Filter className="sm:mr-2 h-6 w-6 hover:text-orange-500" />
          <p className="hidden sm:block">Filter</p>
        </Button>
      </PopoverTrigger>
      <PopoverContent>
        <div className="grid grid-cols-2 gap-1 gap-x-3">
          {/* BLOODLINE NAME */}
          <div>
            <Form {...form}>
              <Label htmlFor="rank">Name</Label>
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Input id="name" placeholder="Search bloodline" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </Form>
          </div>
          {/* Stat Classification */}
          <div>
            <Select onValueChange={(e) => setClassification(e as StatType)}>
              <Label htmlFor="rank">Classification</Label>
              <SelectTrigger>
                <SelectValue placeholder={classification} />
              </SelectTrigger>
              <SelectContent>
                {StatTypes.map((stat) => (
                  <SelectItem key={stat} value={stat}>
                    {stat}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {/* Rank */}
          <div>
            <Select onValueChange={(e) => setRank(e as LetterRank)}>
              <Label htmlFor="rank">Required Rank</Label>
              <SelectTrigger>
                <SelectValue placeholder={rank} />
              </SelectTrigger>
              <SelectContent>
                {limitRanks.map((rank) => (
                  <SelectItem key={rank} value={rank}>
                    {rank}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {/* Village */}
          <div>
            <Select onValueChange={(e) => setVillage(e)}>
              <Label htmlFor="village">Village</Label>
              <SelectTrigger>
                <SelectValue placeholder={villageData?.name || "None"} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem key={"None"} value="None">
                  None
                </SelectItem>
                {villages
                  ?.sort((a, b) => (a.name < b.name ? -1 : 1))
                  .map((village) => (
                    <SelectItem key={village.name} value={village.id}>
                      {village.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          {/* Element */}
          <div>
            <Label htmlFor="element">Elements</Label>
            <MultiSelect
              selected={element}
              options={ElementNames.map((element) => ({
                value: element,
                label: element,
              }))}
              onChange={setElement}
            />
          </div>
          {/* Effect */}
          <div className="">
            <Label htmlFor="effect">Effects</Label>
            <MultiSelect
              selected={effect}
              options={effectFilters.map((effect) => ({
                value: effect,
                label: effect,
              }))}
              onChange={setEffect}
            />
          </div>

          {/* Stat */}
          <div className="">
            <Label htmlFor="stat">Stat</Label>
            <MultiSelect
              selected={stat}
              options={statFilters.map((stat) => ({ value: stat, label: stat }))}
              onChange={setStat}
            />
          </div>
          {/* Hidden */}
          {userData && canChangeContent(userData.role) && (
            <div className="mt-1">
              <Label htmlFor="toggle-hidden-only">Visibility</Label>
              <TriStateToggle
                verticalLayout
                id="toggle-hidden-only"
                value={hidden}
                setShowActive={setHidden}
                labelActive="Hidden"
                labelInactive="Visible"
                labelAll="All Visibility"
              />
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default BloodFiltering;

/** tRPC filter to be used on api.bloodline.getAll */
export const getFilter = (state: BloodFilteringState) => {
  return {
    name: state.name ? state.name : undefined,
    village: state.village !== "None" ? state.village : undefined,
    rank: state.rank !== "None" ? state.rank : undefined,
    classification: state.classification !== "None" ? state.classification : undefined,
    hidden: state.hidden,
    // Multiple selects
    element: state.element.length !== 0 ? (state.element as ElementName[]) : undefined,
    stat: state.stat.length !== 0 ? (state.stat as StatGenType[]) : undefined,
    effect: state.effect.length !== 0 ? (state.effect as EffectType[]) : undefined,
  };
};

/** State for the Bloodline Filtering component */
type None = "None";
export const useFiltering = (defaultRank: LetterRank | None = "None") => {
  // State variables
  const [rank, setRank] = useState<LetterRank | None>(defaultRank);
  const [name, setName] = useState<string>("");
  const [village, setVillage] = useState<string>("None");
  const [classification, setClassification] = useState<StatType | None>("None");
  // Multiple selects
  const [element, setElement] = useState<string[]>([]);
  const [stat, setStat] = useState<string[]>([]);
  const [effect, setEffect] = useState<string[]>([]);
  const [hidden, setHidden] = useState<boolean | undefined>(undefined);

  // Return all
  return {
    classification,
    effect,
    element,
    hidden,
    name,
    rank,
    setClassification,
    setEffect,
    setElement,
    setHidden,
    setName,
    setRank,
    setStat,
    setVillage,
    stat,
    village,
  };
};

/** State type */
export type BloodFilteringState = ReturnType<typeof useFiltering>;
