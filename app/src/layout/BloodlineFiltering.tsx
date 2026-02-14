import type { LetterRank } from "@/drizzle/constants";
import { ElementNames, LetterRanks, StatTypes } from "@/drizzle/constants";
import {
  buildFilter,
  ContentFiltering,
  defineFilteringSchema,
  useContentFiltering,
} from "@/layout/ContentFiltering";
import { statFilters } from "@/libs/train";
import { canChangeContent } from "@/utils/permissions";
import { useUserData } from "@/utils/UserContext";
import { effectFilters } from "@/validators/combat";

// Inline schema
const makeBloodlineFilteringSchema = (
  limitRanks: LetterRank[],
  defaultRank: LetterRank | "None" = "None",
) =>
  defineFilteringSchema({
    fields: [
      { id: "name", label: "Name", type: "text", defaultValue: "" },
      {
        id: "classification",
        label: "Classification",
        type: "single-select",
        defaultValue: "None",
        options: StatTypes.map((s) => ({ value: s, label: s })),
        emptyValues: ["None"],
        includeNone: true,
      },
      {
        id: "rank",
        label: "Required Rank",
        type: "single-select",
        defaultValue: defaultRank,
        options: limitRanks.map((r) => ({ value: r, label: r })),
        emptyValues: ["None"],
        includeNone: true,
      },
      {
        id: "village",
        label: "Village",
        type: "single-select",
        defaultValue: "None",
        emptyValues: ["None"],
        includeNone: true,
        dataSource: "villages",
        filterOptions: (opts) => [
          { value: "None", label: "None" },
          ...opts.sort((a, b) => a.label.localeCompare(b.label)),
        ],
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
    ] as const,
  });

interface BloodFilteringProps {
  state: BloodFilteringState;
  limitRanks?: LetterRank[];
}

const BloodFiltering: React.FC<BloodFilteringProps> = (props) => {
  const { data: userData } = useUserData();
  const limitRanks = props.limitRanks ? props.limitRanks : [...LetterRanks];
  const schema = makeBloodlineFilteringSchema([...limitRanks]);
  const context = { canEdit: Boolean(userData && canChangeContent(userData.role)) };

  return (
    <ContentFiltering
      schema={schema}
      state={props.state.cf}
      context={context}
      triggerButtonId="filter-bloodline"
    />
  );
};

export default BloodFiltering;

export const getFilter = (
  state: BloodFilteringState,
  limitRanks: LetterRank[] = [...LetterRanks],
) => buildFilter(state.cf, makeBloodlineFilteringSchema([...limitRanks]));

/** State for the Bloodline Filtering component */
export const useFiltering = (defaultRank: LetterRank | "None" = "None") => {
  const schema = makeBloodlineFilteringSchema([...LetterRanks], defaultRank);
  const cf = useContentFiltering(schema);
  return {
    ...cf.values,
    cf,
    setName: cf.setters.name,
    setClassification: cf.setters.classification,
    setRank: cf.setters.rank,
    setVillage: cf.setters.village,
    setElement: cf.setters.element,
    setEffect: cf.setters.effect,
    setStat: cf.setters.stat,
    setHidden: cf.setters.hidden,
  };
};

/** State type */
export type BloodFilteringState = ReturnType<typeof useFiltering>;
