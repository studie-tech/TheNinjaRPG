"use client";

import { Hourglass, PackageOpen } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  FARM_MAX_CROP_SELL_QUANTITY,
  FARM_SEED_EXTRACTION_SECONDS_PER_CROP,
} from "@/drizzle/constants";
import Countdown from "@/layout/Countdown";
import { FarmQuantityStepper } from "@/layout/FarmQuantityStepper";
import Image from "@/layout/Image";
import { getExtractorCropCapacity, getFarmQuantityPrice } from "@/libs/farming";
import type { FarmStateResponse } from "@/validators/farming";

type FarmInventoryProps = {
  farmState: FarmStateResponse;
  pendingKeys: Set<string>;
  /** Harvested crops with selling, or the seed extractors. */
  view: "crops" | "extraction";
  onSell: (userItemId: string, quantity: number) => Promise<boolean>;
  onExtract: (
    extractorSlot: number,
    userItemId: string,
    quantity: number,
  ) => Promise<boolean>;
  onOpenMarket: () => void;
  onOpenUpgrades: () => void;
  onExtractionFinished: () => void;
  timeDiff: number;
};

/** Harvested crops and seed extraction, one row per crop with its own action. */
export function FarmInventory({
  farmState,
  pendingKeys,
  view,
  onSell,
  onExtract,
  onOpenMarket,
  onOpenUpgrades,
  onExtractionFinished,
  timeDiff,
}: FarmInventoryProps) {
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const extractorCropCapacity = getExtractorCropCapacity(1);
  const setQuantity = (key: string, quantity: number) =>
    setQuantities((current) => ({ ...current, [key]: quantity }));

  if (view === "crops") {
    if (farmState.sellableCrops.length === 0) {
      return (
        <EmptyState
          message="Harvested crops are stored here until you sell or cook them."
          action="Buy seeds"
          onAction={onOpenMarket}
        />
      );
    }
    return (
      <ul className="grid gap-2">
        {farmState.sellableCrops.map((crop) => {
          const key = `sell:${crop.userItemId}`;
          const pending = pendingKeys.has(key);
          const max = Math.min(FARM_MAX_CROP_SELL_QUANTITY, crop.quantity);
          const quantity = Math.min(quantities[key] ?? 1, max);
          const validQuantity =
            Number.isInteger(quantity) && quantity >= 1 && quantity <= max;
          return (
            <li
              key={key}
              className="flex flex-col gap-2 rounded-md border bg-card p-2.5 @[640px]:flex-row @[640px]:items-center"
            >
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <Image src={crop.image} alt="" width={40} height={40} />
                <div className="min-w-0">
                  <p className="font-medium text-sm">
                    {crop.name}{" "}
                    <span className="font-normal text-muted-foreground">
                      ×{crop.quantity}
                    </span>
                  </p>
                  <p className="text-muted-foreground text-xs">
                    Sells for {crop.sellValue} coins each
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-end gap-2">
                <FarmQuantityStepper
                  value={quantity}
                  max={max}
                  disabled={pending}
                  onChange={(value) => setQuantity(key, value)}
                  label={`${crop.name} sale quantity`}
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="min-w-28"
                  disabled={pending || !validQuantity}
                  onClick={() => void onSell(crop.userItemId, quantity)}
                >
                  {pending
                    ? "Selling…"
                    : `Sell for ${getFarmQuantityPrice(crop.sellValue, validQuantity ? quantity : 1).toLocaleString()}`}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    );
  }

  if (farmState.farmExtractorsOwned < 1) {
    return (
      <EmptyState
        message="A seed extractor turns harvested crops back into seeds."
        action="See upgrades"
        onAction={onOpenUpgrades}
      />
    );
  }

  return (
    <div className="grid gap-3 @[880px]:grid-cols-2">
      {Array.from({ length: farmState.farmExtractorsOwned }, (_, extractorSlot) => {
        const active = farmState.activeSeedExtractions.find(
          (extraction) => extraction.extractorSlot === extractorSlot,
        );
        return (
          <section
            key={extractorSlot}
            aria-label={`Seed extractor ${extractorSlot + 1}`}
            className="space-y-2 rounded-md border bg-card p-3"
          >
            <h3 className="flex items-center gap-2 font-semibold text-sm">
              <Hourglass
                className="h-4 w-4 text-amber-600 dark:text-amber-400"
                aria-hidden
              />
              Seed extractor {extractorSlot + 1}
            </h3>
            {active ? (
              <div className="flex items-center gap-3 rounded-md bg-muted p-3 text-sm">
                <Image src={active.seedImage} alt="" width={40} height={40} />
                <div>
                  <p className="font-medium">
                    {active.cropQuantity}× {active.cropName} → {active.seedQuantity}×{" "}
                    {active.seedName}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    Ready in{" "}
                    <Countdown
                      targetDate={active.finishAt}
                      timeDiff={timeDiff}
                      onFinish={onExtractionFinished}
                    />
                  </p>
                </div>
              </div>
            ) : farmState.extractableCrops.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                Idle. Harvest crops to extract seeds from them.
              </p>
            ) : (
              <ul className="grid gap-2">
                {farmState.extractableCrops.map((crop) => {
                  const key = `extract:${extractorSlot}:${crop.userItemId}`;
                  const pending = pendingKeys.has(key);
                  const max = Math.min(extractorCropCapacity, crop.quantity);
                  const quantity = Math.min(quantities[key] ?? 1, max);
                  const validQuantity =
                    Number.isInteger(quantity) && quantity >= 1 && quantity <= max;
                  return (
                    <li key={key} className="space-y-2 rounded-md border p-2.5">
                      <div className="flex items-center gap-3">
                        <Image src={crop.image} alt="" width={36} height={36} />
                        <div className="min-w-0">
                          <p className="font-medium text-sm">
                            {crop.name}{" "}
                            <span className="font-normal text-muted-foreground">
                              ×{crop.quantity}
                            </span>
                          </p>
                          <p className="text-muted-foreground text-xs">
                            {validQuantity
                              ? `${quantity} → ${crop.seedCount * quantity} seeds in ${(FARM_SEED_EXTRACTION_SECONDS_PER_CROP / 60) * quantity} minutes`
                              : `${crop.seedCount} seeds per crop`}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center justify-end gap-2">
                        <FarmQuantityStepper
                          value={quantity}
                          max={max}
                          disabled={pending}
                          onChange={(value) => setQuantity(key, value)}
                          label={`${crop.name} extractor ${extractorSlot + 1} quantity`}
                        />
                        <Button
                          size="sm"
                          disabled={pending || !validQuantity}
                          onClick={() =>
                            void onExtract(extractorSlot, crop.userItemId, quantity)
                          }
                        >
                          {pending ? "Starting…" : "Extract"}
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

const EmptyState = ({ message, action, onAction }: EmptyStateProps) => (
  <div className="flex flex-col items-center gap-3 rounded-md border border-dashed p-5 text-center">
    <PackageOpen className="h-6 w-6 text-muted-foreground" aria-hidden />
    <p className="text-muted-foreground text-sm">{message}</p>
    <Button size="sm" variant="outline" onClick={onAction}>
      {action}
    </Button>
  </div>
);

type EmptyStateProps = { message: string; action: string; onAction: () => void };
