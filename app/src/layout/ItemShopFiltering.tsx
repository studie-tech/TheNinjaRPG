import {
  ContentFiltering,
  useContentFiltering,
  buildFilter,
  defineFilteringSchema,
  toOptions,
} from "@/layout/ContentFiltering";
import { effectFilters } from "@/libs/combat/types";
import { ItemRarities, ItemSlotTypes, ItemTypes, BattleUsageTypes } from "@/drizzle/constants";
import { formatBattleUsageType } from "@/utils/string";
import type { ItemType } from "@/drizzle/schema";

interface ItemShopFilteringProps {
  state: ItemShopFilteringState;
  defaultType: ItemType;
  restrictTypes?: ItemType[];
}

const makeItemShopSchema = (types: readonly string[]) =>
  defineFilteringSchema({
    fields: [
      {
        id: "itemType",
        label: "Type",
        type: "single-select",
        defaultValue: types[0] ?? "WEAPON",
        includeNone: false,
        emptyValues: [],
        options: types.map((t) => ({ value: t, label: t })),
      },
      { id: "name", label: "Name", type: "text", defaultValue: "" },
      {
        id: "effect",
        label: "Effects",
        type: "multi-select",
        defaultValue: [],
        options: effectFilters.map((ef) => ({ value: ef, label: ef })),
      },
      {
        id: "itemRarity",
        label: "Rarity",
        type: "single-select",
        defaultValue: "ANY",
        includeNone: true,
        emptyValues: ["ANY"],
        options: toOptions(ItemRarities),
        noneOption: { value: "ANY", label: "ANY" },
      },
      {
        id: "slot",
        label: "Slot",
        type: "single-select",
        defaultValue: "ANY",
        includeNone: true,
        emptyValues: ["ANY"],
        options: toOptions(ItemSlotTypes),
        noneOption: { value: "ANY", label: "ANY" },
      },
      {
        id: "battleUsageType",
        label: "Battle Type",
        type: "single-select",
        defaultValue: "ANY",
        includeNone: true,
        emptyValues: ["ANY"],
        options: BattleUsageTypes.map((t) => ({
          value: t,
          label: formatBattleUsageType(t),
        })),
        noneOption: { value: "ANY", label: "ANY" },
      },
      {
        id: "actionCostPerc",
        label: "Action Cost (%)",
        type: "number",
        defaultValue: undefined,
      },
    ] as const,
  });

const ItemShopFiltering: React.FC<ItemShopFilteringProps> = (props) => {
  let categories = Object.values(ItemTypes) as string[];
  if (props.restrictTypes)
    categories = categories.filter((t) => props.restrictTypes?.includes(t as ItemType));
  const schema = makeItemShopSchema(categories);
  return (
    <ContentFiltering
      schema={schema}
      state={props.state.cf}
      triggerButtonId="filter-item"
    />
  );
};

export { ItemShopFiltering };

export const getShopFilter = (state: ItemShopFilteringState) =>
  buildFilter(state.cf, makeItemShopSchema(Object.values(ItemTypes)));

export const useShopFiltering = (defaultType: ItemType) => {
  const cf = useContentFiltering(makeItemShopSchema(Object.values(ItemTypes)));
  if (!cf.values.itemType) {
    (cf.setters.itemType as React.Dispatch<React.SetStateAction<ItemType>>)(
      defaultType,
    );
  }
  return {
    ...cf.values,
    cf,
    setEffect: cf.setters.effect,
    setName: cf.setters.name,
    setRarity: cf.setters.itemRarity,
    setSlot: cf.setters.slot,
    setItemType: cf.setters.itemType as React.Dispatch<React.SetStateAction<ItemType>>,
    setBattleUsageType: cf.setters.battleUsageType,
    setActionCostPerc: cf.setters.actionCostPerc,
  };
};

export type ItemShopFilteringState = ReturnType<typeof useShopFiltering>;
