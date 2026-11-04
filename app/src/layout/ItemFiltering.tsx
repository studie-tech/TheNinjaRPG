import {
  AttackMethods,
  AttackTargets,
  BattleUsageTypes,
  ItemRarities,
  ItemSlotTypes,
  ItemTypes,
} from "@/drizzle/constants";
import {
  buildFilter,
  ContentFiltering,
  defineFilteringSchema,
  toOptions,
  useContentFiltering,
} from "@/layout/ContentFiltering";
import { canChangeContent } from "@/utils/permissions";
import { formatBattleUsageType } from "@/utils/string";
import { useUserData } from "@/utils/UserContext";
import { tagTypes } from "@/validators/combat";

// Inline schema (single source of truth)
const itemFilteringSchema = defineFilteringSchema({
  fields: [
    { id: "name", label: "Name", type: "text", defaultValue: "" },
    {
      id: "effect",
      label: "Effects",
      type: "multi-select",
      defaultValue: [],
      options: toOptions(tagTypes),
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
  disabled?: boolean;
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
      disabled={props.disabled}
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
    setEffect: cf.setters.effect,
    setOnlyInShop: cf.setters.onlyInShop,
  };
};

export type ItemFilteringState = ReturnType<typeof useFiltering>;
