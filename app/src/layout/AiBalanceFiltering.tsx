import { BattleTypes, UserRanks } from "@/drizzle/constants";
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
      { id: "minLevel", label: "Min Level", type: "number", defaultValue: undefined },
      { id: "maxLevel", label: "Max Level", type: "number", defaultValue: undefined },
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
    setBattleTypes: cf.setters.battleTypes,
    setMinCount: cf.setters.minCount,
    setUserRanks: cf.setters.userRanks,
    setVillages: cf.setters.villages,
    setMinLevel: cf.setters.minLevel,
    setMaxLevel: cf.setters.maxLevel,
  };
};

export type AiBalanceFilteringState = ReturnType<typeof useFiltering>;
