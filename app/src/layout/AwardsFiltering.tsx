import {
  ContentFiltering,
  useContentFiltering,
  defineFilteringSchema,
  buildFilter,
} from "@/layout/ContentFiltering";

interface AwardsFilteringProps {
  state: AwardsFilteringState;
}

const AWARDS_FILTERING_SCHEMA = defineFilteringSchema({
  fields: [
    {
      id: "rewardType",
      label: "Reward Type",
      type: "single-select",
      defaultValue: "all",
      includeNone: false,
      emptyValues: [],
      options: [
        { value: "all", label: "All Types" },
        { value: "reputation", label: "Reputation" },
        { value: "money", label: "Money" },
        { value: "both", label: "Both" },
      ],
    },
    {
      id: "awardedTo",
      label: "Awarded To",
      type: "text",
      defaultValue: "",
    },
    {
      id: "awardedBy",
      label: "Awarded By",
      type: "text",
      defaultValue: "",
    },
    {
      id: "date",
      label: "Date",
      type: "date",
      defaultValue: "",
    },
  ] as const,
});

const AwardsFiltering: React.FC<AwardsFilteringProps> = (props) => {
  return (
    <ContentFiltering
      schema={AWARDS_FILTERING_SCHEMA}
      state={props.state.cf}
      triggerButtonId="filter-awards"
    />
  );
};

export default AwardsFiltering;

export const getFilter = (state: AwardsFilteringState) =>
  buildFilter(state.cf, AWARDS_FILTERING_SCHEMA);

export const useFiltering = () => {
  const cf = useContentFiltering(AWARDS_FILTERING_SCHEMA);
  return {
    ...cf.values,
    cf,
    setRewardType: cf.setters.rewardType,
    setAwardedTo: cf.setters.awardedTo,
    setAwardedBy: cf.setters.awardedBy,
    setDate: cf.setters.date,
  };
};

export type AwardsFilteringState = ReturnType<typeof useFiltering>;
