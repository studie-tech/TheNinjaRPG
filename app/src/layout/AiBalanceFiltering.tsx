import { BattleTypes, MAX_PLAYER_LEVEL, UserRanks } from "@/drizzle/constants";
import {
  buildFilter,
  ContentFiltering,
  defineFilteringSchema,
  toOptions,
  useContentFiltering,
} from "@/layout/ContentFiltering";

interface AiBalanceFilteringProps {
  state: AiBalanceFilteringState;
}

const makeSchema = () =>
  defineFilteringSchema({
    fields: [
      {
        id: "battleTypes",
        label: "Battle Types",
        type: "multi-select",
        defaultValue: [],
        options: toOptions(BattleTypes),
      },
      {
        id: "minCount",
        label: "Minimum Count",
        type: "number",
        defaultValue: undefined,
        normalizeForFilter: (v) => (v !== undefined && v >= 1 ? v : undefined),
      },
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
      schema={makeSchema()}
      state={props.state.cf}
      triggerButtonId="filter-ai-balance"
    />
  );
};

export default AiBalanceFiltering;

export const getFilter = (state: AiBalanceFilteringState) =>
  buildFilter(state.cf, makeSchema());

export const useFiltering = () => {
  const cf = useContentFiltering(makeSchema());
  return {
    ...cf.values,
    cf,
  };
};

export type AiBalanceFilteringState = ReturnType<typeof useFiltering>;
