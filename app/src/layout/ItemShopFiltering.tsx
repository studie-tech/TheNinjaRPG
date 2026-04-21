import { useMemo } from "react";
import {
  BattleUsageTypes,
  ItemRarities,
  ItemSlotTypes,
  ItemTypes,
} from "@/drizzle/constants";
import type { ItemType } from "@/drizzle/schema";
import {
  buildFilter,
  ContentFiltering,
  defineFilteringSchema,
  toOptions,
  useContentFiltering,
} from "@/layout/ContentFiltering";
import { formatBattleUsageType } from "@/utils/string";
import { effectFilters } from "@/validators/combat";

interface ItemShopFilteringProps {
  state: ItemShopFilteringState;
  defaultType: ItemType;
  restrictTypes?: ItemType[];
  /** When true, item type is controlled elsewhere (e.g. shop tabs); omit Type from the filter popover. */
  hideItemTypeField?: boolean;
  /** Popover trigger button id (unique when several shops on one page). */
  filterTriggerId?: string;
}

const makeItemShopSchema = (types: readonly string[], itemTypeDefault?: ItemType) => {
  const first = (types[0] ?? "WEAPON") as ItemType;
  const initialItemType =
    itemTypeDefault && types.includes(itemTypeDefault) ? itemTypeDefault : first;
  return defineFilteringSchema({
    fields: [
      {
        id: "itemType",
        label: "Type",
        type: "single-select",
        defaultValue: initialItemType,
        includeNone: false,
        emptyValues: [],
        options: types.map((t) => ({ value: t, label: t })),
        visibleIf: (ctx) =>
          !(ctx as { hideItemType?: boolean } | undefined)?.hideItemType,
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
};

const ItemShopFiltering: React.FC<ItemShopFilteringProps> = (props) => {
  const restrictKey = props.restrictTypes?.join() ?? "";
  const schema = useMemo(() => {
    let categories = Object.values(ItemTypes) as string[];
    if (props.restrictTypes?.length) {
      categories = categories.filter((t) =>
        props.restrictTypes?.includes(t as ItemType),
      );
    }
    return makeItemShopSchema(categories, props.defaultType);
  }, [restrictKey, props.defaultType]);
  return (
    <ContentFiltering
      schema={schema}
      state={props.state.cf}
      triggerButtonId={props.filterTriggerId ?? "filter-item"}
      context={{ hideItemType: props.hideItemTypeField }}
    />
  );
};

export { ItemShopFiltering };

export const getShopFilter = (state: ItemShopFilteringState) =>
  buildFilter(state.cf, makeItemShopSchema(Object.values(ItemTypes)));

export const useShopFiltering = (defaultType: ItemType) => {
  const schema = useMemo(
    () => makeItemShopSchema(Object.values(ItemTypes), defaultType),
    [defaultType],
  );
  const cf = useContentFiltering(schema);
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
