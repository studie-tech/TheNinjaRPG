import { QuestRewardMetrics, QuestTypes } from "@/drizzle/constants";
import {
  buildFilter,
  ContentFiltering,
  defineFilteringSchema,
  toOptions,
  useContentFiltering,
} from "@/layout/ContentFiltering";

interface QuestRewardBalanceFilteringProps {
  state: QuestRewardBalanceFilteringState;
}

const QUEST_REWARD_BALANCE_FILTERING_SCHEMA = defineFilteringSchema({
  fields: [
    {
      id: "reward",
      label: "Reward",
      type: "single-select",
      defaultValue: "reward_money",
      options: toOptions(QuestRewardMetrics),
      doubleWidth: true,
    },
    {
      id: "questTypes",
      label: "Quest Types",
      type: "multi-select",
      defaultValue: [...QuestTypes],
      options: toOptions(QuestTypes),
      doubleWidth: true,
    },
  ] as const,
});

const QuestRewardBalanceFiltering: React.FC<QuestRewardBalanceFilteringProps> = (
  props,
) => {
  return (
    <ContentFiltering
      schema={QUEST_REWARD_BALANCE_FILTERING_SCHEMA}
      state={props.state.cf}
      triggerButtonId="filter-quest-reward-balance"
    />
  );
};

export default QuestRewardBalanceFiltering;

export const getFilter = (state: QuestRewardBalanceFilteringState) =>
  buildFilter(state.cf, QUEST_REWARD_BALANCE_FILTERING_SCHEMA);

export const useFiltering = () => {
  const cf = useContentFiltering(QUEST_REWARD_BALANCE_FILTERING_SCHEMA);
  return {
    ...cf.values,
    cf,
  };
};

export type QuestRewardBalanceFilteringState = ReturnType<typeof useFiltering>;
