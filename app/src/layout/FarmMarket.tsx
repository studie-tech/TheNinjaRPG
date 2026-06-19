"use client";

import { Filter, ShoppingBag } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FarmQuantityStepper } from "@/layout/FarmQuantityStepper";
import { FarmTransactionSummary } from "@/layout/FarmTransactionSummary";
import Image from "@/layout/Image";
import type { FarmShopEntryState, FarmStateResponse } from "@/validators/farming";

type FarmMarketProps = {
  farmState: FarmStateResponse;
  pendingKeys: Set<string>;
  onBuy: (entry: FarmShopEntryState, quantity: number) => Promise<boolean>;
};

const duration = (seconds?: number) => {
  if (!seconds) return null;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.ceil((seconds % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
};

export function FarmMarket({ farmState, pendingKeys, onBuy }: FarmMarketProps) {
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [affordableOnly, setAffordableOnly] = useState(false);
  const [unlockedOnly, setUnlockedOnly] = useState(false);

  const entries = farmState.shopEntries.filter(
    (entry) =>
      (!affordableOnly || entry.canAfford) &&
      (!unlockedOnly || farmState.farmingLevel >= entry.minLevel),
  );
  const seeds = entries.filter((entry) => entry.type === "SEED");
  const supplies = entries.filter((entry) => entry.type === "FERTILIZER");
  const upgrades = entries.filter(
    (entry) => entry.type === "PLOT" || entry.type === "EXTRACTOR",
  );

  const renderEntries = (items: FarmShopEntryState[]) =>
    items.length === 0 ? (
      <p className="rounded-md border border-dashed p-5 text-center text-muted-foreground text-sm">
        No items match these filters.
      </p>
    ) : (
      <div className="grid gap-3 sm:grid-cols-2">
        {items.map((entry) => {
          const key = `${entry.type}:${entry.itemId ?? "upgrade"}`;
          const pending = pendingKeys.has(`buy:${key}`);
          const consumable = entry.type === "SEED" || entry.type === "FERTILIZER";
          const max = consumable
            ? Math.max(1, Math.min(99, Math.floor(farmState.farmCurrency / entry.cost)))
            : 1;
          const quantity = Math.min(quantities[key] ?? 1, max);
          return (
            <div key={key} className="space-y-3 rounded-lg border p-3">
              <div className="flex gap-3">
                {entry.itemImage && (
                  <Image src={entry.itemImage} alt="" width={44} height={44} />
                )}
                <div className="min-w-0">
                  <p className="truncate font-medium text-sm">{entry.label}</p>
                  <p className="text-muted-foreground text-xs">
                    {entry.cost.toLocaleString()} coins each · Lv {entry.minLevel}+
                  </p>
                  {entry.type === "SEED" && (
                    <p className="text-muted-foreground text-xs">
                      {duration(entry.growTimeSeconds)} → {entry.yieldQuantity}{" "}
                      {entry.yieldName} · +{entry.experience ?? 0} XP
                    </p>
                  )}
                  {entry.type === "FERTILIZER" && (
                    <p className="text-muted-foreground text-xs">
                      Reduces grow time by{" "}
                      {duration(entry.fertilizerTimeReductionSeconds)}
                    </p>
                  )}
                  {entry.lockedReason && (
                    <p className="text-destructive text-xs">{entry.lockedReason}</p>
                  )}
                </div>
              </div>
              {consumable && (
                <FarmQuantityStepper
                  value={quantity}
                  max={max}
                  disabled={pending || !entry.canPurchase}
                  onChange={(value) =>
                    setQuantities((current) => ({ ...current, [key]: value }))
                  }
                  label={`${entry.label} quantity`}
                />
              )}
              <FarmTransactionSummary
                verb="Buy"
                quantity={quantity}
                itemName={entry.label}
                unitPrice={entry.cost}
              />
              <Button
                className="w-full"
                size="sm"
                disabled={!entry.canPurchase || pending || quantity > max}
                onClick={() => void onBuy(entry, quantity)}
              >
                {pending ? "Purchasing…" : "Purchase"}
              </Button>
            </div>
          );
        })}
      </div>
    );

  return (
    <Card id="farm-market">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShoppingBag className="h-5 w-5" /> Farm Market
        </CardTitle>
        <fieldset className="flex gap-1">
          <legend className="sr-only">Market filters</legend>
          <Button
            size="sm"
            variant={affordableOnly ? "default" : "outline"}
            onClick={() => setAffordableOnly((value) => !value)}
          >
            <Filter className="mr-1 h-3.5 w-3.5" /> Affordable
          </Button>
          <Button
            size="sm"
            variant={unlockedOnly ? "default" : "outline"}
            onClick={() => setUnlockedOnly((value) => !value)}
          >
            Unlocked
          </Button>
        </fieldset>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="seeds">
          <TabsList className="mb-3 grid w-full grid-cols-3">
            <TabsTrigger value="seeds">Seeds</TabsTrigger>
            <TabsTrigger value="supplies">Supplies</TabsTrigger>
            <TabsTrigger value="upgrades">Upgrades</TabsTrigger>
          </TabsList>
          <TabsContent value="seeds">{renderEntries(seeds)}</TabsContent>
          <TabsContent value="supplies">{renderEntries(supplies)}</TabsContent>
          <TabsContent value="upgrades">{renderEntries(upgrades)}</TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
