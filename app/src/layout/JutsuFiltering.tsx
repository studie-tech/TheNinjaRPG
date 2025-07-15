import React, { useEffect, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { MultiSelect } from "@/components/ui/multi-select";
import { TriStateToggle } from "@/components/control/Toggle";
import { Filter } from "lucide-react";
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

import { api } from "@/app/_trpc/client";
import { useUserData } from "@/utils/UserContext";
import { canChangeContent } from "@/utils/permissions";
import { searchJutsuSchema } from "@/validators/jutsu";
import { X } from "lucide-react";
import {
  ElementNames,
  UserRanks,
  StatTypes,
  AttackMethods,
  AttackTargets,
  JutsuTypes, // ["AI","NORMAL","BOSS","LOOT","EVENT"]
} from "@/drizzle/constants";

import { statFilters, effectFilters, rarities } from "@/libs/train";
import type { SearchJutsuSchema } from "@/validators/jutsu";
import type {
  LetterRank,
  ElementName,
  UserRank,
  StatType,
  JutsuType,
  AttackMethod,
  AttackTarget,
} from "@/drizzle/constants";
import type { StatGenType, EffectType, RarityType } from "@/libs/train";

// New type definitions
type ExclusionCategory =
  | "type"
  | "classification"
  | "effect"
  | "element"
  | "method"
  | "rarity"
  | "rank"
  | "stat"
  | "target";

// Reusable FilterSelect component
interface FilterSelectProps {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  options: { value: string; label: string }[]; // ✅ Now supports objects
  includeNone?: boolean;
}

const FilterSelect: React.FC<FilterSelectProps> = ({
  label,
  value,
  onValueChange,
  options,
  includeNone = true,
}) => (
  <div>
    <Label>{label}</Label>
    <Select onValueChange={onValueChange} value={value}>
      <SelectTrigger>
        <SelectValue>
          {options.find((opt) => opt.value === value)?.label || "None"}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {includeNone && (
          <SelectItem key="None" value="None">
            None
          </SelectItem>
        )}
        {options.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  </div>
);

// Reusable ExcludedItemsList component
interface ExcludedItemsListProps {
  title: string;
  items: string[];
  category: ExclusionCategory;
  onRemove: (category: ExclusionCategory, item: string) => void;
}

const ExcludedItemsList: React.FC<ExcludedItemsListProps> = ({
  title,
  items,
  category,
  onRemove,
}) => {
  if (items.length === 0) return null;

  return (
    <p className="text-sm mt-2">
      <strong>{title}:</strong>{" "}
      {items.map((item) => (
        <span key={item} className="inline-flex items-center mr-2">
          {item}
          <Button
            variant="destructive"
            size="sm"
            className="ml-1 px-2"
            onClick={() => onRemove(category, item)}
          >
            <X className="h-4 w-4" />
          </Button>
        </span>
      ))}
    </p>
  );
};

// Exclusion categories configuration
const EXCLUSION_CATEGORIES: Record<
  ExclusionCategory,
  {
    label: string;
    options: string[];
  }
> = {
  classification: {
    label: "Classifications",
    options: [...StatTypes],
  },
  effect: {
    label: "Effects",
    options: [...effectFilters],
  },
  element: {
    label: "Elements",
    options: [...ElementNames],
  },
  type: {
    label: "Jutsu Types",
    options: [...JutsuTypes],
  },
  method: {
    label: "Methods",
    options: [...AttackMethods],
  },
  rank: {
    label: "Ranks",
    options: [...UserRanks],
  },
  rarity: {
    label: "Rarities",
    options: [...rarities],
  },
  stat: {
    label: "Stats",
    options: [...statFilters],
  },
  target: {
    label: "Targets",
    options: [...AttackTargets],
  },
};

/**
 * STATE HOOK
 */
export const useFiltering = () => {
  type None = "None";

  // -------------------------
  // "Include" states
  // -------------------------
  const [appearAnim, setAppearAnim] = useState<string>("None");
  const [bloodline, setBloodline] = useState<string>("None");
  const [classification, setClassification] = useState<StatType | None>("None");
  const [effect, setEffect] = useState<string[]>([]);
  const [element, setElement] = useState<string[]>([]);
  const [jutsuType, setJutsuType] = useState<JutsuType[]>([]);
  const [method, setMethod] = useState<AttackMethod | None>("None");
  const [name, setName] = useState<string>("");
  const [rank, setRank] = useState<UserRank>("NONE");
  const [requiredLevel, setRequiredLevel] = useState<number>(1);
  const [rarity, setRarity] = useState<RarityType>("ALL");
  const [removeAnim, setRemoveAnim] = useState<string>("None");
  const [stat, setStat] = useState<string[]>([]);
  const [staticAnim, setStaticAnim] = useState<string>("None");
  const [target, setTarget] = useState<AttackTarget | None>("None");
  const [hidden, setHidden] = useState<boolean | undefined>(undefined);
  const [villageId, setVillageId] = useState<string | null>("None");

  // -------------------------
  // "Exclude" states
  // -------------------------
  // The DB column is "type", but we'll store excluded items in excludedJutsuTypes.
  const [excludedJutsuTypes, setExcludedJutsuTypes] = useState<string[]>([]);
  const [excludedClassifications, setExcludedClassifications] = useState<StatType[]>(
    [],
  );
  const [excludedRarities, setExcludedRarities] = useState<RarityType[]>([]);
  const [excludedRanks, setExcludedRanks] = useState<UserRank[]>([]);
  const [excludedMethods, setExcludedMethods] = useState<AttackMethod[]>([]);
  const [excludedTargets, setExcludedTargets] = useState<AttackTarget[]>([]);
  const [excludedElements, setExcludedElements] = useState<ElementName[]>([]);
  const [excludedEffects, setExcludedEffects] = useState<EffectType[]>([]);
  const [excludedStats, setExcludedStats] = useState<StatGenType[]>([]);

  return {
    // includes
    appearAnim,
    bloodline,
    classification,
    effect,
    element,
    hidden,
    jutsuType,
    method,
    name,
    rank,
    rarity,
    removeAnim,
    requiredLevel,
    stat,
    staticAnim,
    target,
    villageId,

    // excludes
    excludedJutsuTypes,
    excludedClassifications,
    excludedRarities,
    excludedRanks,
    excludedMethods,
    excludedTargets,
    excludedElements,
    excludedEffects,
    excludedStats,

    // set states
    setAppearAnim,
    setBloodline,
    setClassification,
    setEffect,
    setElement,
    setHidden,
    setJutsuType,
    setMethod,
    setName,
    setRank,
    setRarity,
    setRemoveAnim,
    setRequiredLevel,
    setStat,
    setStaticAnim,
    setTarget,
    setVillageId,

    // exclude setters
    setExcludedJutsuTypes,
    setExcludedClassifications,
    setExcludedRarities,
    setExcludedRanks,
    setExcludedMethods,
    setExcludedTargets,
    setExcludedElements,
    setExcludedEffects,
    setExcludedStats,
  };
};

export type JutsuFilteringState = ReturnType<typeof useFiltering>;

interface JutsuFilteringProps {
  state: JutsuFilteringState;
  fixedBloodline?: string | null;
}

/**
 * MAIN COMPONENT
 */
const JutsuFiltering: React.FC<JutsuFilteringProps> = (props) => {
  const {
    // includes
    appearAnim,
    bloodline,
    classification,
    effect,
    element,
    hidden,
    jutsuType,
    method,
    name,
    rank,
    rarity,
    removeAnim,
    requiredLevel,
    stat,
    staticAnim,
    target,
    villageId,

    // excludes
    excludedJutsuTypes,
    excludedClassifications,
    excludedRarities,
    excludedRanks,
    excludedMethods,
    excludedTargets,
    excludedElements,
    excludedEffects,
    excludedStats,

    // set states
    setAppearAnim,
    setBloodline,
    setClassification,
    setEffect,
    setElement,
    setHidden,
    setJutsuType,
    setMethod,
    setName,
    setRank,
    setRarity,
    setRemoveAnim,
    setRequiredLevel,
    setStat,
    setStaticAnim,
    setTarget,
    setVillageId,

    // exclude setters
    setExcludedJutsuTypes,
    setExcludedClassifications,
    setExcludedRarities,
    setExcludedRanks,
    setExcludedMethods,
    setExcludedTargets,
    setExcludedElements,
    setExcludedEffects,
    setExcludedStats,
  } = props.state;

  const { data: userData } = useUserData();
  const { fixedBloodline } = props;

  // React Hook Form for name & requiredLevel
  const form = useForm<SearchJutsuSchema>({
    resolver: zodResolver(searchJutsuSchema),
    defaultValues: { name },
  });
  const watchName = useWatch({
    control: form.control,
    name: "name",
    defaultValue: undefined,
  });
  const watchRequiredLevel = useWatch({
    control: form.control,
    name: "requiredLevel",
    defaultValue: requiredLevel,
  });

  // Debounce name changes
  useEffect(() => {
    const delayDebounceFn = setTimeout(() => {
      setName(watchName);
    }, 500);
    return () => clearTimeout(delayDebounceFn);
  }, [watchName, setName]);

  // Debounce requiredLevel changes
  useEffect(() => {
    if (watchRequiredLevel) {
      const delayDebounceFn = setTimeout(() => {
        setRequiredLevel(watchRequiredLevel);
      }, 500);
      return () => clearTimeout(delayDebounceFn);
    }
  }, [watchRequiredLevel, setRequiredLevel]);

  // Data queries
  const { data: bloodlineData } = api.bloodline.getAllNames.useQuery(undefined);
  const { data: assetData } = api.misc.getAllGameAssetNames.useQuery(undefined);
  const { data: villageData } = api.village.getAllNames.useQuery(undefined);

  // Filter bloodlines if user has a fixedBloodline
  const bloodlines = fixedBloodline
    ? bloodlineData?.filter((b) => b.id === fixedBloodline)
    : bloodlineData;

  // Exclusion popover
  const [showExclusionPopover, setShowExclusionPopover] = useState(false);
  const [exclusionCategory, setExclusionCategory] =
    useState<ExclusionCategory>("element");
  const [tempExclusions, setTempExclusions] = useState<string[]>([]);

  // Confirm new exclusions
  const handleAddExclusions = () => {
    const newExclusions = [...new Set(tempExclusions)];

    switch (exclusionCategory) {
      case "type":
        setExcludedJutsuTypes(newExclusions);
        break;

      case "classification":
        setExcludedClassifications(newExclusions as StatType[]);
        break;
      case "rarity":
        setExcludedRarities(newExclusions as RarityType[]);
        break;
      case "rank":
        setExcludedRanks(newExclusions as UserRank[]);
        break;
      case "method":
        setExcludedMethods(newExclusions as AttackMethod[]);
        break;
      case "target":
        setExcludedTargets(newExclusions as AttackTarget[]);
        break;

      // Multi-value JSON
      case "element":
        setExcludedElements(newExclusions as ElementName[]);
        break;
      case "effect":
        setExcludedEffects(newExclusions as EffectType[]);
        break;
      case "stat":
        setExcludedStats(newExclusions as StatGenType[]);
        break;
      default:
        break;
    }

    setTempExclusions([]);
    setShowExclusionPopover(false);
  };

  // Remove a single exclusion
  const handleRemoveExcludedItem = (
    category:
      | "type"
      | "classification"
      | "effect"
      | "element"
      | "method"
      | "rarity"
      | "rank"
      | "stat"
      | "target",
    item: string,
  ) => {
    switch (category) {
      case "type":
        setExcludedJutsuTypes((prev) => prev.filter((x) => x !== item));
        break;
      case "classification":
        setExcludedClassifications((prev) => prev.filter((c) => c !== item));
        break;
      case "rarity":
        setExcludedRarities((prev) => prev.filter((r) => r !== item));
        break;
      case "rank":
        setExcludedRanks((prev) => prev.filter((r) => r !== item));
        break;
      case "method":
        setExcludedMethods((prev) => prev.filter((m) => m !== item));
        break;
      case "target":
        setExcludedTargets((prev) => prev.filter((t) => t !== item));
        break;

      // Multi-value JSON
      case "element":
        setExcludedElements((prev) => prev.filter((el) => el !== item));
        break;
      case "effect":
        setExcludedEffects((prev) => prev.filter((ef) => ef !== item));
        break;
      case "stat":
        setExcludedStats((prev) => prev.filter((st) => st !== item));
        break;
      default:
        break;
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button>
          <Filter className="sm:mr-2 h-6 w-6 hover:text-orange-500" />
          <p className="hidden sm:block">Filter</p>
        </Button>
      </PopoverTrigger>

      <PopoverContent className="min-w-96">
        {/* MAIN FILTERS GRID */}
        <div className="grid grid-cols-2 gap-1 gap-x-3">
          {/* Name */}
          <div>
            <Form {...form}>
              <Label>Name</Label>
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Input id="name" placeholder="Search jutsu" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </Form>
          </div>

          {/* Classification */}
          <FilterSelect
            label="Classification"
            value={classification}
            onValueChange={(e) => setClassification(e as StatType)}
            options={StatTypes.map((type) => ({
              value: type,
              label: type,
            }))}
          />

          {/* Rarity */}
          <FilterSelect
            label="Rarity"
            value={rarity}
            onValueChange={(e) => setRarity(e as RarityType)}
            options={rarities.map((rarity) => ({
              value: rarity,
              label: rarity,
            }))}
          />

          {/* Bloodline */}
          <FilterSelect
            label="Bloodline"
            value={bloodline}
            onValueChange={setBloodline}
            options={
              bloodlines
                ?.sort((a, b) => a.name.localeCompare(b.name))
                .map((bl) => ({
                  value: bl.id, // Keep filtering by ID
                  label: bl.name, // Show the bloodline name
                })) || []
            }
          />

          {/* Animations */}
          <FilterSelect
            label="Appear‎ ‎ ‎ ‎Animation"
            value={appearAnim}
            onValueChange={setAppearAnim}
            options={
              assetData
                ?.sort((a, b) => (a.name < b.name ? -1 : 1))
                .map((asset) => ({
                  value: asset.id, // Keep the ID for filtering
                  label: asset.name, // Show the name in dropdown
                })) || []
            }
          />

          <FilterSelect
            label="Disappear Animation"
            value={removeAnim}
            onValueChange={setRemoveAnim}
            options={
              assetData
                ?.sort((a, b) => (a.name < b.name ? -1 : 1))
                .map((asset) => ({
                  value: asset.id,
                  label: asset.name,
                })) || []
            }
          />

          <FilterSelect
            label="Static Animation"
            value={staticAnim}
            onValueChange={setStaticAnim}
            options={
              assetData
                ?.sort((a, b) => (a.name < b.name ? -1 : 1))
                .map((asset) => ({
                  value: asset.id,
                  label: asset.name,
                })) || []
            }
          />

          {/* Elements */}
          <div>
            <Label>Elements</Label>
            <MultiSelect
              selected={element}
              options={ElementNames.map((el) => ({ value: el, label: el }))}
              onChange={setElement}
            />
          </div>

          {/* Effects */}
          <div>
            <Label>Effects</Label>
            <MultiSelect
              selected={effect}
              options={effectFilters.map((ef) => ({ value: ef, label: ef }))}
              onChange={setEffect}
            />
          </div>

          {/* Stat */}
          <div>
            <Label>Stat</Label>
            <MultiSelect
              selected={stat}
              options={statFilters.map((sf) => ({ value: sf, label: sf }))}
              onChange={setStat}
            />
          </div>

          {/* Method */}
          <FilterSelect
            label="Method"
            value={method}
            onValueChange={(m) => setMethod(m as AttackMethod)}
            options={AttackMethods.map((method) => ({
              value: method,
              label: method,
            }))}
          />

          {/* Jutsu Type */}
          <div>
            <Label>Jutsu Type</Label>
            <MultiSelect
              selected={jutsuType}
              options={JutsuTypes.map((type) => ({ value: type, label: type }))}
              onChange={(e) => setJutsuType(e as JutsuType[])}
            />
          </div>

          {/* Target */}
          <FilterSelect
            label="Target"
            value={target}
            onValueChange={(m) => setTarget(m as AttackTarget)}
            options={AttackTargets.map((target) => ({
              value: target,
              label: target,
            }))}
          />

          {/* Required Rank */}
          <FilterSelect
            label="Required Rank"
            value={rank}
            onValueChange={(e) => setRank(e as UserRank)}
            options={UserRanks.map((rank) => ({
              value: rank,
              label: rank,
            }))}
            includeNone={false}
          />

          {/* Required Level */}
          <div>
            <Form {...form}>
              <Label>Required Level</Label>
              <FormField
                control={form.control}
                name="requiredLevel"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Input type="number" placeholder="Required level" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </Form>
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

          {/* Village */}
          <FilterSelect
            label="Village"
            value={villageId || "None"}
            onValueChange={setVillageId}
            options={
              villageData
                ?.sort((a, b) => a.name.localeCompare(b.name))
                .map((village) => ({
                  value: village.id,
                  label: village.name,
                })) || []
            }
          />
        </div>

        {/* EXCLUSION AREA */}
        <div className="mt-3 p-2 border-t border-gray-300">
          <div className="flex justify-between items-center">
            <Label>Exclusions</Label>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowExclusionPopover(true)}
            >
              + Add Exclusion
            </Button>
          </div>

          {/* Render all exclusion lists */}
          <ExcludedItemsList
            title="Excluded Jutsu Types"
            items={excludedJutsuTypes}
            category="type"
            onRemove={handleRemoveExcludedItem}
          />
          <ExcludedItemsList
            title="Excluded Classifications"
            items={excludedClassifications}
            category="classification"
            onRemove={handleRemoveExcludedItem}
          />
          <ExcludedItemsList
            title="Excluded Rarities"
            items={excludedRarities}
            category="rarity"
            onRemove={handleRemoveExcludedItem}
          />
          <ExcludedItemsList
            title="Excluded Ranks"
            items={excludedRanks}
            category="rank"
            onRemove={handleRemoveExcludedItem}
          />
          <ExcludedItemsList
            title="Excluded Methods"
            items={excludedMethods}
            category="method"
            onRemove={handleRemoveExcludedItem}
          />
          <ExcludedItemsList
            title="Excluded Targets"
            items={excludedTargets}
            category="target"
            onRemove={handleRemoveExcludedItem}
          />
          <ExcludedItemsList
            title="Excluded Elements"
            items={excludedElements}
            category="element"
            onRemove={handleRemoveExcludedItem}
          />
          <ExcludedItemsList
            title="Excluded Effects"
            items={excludedEffects}
            category="effect"
            onRemove={handleRemoveExcludedItem}
          />
          <ExcludedItemsList
            title="Excluded Stats"
            items={excludedStats}
            category="stat"
            onRemove={handleRemoveExcludedItem}
          />
        </div>

        {/* EXCLUSION POPOVER FOR ADDING NEW */}
        {showExclusionPopover && (
          <div className="mt-2 border p-2 rounded">
            <Label>Pick Category</Label>
            <Select
              onValueChange={(val) => {
                setExclusionCategory(val as ExclusionCategory);
                setTempExclusions([]);
              }}
              defaultValue={exclusionCategory}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(EXCLUSION_CATEGORIES).map(([key, { label }]) => (
                  <SelectItem key={key} value={key}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Label className="mt-2">Exclude Items</Label>
            <MultiSelect
              selected={tempExclusions}
              options={
                exclusionCategory in EXCLUSION_CATEGORIES
                  ? EXCLUSION_CATEGORIES[exclusionCategory].options.map((val) => ({
                      value: val,
                      label: val,
                    }))
                  : []
              }
              onChange={setTempExclusions}
            />

            <div className="mt-3 flex gap-2">
              <Button onClick={handleAddExclusions}>Confirm</Button>
              <Button variant="ghost" onClick={() => setShowExclusionPopover(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
};

export default JutsuFiltering;

/**
 * Combine includes + excludes into final object
 */
export const getFilter = (state: JutsuFilteringState) => {
  const processArray = <T,>(arr: T[]) => (arr.length > 0 ? arr : undefined);

  return {
    // Includes
    appear: state.appearAnim === "None" ? undefined : state.appearAnim,
    bloodline: state.bloodline === "None" ? undefined : state.bloodline,
    classification: state.classification === "None" ? undefined : state.classification,
    disappear: state.removeAnim === "None" ? undefined : state.removeAnim,
    effect: processArray(state.effect as EffectType[]),
    element: processArray(state.element as ElementName[]),
    jutsuType: processArray(state.jutsuType),
    method: state.method === "None" ? undefined : state.method,
    name: state.name || undefined,
    rank: state.rank === "NONE" ? undefined : state.rank,
    rarity: ["ALL", "None"].includes(state.rarity)
      ? undefined
      : (state.rarity as LetterRank),
    requiredLevel: state.requiredLevel ?? undefined,
    stat: processArray(state.stat as StatGenType[]),
    static: state.staticAnim === "None" ? undefined : state.staticAnim,
    target: state.target === "None" ? undefined : state.target,
    hidden: state.hidden,
    villageId: state.villageId === "None" ? undefined : state.villageId,

    // Exclusions
    ...Object.fromEntries(
      Object.entries({
        excludedJutsuTypes: state.excludedJutsuTypes,
        excludedClassifications: state.excludedClassifications,
        excludedRarities: state.excludedRarities,
        excludedRanks: state.excludedRanks,
        excludedMethods: state.excludedMethods,
        excludedTargets: state.excludedTargets,
        excludedElements: state.excludedElements,
        excludedEffects: state.excludedEffects,
        excludedStats: state.excludedStats,
      }).map(([key, value]) => [key, processArray(value)]),
    ),
  };
};
