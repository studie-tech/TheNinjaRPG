"use client";

import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import ItemWithEffects from "@/layout/ItemWithEffects";
import ItemFiltering, { useFiltering, getFilter } from "@/layout/ItemFiltering";
import { api } from "@/app/_trpc/client";
import { Badge } from "@/components/ui/badge";
import { Hammer } from "lucide-react";
import type { Item } from "@/drizzle/schema";

export default function CraftingRecipes() {
  // State
  const state = useFiltering();

  // Data - fetch all craftable items
  const { data: craftableItems, isFetching } =
    api.occupation.getCraftableItems.useQuery();

  // Filter items based on state
  const filteredItems = craftableItems?.filter((item) => {
    // Only show items that have crafting requirements set
    if (!item.craftingRequirements || item.craftingRequirements.length === 0) {
      return false;
    }

    const filter = getFilter(state);

    // Filter by item type
    if (
      filter.itemType &&
      filter.itemType !== "ANY" &&
      item.itemType !== filter.itemType
    ) {
      return false;
    }

    // Filter by rarity
    if (
      filter.itemRarity &&
      filter.itemRarity !== "ANY" &&
      item.rarity !== filter.itemRarity
    ) {
      return false;
    }

    // Filter by name
    if (
      filter.name &&
      typeof filter.name === "string" &&
      !item.name.toLowerCase().includes(filter.name.toLowerCase())
    ) {
      return false;
    }

    return true;
  });

  return (
    <>
      <ContentBox
        title="Crafting Recipes"
        subtitle="All recipes for crafting items"
        defaultBackHref="/manual"
        topRightContent={
          <div className="flex items-center gap-2">
            <ItemFiltering state={state} />
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
      <br />
      <ContentBox
        title="Recipe Database"
        initialBreak={true}
        subtitle={`${filteredItems?.length || 0} crafting recipes`}
      >
        {isFetching && <Loader explanation="Loading crafting recipes" />}
        {!isFetching && filteredItems && filteredItems.length === 0 && (
          <p className="text-center text-muted-foreground py-8">
            No crafting recipes found matching your filters.
          </p>
        )}
        {!isFetching &&
          filteredItems?.map((item) => (
            <div key={item.id} className="mb-4">
              <ItemWithEffects item={item as Item} />
              {item.craftingRequirements && item.craftingRequirements.length > 0 && (
                <div className="mt-2 ml-4 p-3 bg-slate-100 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
                  <div className="flex items-center gap-2 mb-2">
                    <Hammer className="h-4 w-4" />
                    <span className="font-semibold text-sm">Required Materials:</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {item.craftingRequirements.map((req, index) => (
                      <Badge key={index} variant="outline" className="text-sm">
                        {req.quantity}x {req.requirementItem?.name || "Unknown Item"}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
      </ContentBox>
    </>
  );
}
