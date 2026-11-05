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

const makeSchema = () =>
  defineFilteringSchema({
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
      schema={makeSchema()}
      state={props.state.cf}
      triggerButtonId="filter-item-balance"
    />
  );
};

export default ItemBalanceFiltering;

export const getFilter = (state: ItemBalanceFilteringState) =>
  buildFilter(state.cf, makeSchema());

export const useFiltering = () => {
  const cf = useContentFiltering(makeSchema());
  return {
    ...cf.values,
    cf,
  };
};

export type ItemBalanceFilteringState = ReturnType<typeof useFiltering>;
