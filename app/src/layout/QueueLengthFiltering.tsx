import { RANKED_RANKS } from "@/drizzle/constants";
import {
  buildFilter,
  ContentFiltering,
  defineFilteringSchema,
  minCountField,
  toOptions,
  useContentFiltering,
} from "@/layout/ContentFiltering";

interface QueueLengthFilteringProps {
  state: QueueLengthFilteringState;
}

const makeSchema = () =>
  defineFilteringSchema({
    fields: [
      {
        id: "rankedRanks",
        label: "Ranked Ranks",
        type: "multi-select",
        defaultValue: [],
        options: toOptions(RANKED_RANKS),
      },
      minCountField,
    ] as const,
  });

const QueueLengthFiltering: React.FC<QueueLengthFilteringProps> = (props) => {
  return (
    <ContentFiltering
      schema={makeSchema()}
      state={props.state.cf}
      triggerButtonId="filter-queue-length"
    />
  );
};

export default QueueLengthFiltering;

export const getFilter = (state: QueueLengthFilteringState) =>
  buildFilter(state.cf, makeSchema());

export const useFiltering = () => {
  const cf = useContentFiltering(makeSchema());
  return {
    ...cf.values,
    cf,
  };
};

export type QueueLengthFilteringState = ReturnType<typeof useFiltering>;
