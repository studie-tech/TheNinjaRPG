import { BattleUsageTypes, ItemRarities, ItemSlotTypes } from "@/drizzle/constants";
import {
  buildFilter,
  ContentFiltering,
  defineFilteringSchema,
  toOptions,
  useContentFiltering,
} from "@/layout/ContentFiltering";
import { formatBattleUsageType } from "@/utils/string";
import { tagTypes } from "@/validators/combat";

interface ItemShopFilteringProps {
  state: ItemShopFilteringState;
  /** Popover trigger button id (unique when several shops on one page). */
  filterTriggerId?: string;
}

/** Shop filters beside the type chips: name, effects, rarity, slot, battle type and action cost. */
const itemShopSchema = defineFilteringSchema({
  fields: [
    { id: "name", label: "Name", type: "text", defaultValue: "" },
    {
      id: "effect",
      label: "Effects",
      type: "multi-select",
      defaultValue: [],
      options: tagTypes.map((ef) => ({ value: ef, label: ef })),
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
  return (
    <ContentFiltering
      schema={itemShopSchema}
      state={props.state.cf}
      triggerButtonId={props.filterTriggerId ?? "filter-item"}
    />
  );
};

export { ItemShopFiltering };

export const getShopFilter = (state: ItemShopFilteringState) =>
  buildFilter(state.cf, itemShopSchema);

export const useShopFiltering = () => {
  const cf = useContentFiltering(itemShopSchema);
  return { ...cf.values, cf, setName: cf.setters.name };
};

export type ItemShopFilteringState = ReturnType<typeof useShopFiltering>;
