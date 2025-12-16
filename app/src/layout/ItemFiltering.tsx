import { useUserData } from "@/utils/UserContext";
import { canChangeContent } from "@/utils/permissions";
import {
  ContentFiltering,
  useContentFiltering,
  buildFilter,
  defineFilteringSchema,
  toOptions,
} from "@/layout/ContentFiltering";
import {
  ItemTypes,
  ItemRarities,
  ItemSlotTypes,
  AttackTargets,
  AttackMethods,
  BattleUsageTypes,
} from "@/drizzle/constants";
import { effectFilters } from "@/libs/combat/types";
import { formatBattleUsageType } from "@/utils/string";

// Inline schema (single source of truth)
const itemFilteringSchema = defineFilteringSchema({
  fields: [
    { id: "name", label: "Name", type: "text", defaultValue: "" },
    {
      id: "effect",
      label: "Effects",
      type: "multi-select",
      defaultValue: [],
      options: toOptions(effectFilters),
    },
    {
      id: "itemType",
      label: "Item Type",
      type: "single-select",
      defaultValue: "ANY",
      includeNone: true,
      emptyValues: ["ANY"],
      options: toOptions(ItemTypes),
      noneOption: { value: "ANY", label: "ANY" },
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
      id: "target",
      label: "Target",
      type: "single-select",
      defaultValue: "ANY",
      includeNone: true,
      emptyValues: ["ANY"],
      options: toOptions(AttackTargets),
      noneOption: { value: "ANY", label: "ANY" },
    },
    {
      id: "method",
      label: "Method",
      type: "single-select",
      defaultValue: "ANY",
      includeNone: true,
      emptyValues: ["ANY"],
      options: toOptions(AttackMethods),
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
    {
      id: "eventItems",
      label: "Event Status",
      type: "tri-state",
      defaultValue: undefined,
      triStateLabels: {
        labelActive: "Event Only",
        labelInactive: "Non-Event Only",
        labelAll: "All Items",
      },
    },
    {
      id: "onlyInShop",
      label: "Shop Status",
      type: "tri-state",
      defaultValue: true,
      triStateLabels: {
        labelActive: "In Shop",
        labelInactive: "Not In Shop",
        labelAll: "All Shop Status",
      },
    },
    {
      id: "canBeCrafted",
      label: "Crafting",
      type: "tri-state",
      defaultValue: undefined,
      triStateLabels: {
        labelActive: "Craftable",
        labelInactive: "Not Craftable",
        labelAll: "All Crafting",
      },
    },
    {
      id: "canBeImbued",
      label: "Imbuing",
      type: "tri-state",
      defaultValue: undefined,
      triStateLabels: {
        labelActive: "Imbuable",
        labelInactive: "Not Imbuable",
        labelAll: "All Imbuing",
      },
    },
    {
      id: "canBeHunted",
      label: "Hunting",
      type: "tri-state",
      defaultValue: undefined,
      triStateLabels: {
        labelActive: "Huntable",
        labelInactive: "Not Huntable",
        labelAll: "All Hunting",
      },
    },
    {
      id: "canBeGathered",
      label: "Gathering",
      type: "tri-state",
      defaultValue: undefined,
      triStateLabels: {
        labelActive: "Gatherable",
        labelInactive: "Not Gatherable",
        labelAll: "All Gathering",
      },
    },
    {
      id: "canBeTraded",
      label: "Trading",
      type: "tri-state",
      defaultValue: undefined,
      triStateLabels: {
        labelActive: "Tradeable",
        labelInactive: "Not Tradeable",
        labelAll: "All Trading",
      },
    },
    {
      id: "hidden",
      label: "Visibility",
      type: "tri-state",
      defaultValue: undefined,
      visibleIf: (ctx) => Boolean((ctx as { canEdit?: boolean } | undefined)?.canEdit),
      triStateLabels: {
        labelActive: "Hidden",
        labelInactive: "Visible",
        labelAll: "All Visibility",
      },
    },
  ] as const,
});

interface ItemFilteringProps {
  state: ItemFilteringState;
}

const ItemFiltering: React.FC<ItemFilteringProps> = (props) => {
  const { data: userData } = useUserData();
  const context = { canEdit: Boolean(userData && canChangeContent(userData.role)) };

  return (
    <ContentFiltering
      schema={itemFilteringSchema}
      state={props.state.cf}
      context={context}
      triggerButtonId="filter-item"
    />
  );
};

export default ItemFiltering;

export const getFilter = (state: ItemFilteringState) =>
  buildFilter(state.cf, itemFilteringSchema);

export const useFiltering = () => {
  const cf = useContentFiltering(itemFilteringSchema);
  return {
    ...cf.values,
    cf,
    // expose setters with the same external API
    setName: cf.setters.name,
    setEffect: cf.setters.effect,
    setItemType: cf.setters.itemType,
    setRarity: cf.setters.itemRarity,
    setSlot: cf.setters.slot,
    setTarget: cf.setters.target,
    setMethod: cf.setters.method,
    setEventItems: cf.setters.eventItems,
    setOnlyInShop: cf.setters.onlyInShop,
    setHidden: cf.setters.hidden,
    setCanBeCrafted: cf.setters.canBeCrafted,
    setCanBeImbued: cf.setters.canBeImbued,
    setCanBeHunted: cf.setters.canBeHunted,
    setCanBeGathered: cf.setters.canBeGathered,
    setCanBeTraded: cf.setters.canBeTraded,
  };
};

export type ItemFilteringState = ReturnType<typeof useFiltering>;
