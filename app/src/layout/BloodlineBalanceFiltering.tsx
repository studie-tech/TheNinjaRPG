import { LetterRanks, StatTypes } from "@/drizzle/constants";
import {
  battleTypesField,
  buildFilter,
  ContentFiltering,
  defineFilteringSchema,
  minCountField,
  toOptions,
  useContentFiltering,
} from "@/layout/ContentFiltering";

interface BloodlineBalanceFilteringProps {
  state: BloodlineBalanceFilteringState;
}

const makeSchema = () =>
  defineFilteringSchema({
    fields: [
      battleTypesField(["COMBAT", "SPARRING"]),
      minCountField,
      {
        id: "bloodlineRanks",
        label: "Bloodline Ranks",
        type: "multi-select",
        defaultValue: [],
        options: toOptions(LetterRanks),
      },
      {
        id: "statClassifications",
        label: "Stat Classifications",
        type: "multi-select",
        defaultValue: [],
        options: toOptions(StatTypes),
      },
    ] as const,
  });

const BloodlineBalanceFiltering: React.FC<BloodlineBalanceFilteringProps> = (props) => {
  return (
    <ContentFiltering
      schema={makeSchema()}
      state={props.state.cf}
      triggerButtonId="filter-bloodline-balance"
    />
  );
};

export default BloodlineBalanceFiltering;

export const getFilter = (state: BloodlineBalanceFilteringState) =>
  buildFilter(state.cf, makeSchema());

export const useFiltering = () => {
  const cf = useContentFiltering(makeSchema());
  return {
    ...cf.values,
    cf,
  };
};

export type BloodlineBalanceFilteringState = ReturnType<typeof useFiltering>;
