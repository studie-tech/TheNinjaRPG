"use client";

import { ArrowLeft, FlaskConical, Package, Shield, Sword } from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CONSUMABLE_CRAFTING_TIMES_MINS,
  CRAFTING_TIMES_MINS,
  ItemRarities,
} from "@/drizzle/constants";
import type { Item, UserItemWithRelations } from "@/drizzle/schema";
import { ActionSelector } from "@/layout/CombatActions";
import ContentImage from "@/layout/ContentImage";
import ItemWithEffects from "@/layout/ItemWithEffects";
import Modal2 from "@/layout/Modal2";
import { getCraftingRank, getTotalItemQuantity } from "@/libs/crafting";
import { showMutationToast } from "@/libs/toast";
import type { UserWithRelations } from "@/server/api/routers/profile";
import { formatSecondsToTimeDisplay } from "@/utils/time";
import { getShrineBoost } from "@/utils/village";

type CraftableItem = Item & {
  craftingRequirements: {
    quantity: number;
    requirementItemId: string;
    requirementItem: Item | null;
  }[];
};

type CatalogCategory = "WEAPON" | "ARMOR" | "CONSUMABLE" | "OTHER";

const CATEGORY_CONFIG: Record<
  CatalogCategory,
  { label: string; icon: React.ReactNode; itemTypes: string[] }
> = {
  WEAPON: {
    label: "Weapons",
    icon: <Sword className="h-8 w-8" />,
    itemTypes: ["WEAPON"],
  },
  ARMOR: {
    label: "Armor",
    icon: <Shield className="h-8 w-8" />,
    itemTypes: ["ARMOR"],
  },
  CONSUMABLE: {
    label: "Consumables",
    icon: <FlaskConical className="h-8 w-8" />,
    itemTypes: ["CONSUMABLE"],
  },
  OTHER: {
    label: "Items",
    icon: <Package className="h-8 w-8" />,
    itemTypes: ["ACCESSORY", "MATERIAL", "KEYSTONE", "CRYSTAL", "OTHER"],
  },
};

interface CraftingCatalogProps {
  craftableItems: CraftableItem[] | undefined;
  userItems: UserItemWithRelations[] | undefined;
  userData: UserWithRelations | undefined;
  isCurrentlyCrafting: boolean;
}

export const CraftingCatalog: React.FC<CraftingCatalogProps> = ({
  craftableItems,
  userItems,
  userData,
  isCurrentlyCrafting,
}) => {
  // Utils
  const utils = api.useUtils();

  // State
  const [selectedCategory, setSelectedCategory] = useState<CatalogCategory | null>(
    null,
  );
  const [selectedItem, setSelectedItem] = useState<CraftableItem | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [rarityFilter, setRarityFilter] = useState<string>("ALL");
  const [craftQuantity, setCraftQuantity] = useState(1);

  // Craft mutation
  const craftItemMutation = api.occupation.craftItem.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        setSelectedItem(null);
        setCraftQuantity(1);
        await utils.item.getUserItems.invalidate();
      }
    },
  });

  // Filter items by category
  const categoryItems = useMemo(() => {
    if (!selectedCategory || !craftableItems) return [];
    const config = CATEGORY_CONFIG[selectedCategory];
    return craftableItems.filter((item) => config.itemTypes.includes(item.itemType));
  }, [selectedCategory, craftableItems]);

  // Filter by search and rarity
  const filteredItems = useMemo(() => {
    let items = categoryItems;

    // Filter by rarity
    if (rarityFilter !== "ALL") {
      items = items.filter((item) => item.rarity === rarityFilter);
    }

    // Filter by search (item name + material names)
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      items = items.filter((item) => {
        // Check item name
        if (item.name.toLowerCase().includes(query)) return true;
        // Check material names
        return item.craftingRequirements.some((req) => {
          const requirementName = req.requirementItem?.name;
          return requirementName
            ? requirementName.toLowerCase().includes(query)
            : false;
        });
      });
    }

    return items;
  }, [categoryItems, rarityFilter, searchQuery]);

  // Calculate max craftable for selected item
  const maxCraftable = useMemo(() => {
    if (!selectedItem || !userItems) return 0;
    let max = 10;
    for (const req of selectedItem.craftingRequirements) {
      const totalQuantity = getTotalItemQuantity(userItems, req.requirementItemId);
      const maxForThisMaterial = Math.floor(totalQuantity / req.quantity);
      max = Math.min(max, maxForThisMaterial);
    }
    return max;
  }, [selectedItem, userItems]);

  // Sync craftQuantity when maxCraftable changes
  useEffect(() => {
    if (craftQuantity > maxCraftable) {
      setCraftQuantity(Math.max(1, maxCraftable));
    }
  }, [maxCraftable, craftQuantity]);

  // Calculate crafting time
  const craftingTimeDisplay = useMemo(() => {
    if (!selectedItem || !userData) return "";
    const userCraftingRank = getCraftingRank(userData.craftingExperience || 0);
    const craftingTime =
      selectedItem.itemType === "CONSUMABLE"
        ? CONSUMABLE_CRAFTING_TIMES_MINS[selectedItem.rarity]
        : CRAFTING_TIMES_MINS[userCraftingRank][selectedItem.rarity];

    const sectors = userData.village?.sectors?.length || 0;
    const shrineBoost = getShrineBoost(sectors, "Crafting", userData.village);
    const shrineBoostFactor = shrineBoost ? 1 - shrineBoost : 1;

    const totalSeconds = Math.round(
      craftingTime * 60 * shrineBoostFactor * craftQuantity,
    );
    return formatSecondsToTimeDisplay(totalSeconds);
  }, [selectedItem, userData, craftQuantity]);

  // Check if user can craft the selected item
  const canCraft = useMemo(() => {
    if (!selectedItem || !userItems || isCurrentlyCrafting) return false;
    return selectedItem.craftingRequirements.every((req) => {
      const totalQuantity = getTotalItemQuantity(userItems, req.requirementItemId);
      return totalQuantity >= req.quantity * craftQuantity;
    });
  }, [selectedItem, userItems, craftQuantity, isCurrentlyCrafting]);

  // Handle craft
  const handleCraft = () => {
    if (selectedItem && canCraft) {
      craftItemMutation.mutate({ itemId: selectedItem.id, quantity: craftQuantity });
    }
  };

  // Category counts
  const categoryCounts = useMemo<Record<CatalogCategory, number>>(() => {
    const counts: Record<CatalogCategory, number> = {
      WEAPON: 0,
      ARMOR: 0,
      CONSUMABLE: 0,
      OTHER: 0,
    };
    if (!craftableItems) return counts;
    for (const item of craftableItems) {
      if (CATEGORY_CONFIG.WEAPON.itemTypes.includes(item.itemType)) {
        counts.WEAPON++;
      } else if (CATEGORY_CONFIG.ARMOR.itemTypes.includes(item.itemType)) {
        counts.ARMOR++;
      } else if (CATEGORY_CONFIG.CONSUMABLE.itemTypes.includes(item.itemType)) {
        counts.CONSUMABLE++;
      } else {
        counts.OTHER++;
      }
    }
    return counts;
  }, [craftableItems]);

  return (
    <>
      {/* Category Selection Grid */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {(
          Object.entries(CATEGORY_CONFIG) as [
            CatalogCategory,
            (typeof CATEGORY_CONFIG)[CatalogCategory],
          ][]
        ).map(([category, config]) => (
          <Card
            key={category}
            className="cursor-pointer transition-colors hover:bg-accent"
            onClick={() => setSelectedCategory(category)}
          >
            <CardContent className="flex flex-col items-center justify-center gap-2 p-6">
              {config.icon}
              <span className="font-semibold">{config.label}</span>
              <span className="text-muted-foreground text-sm">
                {categoryCounts[category] || 0} recipes
              </span>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Category Modal */}
      <Modal2
        title={
          selectedCategory
            ? `${CATEGORY_CONFIG[selectedCategory].label} Recipes`
            : "Recipes"
        }
        isOpen={selectedCategory !== null && selectedItem === null}
        setIsOpen={(open) => {
          if (!open) {
            setSelectedCategory(null);
            setSearchQuery("");
            setRarityFilter("ALL");
          }
        }}
        className="max-w-4xl"
      >
        <div className="space-y-4">
          {/* Search and Filter */}
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              placeholder="Search by name or material..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1"
            />
            <Select value={rarityFilter} onValueChange={setRarityFilter}>
              <SelectTrigger className="w-full sm:w-40">
                <SelectValue placeholder="Rarity" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Rarities</SelectItem>
                {ItemRarities.map((rarity) => (
                  <SelectItem key={rarity} value={rarity}>
                    {rarity.charAt(0) + rarity.slice(1).toLowerCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Items Grid */}
          <ActionSelector
            items={filteredItems.map((item) => ({
              id: item.id,
              name: item.name,
              image: item.image,
              rarity: item.rarity,
              type: "item" as const,
              effects: item.effects,
              hidden: item.hidden,
            }))}
            showBgColor={false}
            showLabels={true}
            onClick={(id) => {
              const item = filteredItems.find((i) => i.id === id);
              if (item) {
                setSelectedItem(item);
                setCraftQuantity(1);
              }
            }}
            emptyText="No recipes found"
          />
        </div>
      </Modal2>

      {/* Item Detail Modal */}
      <Modal2
        title="Recipe Details"
        isOpen={selectedItem !== null}
        setIsOpen={(open) => {
          if (!open) {
            setSelectedItem(null);
            setCraftQuantity(1);
          }
        }}
        proceed_label={
          craftItemMutation.isPending
            ? undefined
            : isCurrentlyCrafting
              ? "Currently Crafting"
              : canCraft
                ? "Start Crafting"
                : "Missing Materials"
        }
        onAccept={handleCraft}
        confirmClassName={
          canCraft && !isCurrentlyCrafting
            ? "bg-blue-600 text-white hover:bg-blue-700"
            : "bg-red-600 text-white hover:bg-red-700"
        }
      >
        {selectedItem && (
          <div className="space-y-4">
            {/* Back button */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSelectedItem(null);
                setCraftQuantity(1);
              }}
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to {selectedCategory && CATEGORY_CONFIG[selectedCategory].label}
            </Button>

            {/* Item display */}
            <ItemWithEffects item={selectedItem} />

            {/* Quantity Selector */}
            <div className="rounded-lg bg-slate-100 p-3 dark:bg-slate-800">
              <label
                htmlFor="craft-quantity"
                className="mb-2 block font-medium text-sm"
              >
                Quantity to Craft (Max: {maxCraftable})
              </label>
              <Input
                id="craft-quantity"
                type="number"
                min={maxCraftable > 0 ? 1 : 0}
                max={maxCraftable > 0 ? Math.min(maxCraftable, 10) : 0}
                value={maxCraftable > 0 ? craftQuantity : 0}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  if (
                    !Number.isNaN(val) &&
                    val >= 1 &&
                    val <= Math.min(maxCraftable, 10)
                  ) {
                    setCraftQuantity(val);
                  }
                }}
                disabled={maxCraftable === 0}
                className="w-full"
              />
            </div>

            {/* Crafting Info */}
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-900/20">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm">Total Crafting Time:</span>
                  <span className="font-semibold text-sm">{craftingTimeDisplay}</span>
                </div>
                {(selectedItem.craftingExperience ?? 0) > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-sm">Total Experience Gain:</span>
                    <span className="font-semibold text-green-600 text-sm">
                      +{(selectedItem.craftingExperience ?? 0) * craftQuantity} EXP
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Required Materials */}
            {selectedItem.craftingRequirements.length > 0 && (
              <div className="rounded-lg bg-slate-100 p-3 dark:bg-slate-800">
                <h4 className="mb-2 font-semibold text-sm">Required Materials</h4>
                <div className="space-y-2">
                  {selectedItem.craftingRequirements.map((req, index) => {
                    const totalQuantity = getTotalItemQuantity(
                      userItems || [],
                      req.requirementItemId,
                    );
                    const required = req.quantity * craftQuantity;
                    const hasEnough = totalQuantity >= required;

                    return (
                      <div key={index} className="flex items-center gap-2">
                        {req.requirementItem?.image && (
                          <ContentImage
                            image={req.requirementItem.image}
                            alt={req.requirementItem.name || "Material"}
                            className="h-8 w-8 shrink-0"
                            rarity={req.requirementItem.rarity}
                          />
                        )}
                        <span className="flex-1 text-sm">
                          {required}x {req.requirementItem?.name || "Unknown Item"}
                        </span>
                        <div
                          className={`shrink-0 font-medium text-sm ${
                            hasEnough ? "text-green-600" : "text-red-600"
                          }`}
                        >
                          {totalQuantity}/{required}
                          {hasEnough ? " ✓" : " ✗"}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Currently crafting warning */}
            {isCurrentlyCrafting && (
              <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-3 dark:border-yellow-800 dark:bg-yellow-900/20">
                <p className="text-sm text-yellow-800 dark:text-yellow-200">
                  You are currently crafting another item. Please wait for it to finish
                  before starting a new craft.
                </p>
              </div>
            )}
          </div>
        )}
      </Modal2>
    </>
  );
};

export default CraftingCatalog;
