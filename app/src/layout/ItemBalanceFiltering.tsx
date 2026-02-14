import { api } from "@/app/_trpc/client";
import { BattleTypes, ItemTypes } from "@/drizzle/constants";
import {
  buildFilter,
  ContentFiltering,
  defineFilteringSchema,
  toOptions,
  useContentFiltering,
} from "@/layout/ContentFiltering";

interface ItemBalanceFilteringProps {
  state: ItemBalanceFilteringState;
}

const makeSchema = (bloodlines: { id: string; name: string }[]) =>
  defineFilteringSchema({
    fields: [
      {
        id: "battleTypes",
        label: "Battle Types",
        type: "multi-select",
        defaultValue: ["RANKED_PVP", "COMBAT", "RANKED_SPARRING", "SPARRING"],
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
        id: "itemTypes",
        label: "Item Types",
        type: "multi-select",
        defaultValue: [],
        options: toOptions(ItemTypes),
      },
      {
        id: "bloodlineIds",
        label: "Bloodlines",
        type: "multi-select",
        defaultValue: [],
        options: bloodlines.map((b) => ({ value: b.id, label: b.name })),
      },
    ] as const,
  });

const ItemBalanceFiltering: React.FC<ItemBalanceFilteringProps> = (props) => {
  const { data: bloodlines } = api.bloodline.getAllNames.useQuery(undefined);
  const bl = bloodlines ?? [];
  const schema = makeSchema(bl);
  return (
    <ContentFiltering
      schema={schema}
      state={props.state.cf}
      triggerButtonId="filter-item-balance"
    />
  );
};

export default ItemBalanceFiltering;

export const getFilter = (state: ItemBalanceFilteringState) =>
  buildFilter(state.cf, makeSchema([]));

export const useFiltering = () => {
  const { data: bloodlines } = api.bloodline.getAllNames.useQuery(undefined);
  const bl = bloodlines ?? [];
  const cf = useContentFiltering(makeSchema(bl));
  return {
    ...cf.values,
    cf,
    setBattleTypes: cf.setters.battleTypes,
    setMinCount: cf.setters.minCount,
    setItemTypes: cf.setters.itemTypes,
    setBloodlineIds: cf.setters.bloodlineIds,
  };
};

export type ItemBalanceFilteringState = ReturnType<typeof useFiltering>;
