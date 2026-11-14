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
  type ContentFilteringOptions,
  defineFilteringSchema,
  hiddenVisibilityField,
  toOptions,
  useContentEditContext,
  useContentFiltering,
} from "@/layout/ContentFiltering";
import { formatBattleUsageType } from "@/utils/string";
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
    hiddenVisibilityField(),
  ] as const,
});

/** The same fields with the shop filter cleared, so every known item is listed. */
const allShopStatusItemFilteringSchema = {
  ...itemFilteringSchema,
  fields: itemFilteringSchema.fields.map((field) =>
    field.id === "onlyInShop" ? { ...field, defaultValue: undefined } : field,
  ) as unknown as typeof itemFilteringSchema.fields,
};

interface ItemFilteringProps {
  state: ItemFilteringState;
  disabled?: boolean;
}

const ItemFiltering: React.FC<ItemFilteringProps> = (props) => {
  const context = useContentEditContext();

  return (
    <ContentFiltering
      schema={props.state.schema}
      state={props.state.cf}
      context={context}
      triggerButtonId="filter-item"
      disabled={props.disabled}
    />
  );
};

export default ItemFiltering;

export const getFilter = (state: ItemFilteringState) =>
  buildFilter(state.cf, state.schema);

/**
 * Item filter state. Shop tools open on items sold in shops; `allShopStatus` opens on
 * every item instead, for the encyclopedia.
 */
export const useFiltering = (
  options?: ContentFilteringOptions & { allShopStatus?: boolean },
) => {
  const { allShopStatus, ...filteringOptions } = options ?? {};
  const schema = allShopStatus ? allShopStatusItemFilteringSchema : itemFilteringSchema;
  const cf = useContentFiltering(schema, filteringOptions);
  return {
    ...cf.values,
    cf,
    schema,
    setEffect: cf.setters.effect,
    setOnlyInShop: cf.setters.onlyInShop,
  };
};

export type ItemFilteringState = ReturnType<typeof useFiltering>;
