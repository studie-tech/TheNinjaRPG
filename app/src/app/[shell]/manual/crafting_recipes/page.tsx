"use client";

import { Hammer } from "lucide-react";
import { api } from "@/app/_trpc/client";
import { Badge } from "@/components/ui/badge";
import { ItemRarities, ItemTypes } from "@/drizzle/constants";
import type { Item } from "@/drizzle/schema";
import ContentBox from "@/layout/ContentBox";
import {
  ContentFiltering,
  defineFilteringSchema,
  toOptions,
  useContentFiltering,
} from "@/layout/ContentFiltering";
import ItemWithEffects from "@/layout/ItemWithEffects";
import Loader from "@/layout/Loader";

export default function CraftingRecipes() {
  // State
  const filters = useContentFiltering(recipeFilteringSchema);
  const { name, itemType, itemRarity } = filters.debounced;
  const nameQuery = name.toLowerCase();

  // Data - fetch all craftable items
  const { data: craftableItems, isFetching } =
    api.occupation.getCraftableItems.useQuery();

  // Only items with crafting requirements, narrowed by the recipe filters
  const filteredItems = craftableItems?.filter(
    (item) =>
      item.craftingRequirements.length > 0 &&
      (itemType === "ANY" || item.itemType === itemType) &&
      (itemRarity === "ANY" || item.rarity === itemRarity) &&
      item.name.toLowerCase().includes(nameQuery),
  );

  return (
    <>
      <ContentBox
        title="Crafting Recipes"
        subtitle="All recipes for crafting items"
        defaultBackHref="/manual"
        topRightContent={
          <div className="flex items-center gap-2">
            <ContentFiltering
              schema={recipeFilteringSchema}
              state={filters}
              triggerButtonId="filter-item"
            />
          </div>
        }
      >
        <p>
          These are all the recipes available through the Crafting occupation. Each
          recipe shows the materials required to craft the item. To craft items, you
          must have the Crafting occupation selected and the required materials in your
          inventory.
        </p>
      </ContentBox>
      <ContentBox
        title="Recipe Database"
        initialBreak={true}
        subtitle={`${filteredItems?.length || 0} crafting recipes`}
      >
        {isFetching && <Loader explanation="Loading crafting recipes" />}
        {!isFetching && filteredItems && filteredItems.length === 0 && (
          <p className="py-8 text-center text-muted-foreground">
            No crafting recipes found matching your filters.
          </p>
        )}
        {!isFetching &&
          filteredItems?.map((item) => (
            <div key={item.id} className="mb-4">
              <ItemWithEffects item={item as Item} />
              <div className="mt-2 ml-4 rounded-lg border border-slate-200 bg-slate-100 p-3 dark:border-slate-700 dark:bg-slate-800">
                <div className="mb-2 flex items-center gap-2">
                  <Hammer className="h-4 w-4" />
                  <span className="font-semibold text-sm">Required Materials:</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {item.craftingRequirements.map((req) => (
                    <Badge key={req.id} variant="outline" className="text-sm">
                      {req.quantity}x {req.requirementItem?.name || "Unknown Item"}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
          ))}
      </ContentBox>
    </>
  );
}

const recipeFilteringSchema = defineFilteringSchema({
  fields: [
    { id: "name", label: "Name", type: "text", defaultValue: "" },
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
  ] as const,
});
