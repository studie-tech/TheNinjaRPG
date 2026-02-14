import {
  AttackMethods,
  AttackTargets,
  BattleUsageTypes,
  ElementNames,
  JutsuTypes,
  StatTypes,
  UserRanks,
} from "@/drizzle/constants";
import {
  buildFilter,
  ContentFiltering,
  defineFilteringSchema,
  useContentFiltering,
} from "@/layout/ContentFiltering";
import { rarities, statFilters } from "@/libs/train";
import { canChangeContent } from "@/utils/permissions";
import { formatBattleUsageType } from "@/utils/string";
import { useUserData } from "@/utils/UserContext";
import { effectFilters } from "@/validators/combat";

// Single-source schema
const makeJutsuFilteringSchema = () =>
  defineFilteringSchema({
    fields: [
      { id: "name", label: "Name", type: "text", defaultValue: "" },
      {
        id: "classification",
        label: "Classification",
        type: "single-select",
        defaultValue: "None",
        includeNone: true,
        emptyValues: ["None"],
        options: StatTypes.map((t) => ({ value: t, label: t })),
      },
      {
        id: "rarity",
        label: "Rarity",
        type: "single-select",
        defaultValue: "ALL",
        includeNone: true,
        emptyValues: ["ALL", "None"],
        options: rarities.map((r) => ({ value: r, label: r })),
      },
      {
        id: "bloodline",
        label: "Bloodline",
        type: "single-select",
        defaultValue: "None",
        includeNone: true,
        emptyValues: ["None"],
        dataSource: "bloodlines",
        filterOptions: (opts, ctx) => {
          const fixed = (ctx as { fixedBloodline?: string } | undefined)
            ?.fixedBloodline;
          const filtered = fixed ? opts.filter((o) => o.value === fixed) : opts;
          return filtered.sort((a, b) => a.label.localeCompare(b.label));
        },
      },
      {
        id: "element",
        label: "Elements",
        type: "multi-select",
        defaultValue: [],
        options: ElementNames.map((e) => ({ value: e, label: e })),
      },
      {
        id: "effect",
        label: "Effects",
        type: "multi-select",
        defaultValue: [],
        options: effectFilters.map((e) => ({ value: e, label: e })),
      },
      {
        id: "stat",
        label: "Stat",
        type: "multi-select",
        defaultValue: [],
        options: statFilters.map((s) => ({ value: s, label: s })),
      },
      {
        id: "method",
        label: "Method",
        type: "single-select",
        defaultValue: "None",
        includeNone: true,
        emptyValues: ["None"],
        options: AttackMethods.map((m) => ({ value: m, label: m })),
      },
      {
        id: "jutsuType",
        label: "Jutsu Type",
        type: "multi-select",
        defaultValue: [],
        options: JutsuTypes.map((t) => ({ value: t, label: t })),
      },
      {
        id: "target",
        label: "Target",
        type: "single-select",
        defaultValue: "None",
        includeNone: true,
        emptyValues: ["None"],
        options: AttackTargets.map((t) => ({ value: t, label: t })),
      },
      {
        id: "battleUsageType",
        label: "Battle Type",
        type: "single-select",
        defaultValue: "None",
        includeNone: true,
        emptyValues: ["None"],
        options: BattleUsageTypes.map((t) => ({
          value: t,
          label: formatBattleUsageType(t),
        })),
      },
      {
        id: "actionCostPerc",
        label: "Action Cost (%)",
        type: "number",
        defaultValue: undefined,
      },
      {
        id: "rank",
        label: "Required Rank",
        type: "multi-select",
        defaultValue: [],
        options: UserRanks.map((r) => ({ value: r, label: r })),
      },
      {
        id: "requiredLevel",
        label: "Required Level",
        type: "number",
        defaultValue: undefined,
      },
      {
        id: "hidden",
        label: "Visibility",
        type: "tri-state",
        defaultValue: undefined,
        visibleIf: (ctx) =>
          Boolean((ctx as { canEdit?: boolean } | undefined)?.canEdit),
        triStateLabels: {
          labelActive: "Hidden",
          labelInactive: "Visible",
          labelAll: "All Visibility",
        },
      },
      {
        id: "villageId",
        label: "Village",
        type: "single-select",
        defaultValue: "None",
        includeNone: true,
        emptyValues: ["None"],
        dataSource: "villages",
        filterOptions: (opts) => opts.sort((a, b) => a.label.localeCompare(b.label)),
      },
    ] as const,
    exclusions: [
      { key: "excludedJutsuTypes", label: "Jutsu Types", options: [...JutsuTypes] },
      {
        key: "excludedClassifications",
        label: "Classifications",
        options: [...StatTypes],
      },
      {
        key: "excludedRarities",
        label: "Rarities",
        options: [...(rarities as readonly string[])] as string[],
      },
      { key: "excludedRanks", label: "Ranks", options: [...UserRanks] },
      { key: "excludedMethods", label: "Methods", options: [...AttackMethods] },
      { key: "excludedTargets", label: "Targets", options: [...AttackTargets] },
      { key: "excludedElements", label: "Elements", options: [...ElementNames] },
      { key: "excludedEffects", label: "Effects", options: [...effectFilters] },
      { key: "excludedStats", label: "Stats", options: [...statFilters] },
    ] as const,
  });

export type JutsuFilteringState = ReturnType<typeof useFiltering>;

interface JutsuFilteringProps {
  state: JutsuFilteringState;
  fixedBloodline?: string | null;
}

export const useFiltering = () => {
  const cf = useContentFiltering(makeJutsuFilteringSchema());
  return {
    ...cf.values,
    cf,
    setBloodline: cf.setters.bloodline,
    setClassification: cf.setters.classification,
    setEffect: cf.setters.effect,
    setElement: cf.setters.element,
    setHidden: cf.setters.hidden,
    setJutsuType: cf.setters.jutsuType,
    setMethod: cf.setters.method,
    setName: cf.setters.name,
    setRank: cf.setters.rank,
    setRarity: cf.setters.rarity,
    setRequiredLevel: cf.setters.requiredLevel,
    setStat: cf.setters.stat,
    setTarget: cf.setters.target,
    setVillageId: cf.setters.villageId,
  };
};

const JutsuFiltering: React.FC<JutsuFilteringProps> = (props) => {
  const { data: userData } = useUserData();
  const context = {
    fixedBloodline: props.fixedBloodline ?? undefined,
    canEdit: Boolean(userData && canChangeContent(userData.role)),
  };
  return (
    <ContentFiltering
      schema={makeJutsuFilteringSchema()}
      state={props.state.cf}
      context={context}
    />
  );
};

export default JutsuFiltering;

export const getFilter = (state: JutsuFilteringState) =>
  buildFilter(state.cf, makeJutsuFilteringSchema());
