"use client";

import { Hourglass, PackageOpen } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  FARM_MAX_CROP_SELL_QUANTITY,
  FARM_SEED_EXTRACTION_SECONDS_PER_CROP,
} from "@/drizzle/constants";
import Countdown from "@/layout/Countdown";
import { FarmQuantityStepper } from "@/layout/FarmQuantityStepper";
import { FarmTransactionSummary } from "@/layout/FarmTransactionSummary";
import Image from "@/layout/Image";
import { getExtractorCropCapacity } from "@/libs/farming";
import type { FarmStateResponse } from "@/validators/farming";

type FarmInventoryProps = {
  farmState: FarmStateResponse;
  pendingKeys: Set<string>;
  onSell: (userItemId: string, quantity: number) => Promise<boolean>;
  onExtract: (
    extractorSlot: number,
    userItemId: string,
    quantity: number,
  ) => Promise<boolean>;
  onBrowseSeeds: () => void;
  onExtractionFinished: () => void;
  timeDiff: number;
};

export function FarmInventory({
  farmState,
  pendingKeys,
  onSell,
  onExtract,
  onBrowseSeeds,
  onExtractionFinished,
  timeDiff,
}: FarmInventoryProps) {
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const extractorCropCapacity = getExtractorCropCapacity(1);
  const setQuantity = (key: string, quantity: number) =>
    setQuantities((current) => ({ ...current, [key]: quantity }));

  const empty = (message: string) => (
    <div className="rounded-md border border-dashed p-5 text-center">
      <PackageOpen className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
      <p className="mb-3 text-muted-foreground text-sm">{message}</p>
      <Button size="sm" variant="outline" onClick={onBrowseSeeds}>
        Browse seeds
      </Button>
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Farm Inventory</CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="crops">
          <TabsList className="mb-3 grid w-full grid-cols-3">
            <TabsTrigger value="crops">Crops</TabsTrigger>
            <TabsTrigger value="extract">Seed Extraction</TabsTrigger>
            <TabsTrigger value="sell">Selling</TabsTrigger>
          </TabsList>
          <TabsContent value="crops">
            {farmState.sellableCrops.length === 0 ? (
              empty("Harvested crops will appear here.")
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {farmState.sellableCrops.map((crop) => (
                  <div
                    key={crop.userItemId}
                    className="flex items-center gap-3 rounded-md border p-3"
                  >
                    <Image src={crop.image} alt="" width={36} height={36} />
                    <div>
                      <p className="font-medium text-sm">{crop.name}</p>
                      <p className="text-muted-foreground text-xs">
                        {crop.quantity} available
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
          <TabsContent value="extract">
            {farmState.farmExtractorsOwned < 1 ? (
              empty("Purchase a seed extractor to convert crops into seeds.")
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                {Array.from(
                  { length: farmState.farmExtractorsOwned },
                  (_, extractorSlot) => {
                    const active = farmState.activeSeedExtractions.find(
                      (extraction) => extraction.extractorSlot === extractorSlot,
                    );
                    return (
                      <div
                        key={extractorSlot}
                        className="space-y-3 rounded-md border p-3"
                      >
                        <div className="flex items-center gap-2 font-medium text-sm">
                          <Hourglass className="h-4 w-4 text-amber-600" />
                          Seed Extractor {extractorSlot + 1}
                        </div>
                        {active ? (
                          <div className="space-y-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
                            <div className="flex items-center gap-3">
                              <Image
                                src={active.cropImage}
                                alt=""
                                width={36}
                                height={36}
                              />
                              <div>
                                <p className="font-medium text-sm">
                                  Input: {active.cropQuantity}x {active.cropName}
                                </p>
                                <p className="text-muted-foreground text-xs">
                                  Time remaining:{" "}
                                  <Countdown
                                    targetDate={active.finishAt}
                                    timeDiff={timeDiff}
                                    onFinish={onExtractionFinished}
                                  />
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-3 border-t pt-3">
                              <Image
                                src={active.seedImage}
                                alt=""
                                width={36}
                                height={36}
                              />
                              <p className="font-medium text-sm">
                                Output: {active.seedQuantity}x {active.seedName}
                              </p>
                            </div>
                          </div>
                        ) : farmState.extractableCrops.length === 0 ? (
                          empty("No crops can be extracted right now.")
                        ) : (
                          farmState.extractableCrops.map((crop) => {
                            const key = `extract:${extractorSlot}:${crop.userItemId}`;
                            const pending = pendingKeys.has(key);
                            const max = Math.min(extractorCropCapacity, crop.quantity);
                            const quantity = Math.min(quantities[key] ?? 1, max);
                            return (
                              <div
                                key={key}
                                className="space-y-2 rounded-md border p-3"
                              >
                                <div className="flex items-center gap-3">
                                  <Image
                                    src={crop.image}
                                    alt=""
                                    width={36}
                                    height={36}
                                  />
                                  <div>
                                    <p className="font-medium text-sm">{crop.name}</p>
                                    <p className="text-muted-foreground text-xs">
                                      {crop.seedCount} seeds per crop · {crop.quantity}{" "}
                                      available
                                    </p>
                                  </div>
                                </div>
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <FarmQuantityStepper
                                    value={quantity}
                                    max={max}
                                    disabled={pending}
                                    onChange={(value) => setQuantity(key, value)}
                                    label={`${crop.name} extractor ${extractorSlot + 1} quantity`}
                                  />
                                  <Button
                                    size="sm"
                                    disabled={pending}
                                    onClick={() =>
                                      void onExtract(
                                        extractorSlot,
                                        crop.userItemId,
                                        quantity,
                                      )
                                    }
                                  >
                                    {pending ? "Starting…" : "Extract"}
                                  </Button>
                                </div>
                                <FarmTransactionSummary
                                  verb="Extract"
                                  quantity={quantity}
                                  itemName={crop.name}
                                  suffix={`${crop.seedCount * quantity} seeds · ${(FARM_SEED_EXTRACTION_SECONDS_PER_CROP / 60) * quantity} minutes`}
                                />
                              </div>
                            );
                          })
                        )}
                      </div>
                    );
                  },
                )}
              </div>
            )}
          </TabsContent>
          <TabsContent value="sell">
            {farmState.sellableCrops.length === 0 ? (
              empty("No crops are available to sell.")
            ) : (
              <div className="space-y-3">
                {farmState.sellableCrops.map((crop) => {
                  const key = `sell:${crop.userItemId}`;
                  const pending = pendingKeys.has(key);
                  const max = Math.min(FARM_MAX_CROP_SELL_QUANTITY, crop.quantity);
                  const quantity = Math.min(quantities[key] ?? 1, max);
                  return (
                    <div key={key} className="space-y-2 rounded-md border p-3">
                      <div className="flex items-center gap-3">
                        <Image src={crop.image} alt="" width={36} height={36} />
                        <div>
                          <p className="font-medium text-sm">{crop.name}</p>
                          <p className="text-muted-foreground text-xs">
                            {crop.sellValue} coins each · {crop.quantity} available
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <FarmQuantityStepper
                          value={quantity}
                          max={max}
                          disabled={pending}
                          onChange={(value) => setQuantity(key, value)}
                          label={`${crop.name} sale quantity`}
                        />
                        <Button
                          size="sm"
                          disabled={pending}
                          onClick={() => void onSell(crop.userItemId, quantity)}
                        >
                          {pending ? "Selling…" : "Sell"}
                        </Button>
                      </div>
                      <FarmTransactionSummary
                        verb="Sell"
                        quantity={quantity}
                        itemName={crop.name}
                        unitPrice={crop.sellValue}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
