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

const makeSchema = () =>
  defineFilteringSchema({
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
      schema={makeSchema()}
      state={props.state.cf}
      triggerButtonId="filter-quest-reward-balance"
    />
  );
};

export default QuestRewardBalanceFiltering;

export const getFilter = (state: QuestRewardBalanceFilteringState) =>
  buildFilter(state.cf, makeSchema());

export const useFiltering = () => {
  const cf = useContentFiltering(makeSchema());
  return {
    ...cf.values,
    cf,
    setReward: cf.setters.reward,
    setQuestTypes: cf.setters.questTypes,
  };
};

export type QuestRewardBalanceFilteringState = ReturnType<typeof useFiltering>;
