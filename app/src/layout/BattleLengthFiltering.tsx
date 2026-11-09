import { MAX_PLAYER_LEVEL } from "@/drizzle/constants";
import {
  battleTypesField,
  buildFilter,
  ContentFiltering,
  defineFilteringSchema,
  minCountField,
  useContentFiltering,
} from "@/layout/ContentFiltering";

interface BattleLengthFilteringProps {
  state: BattleLengthFilteringState;
}

const BATTLE_LENGTH_FILTERING_SCHEMA = defineFilteringSchema({
  fields: [
    battleTypesField(["COMBAT", "RANKED_PVP"]),
    minCountField,
    {
      id: "minWinnerLevel",
      label: "Min Winner Level",
      type: "number",
      defaultValue: undefined,
      min: 1,
      max: MAX_PLAYER_LEVEL,
    },
    {
      id: "maxWinnerLevel",
      label: "Max Winner Level",
      type: "number",
      defaultValue: undefined,
      min: 1,
      max: MAX_PLAYER_LEVEL,
    },
    {
      id: "minLoserLevel",
      label: "Min Loser Level",
      type: "number",
      defaultValue: undefined,
      min: 1,
      max: MAX_PLAYER_LEVEL,
    },
    {
      id: "maxLoserLevel",
      label: "Max Loser Level",
      type: "number",
      defaultValue: undefined,
      min: 1,
      max: MAX_PLAYER_LEVEL,
    },
  ] as const,
});

const BattleLengthFiltering: React.FC<BattleLengthFilteringProps> = (props) => {
  return (
    <ContentFiltering
      schema={BATTLE_LENGTH_FILTERING_SCHEMA}
      state={props.state.cf}
      triggerButtonId="filter-battle-length"
    />
  );
};

export default BattleLengthFiltering;

export const getFilter = (state: BattleLengthFilteringState) =>
  buildFilter(state.cf, BATTLE_LENGTH_FILTERING_SCHEMA);

export const useFiltering = () => {
  const cf = useContentFiltering(BATTLE_LENGTH_FILTERING_SCHEMA);
  return {
    ...cf.values,
    cf,
  };
};

export type BattleLengthFilteringState = ReturnType<typeof useFiltering>;
