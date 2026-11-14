import type { LetterRank } from "@/drizzle/constants";
import { ElementNames, LetterRanks, StatTypes } from "@/drizzle/constants";
import {
  buildFilter,
  ContentFiltering,
  type ContentFilteringOptions,
  defineFilteringSchema,
  hiddenVisibilityField,
  useContentEditContext,
  useContentFiltering,
} from "@/layout/ContentFiltering";
import { tagTypes } from "@/validators/combat";
import { statFilters } from "@/validators/statFilters";

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
        filterOptions: (opts) => opts.sort((a, b) => a.label.localeCompare(b.label)),
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
        options: tagTypes.map((e) => ({ value: e, label: e })),
      },
      {
        id: "stat",
        label: "Stat",
        type: "multi-select",
        defaultValue: [],
        options: statFilters.map((s) => ({ value: s, label: s })),
      },
      hiddenVisibilityField(),
    ] as const,
  });

interface BloodFilteringProps {
  state: BloodFilteringState;
  limitRanks?: LetterRank[];
  disabled?: boolean;
}

const BloodFiltering: React.FC<BloodFilteringProps> = (props) => {
  const limitRanks = props.limitRanks ? props.limitRanks : [...LetterRanks];
  const schema = makeBloodlineFilteringSchema(limitRanks);
  const context = useContentEditContext();

  return (
    <ContentFiltering
      schema={schema}
      state={props.state.cf}
      context={context}
      triggerButtonId="filter-bloodline"
      disabled={props.disabled}
    />
  );
};

export default BloodFiltering;

export const getFilter = (state: BloodFilteringState) =>
  buildFilter(state.cf, makeBloodlineFilteringSchema([...LetterRanks]));

/** State for the Bloodline Filtering component */
export const useFiltering = (
  defaultRank: LetterRank | "None" = "None",
  options?: ContentFilteringOptions,
) => {
  const schema = makeBloodlineFilteringSchema([...LetterRanks], defaultRank);
  const cf = useContentFiltering(schema, options);
  return {
    ...cf.values,
    cf,
    setEffect: cf.setters.effect,
    setRank: cf.setters.rank,
  };
};

/** State type */
export type BloodFilteringState = ReturnType<typeof useFiltering>;
