import { MAX_PLAYER_LEVEL, UserRanks } from "@/drizzle/constants";
import {
  battleTypesField,
  buildFilter,
  ContentFiltering,
  defineFilteringSchema,
  minCountField,
  toOptions,
  useContentFiltering,
} from "@/layout/ContentFiltering";

interface AiBalanceFilteringProps {
  state: AiBalanceFilteringState;
}

const AI_BALANCE_FILTERING_SCHEMA = defineFilteringSchema({
  fields: [
    battleTypesField([]),
    minCountField,
    {
      id: "userRanks",
      label: "User Ranks",
      type: "multi-select",
      defaultValue: [],
      options: toOptions(UserRanks),
    },
    {
      id: "villages",
      label: "Villages",
      type: "multi-select",
      defaultValue: [],
      dataSource: "villages",
    },
    {
      id: "minLevel",
      label: "Min Level",
      type: "number",
      defaultValue: undefined,
      min: 1,
      max: MAX_PLAYER_LEVEL,
    },
    {
      id: "maxLevel",
      label: "Max Level",
      type: "number",
      defaultValue: undefined,
      min: 1,
      max: MAX_PLAYER_LEVEL,
    },
  ] as const,
});

const AiBalanceFiltering: React.FC<AiBalanceFilteringProps> = (props) => {
  return (
    <ContentFiltering
      schema={AI_BALANCE_FILTERING_SCHEMA}
      state={props.state.cf}
      triggerButtonId="filter-ai-balance"
    />
  );
};

export default AiBalanceFiltering;

export const getFilter = (state: AiBalanceFilteringState) =>
  buildFilter(state.cf, AI_BALANCE_FILTERING_SCHEMA);

export const useFiltering = () => {
  const cf = useContentFiltering(AI_BALANCE_FILTERING_SCHEMA);
  return {
    ...cf.values,
    cf,
  };
};

export type AiBalanceFilteringState = ReturnType<typeof useFiltering>;
