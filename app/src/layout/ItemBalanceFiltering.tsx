import { ItemTypes } from "@/drizzle/constants";
import {
  battleTypesField,
  buildFilter,
  ContentFiltering,
  defineFilteringSchema,
  minCountField,
  toOptions,
  useContentFiltering,
} from "@/layout/ContentFiltering";

interface ItemBalanceFilteringProps {
  state: ItemBalanceFilteringState;
}

/** Define the item balance filters and their initial battle sample. */
const ITEM_BALANCE_FILTERING_SCHEMA = defineFilteringSchema({
  fields: [
    battleTypesField(["RANKED_PVP", "COMBAT", "RANKED_SPARRING", "SPARRING"]),
    minCountField,
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
      dataSource: "bloodlines",
    },
  ] as const,
});

const ItemBalanceFiltering: React.FC<ItemBalanceFilteringProps> = (props) => {
  return (
    <ContentFiltering
      schema={ITEM_BALANCE_FILTERING_SCHEMA}
      state={props.state.cf}
      triggerButtonId="filter-item-balance"
    />
  );
};

export default ItemBalanceFiltering;

export const getFilter = (state: ItemBalanceFilteringState) =>
  buildFilter(state.cf, ITEM_BALANCE_FILTERING_SCHEMA);

export const useFiltering = () => {
  const cf = useContentFiltering(ITEM_BALANCE_FILTERING_SCHEMA);
  return {
    ...cf.values,
    cf,
  };
};

export type ItemBalanceFilteringState = ReturnType<typeof useFiltering>;
