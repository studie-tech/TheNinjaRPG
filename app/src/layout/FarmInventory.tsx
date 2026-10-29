"use client";

import { Coins, Hourglass, PackageOpen } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  FARM_MAX_CROP_SELL_QUANTITY,
  FARM_SEED_EXTRACTION_SECONDS_PER_CROP,
} from "@/drizzle/constants";
import Countdown from "@/layout/Countdown";
import { FarmItemCount } from "@/layout/FarmItemCount";
import { FarmQuantityStepper } from "@/layout/FarmQuantityStepper";
import Image from "@/layout/Image";
import { getExtractorCropCapacity, getFarmQuantityPrice } from "@/libs/farming";
import type { FarmStateResponse } from "@/validators/farming";

/** Card grid that adds columns as the farm gets wider. */
export const FARM_CARD_GRID =
  "grid gap-2 grid-cols-[repeat(auto-fill,minmax(min(100%,280px),1fr))]";

type SellableCrop = FarmStateResponse["sellableCrops"][number];

type FarmInventoryProps = {
  farmState: FarmStateResponse;
  pendingKeys: Set<string>;
  /** Harvested crops with selling, or the seed extractors. */
  view: "crops" | "extraction";
  onSell: (userItemId: string, quantity: number) => Promise<boolean>;
  onSellAll: (crops: SellableCrop[]) => Promise<boolean>;
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

/** Harvested crops and seed extraction as card grids, each card with its own action. */
export function FarmInventory({
  farmState,
  pendingKeys,
  view,
  onSell,
  onSellAll,
  onExtract,
  onOpenMarket,
  onOpenUpgrades,
  onExtractionFinished,
  timeDiff,
}: FarmInventoryProps) {
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [confirmSellAll, setConfirmSellAll] = useState(false);
  const setQuantity = (key: string, quantity: number) =>
    setQuantities((current) => ({ ...current, [key]: quantity }));

  if (view === "crops") {
    const crops = farmState.sellableCrops;
    if (crops.length === 0) {
      return (
        <EmptyState
          message="Harvested crops are stored here until you sell or cook them."
          action="Buy seeds"
          onAction={onOpenMarket}
        />
      );
    }
    const sellingAll = pendingKeys.has("sell:all");
    const cropTotal = crops.reduce((sum, crop) => sum + crop.quantity, 0);
    const valueTotal = crops.reduce(
      (sum, crop) => sum + getFarmQuantityPrice(crop.sellValue, crop.quantity),
      0,
    );
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-muted-foreground text-sm">
            {cropTotal} {cropTotal === 1 ? "crop" : "crops"} worth{" "}
            {valueTotal.toLocaleString()} farm coins. Crops are also cooking
            ingredients.
          </p>
          {confirmSellAll ? (
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                disabled={sellingAll}
                onClick={() => {
                  setConfirmSellAll(false);
                  void onSellAll(crops);
                }}
              >
                Sell {cropTotal} for {valueTotal.toLocaleString()}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setConfirmSellAll(false)}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              size="sm"
              variant="outline"
              disabled={sellingAll}
              onClick={() => setConfirmSellAll(true)}
            >
              <Coins className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              {sellingAll ? "Selling…" : "Sell all"}
            </Button>
          )}
        </div>
        <ul className={FARM_CARD_GRID}>
          {crops.map((crop) => {
            const key = `sell:${crop.userItemId}`;
            const pending = sellingAll || pendingKeys.has(key);
            const max = Math.min(FARM_MAX_CROP_SELL_QUANTITY, crop.quantity);
            const quantity = Math.min(quantities[key] ?? 1, max);
            const validQuantity =
              Number.isInteger(quantity) && quantity >= 1 && quantity <= max;
            return (
              <li
                key={key}
                className="flex flex-col gap-2 rounded-md border bg-card p-2.5"
              >
                <div className="flex items-start gap-3">
                  <Image src={crop.image} alt="" width={40} height={40} />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-sm">{crop.name}</p>
                    <p className="text-muted-foreground text-xs">
                      {crop.sellValue} coins each
                    </p>
                  </div>
                  <FarmItemCount count={crop.quantity} label="in storage" />
                </div>
                <div className="flex items-center justify-end gap-2">
                  <FarmQuantityStepper
                    value={quantity}
                    max={max}
                    disabled={pending}
                    onChange={(value) => setQuantity(key, value)}
                    label={`${crop.name} sale quantity`}
                    showMax
                  />
                  <Button
                    size="sm"
                    disabled={pending || !validQuantity}
                    onClick={() => void onSell(crop.userItemId, quantity)}
                  >
                    {pendingKeys.has(key)
                      ? "Selling…"
                      : `Sell for ${getFarmQuantityPrice(crop.sellValue, validQuantity ? quantity : 1).toLocaleString()}`}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
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

  const extractorSlots = Array.from(
    { length: farmState.farmExtractorsOwned },
    (_, slot) => slot,
  );
  const activeBySlot = new Map(
    farmState.activeSeedExtractions.map((extraction) => [
      extraction.extractorSlot,
      extraction,
    ]),
  );
  // New extractions go to the first idle extractor.
  const idleSlot = extractorSlots.find((slot) => !activeBySlot.has(slot));
  const capacity = getExtractorCropCapacity(1);
  const minutesPerCrop = FARM_SEED_EXTRACTION_SECONDS_PER_CROP / 60;

  return (
    <div className="space-y-4">
      <ul className={FARM_CARD_GRID} aria-label="Seed extractors">
        {extractorSlots.map((slot) => {
          const active = activeBySlot.get(slot);
          return (
            <li
              key={slot}
              className="flex items-center gap-3 rounded-md border bg-card p-2.5 text-sm"
            >
              {active ? (
                <Image src={active.seedImage} alt="" width={36} height={36} />
              ) : (
                <Hourglass className="mx-2 h-5 w-5 text-muted-foreground" aria-hidden />
              )}
              <div className="min-w-0">
                <p className="font-medium">Seed extractor {slot + 1}</p>
                {active ? (
                  <p className="text-muted-foreground text-xs">
                    {active.cropQuantity}× {active.cropName} → {active.seedQuantity}×{" "}
                    {active.seedName}, ready in{" "}
                    <Countdown
                      targetDate={active.finishAt}
                      timeDiff={timeDiff}
                      onFinish={onExtractionFinished}
                    />
                  </p>
                ) : (
                  <p className="text-muted-foreground text-xs">Idle</p>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <section className="space-y-2">
        <h3 className="font-semibold text-sm">Extract seeds from crops</h3>
        {farmState.extractableCrops.length === 0 ? (
          <p className="rounded-md border border-dashed p-3 text-muted-foreground text-sm">
            Harvest crops to extract seeds from them.
          </p>
        ) : (
          <>
            {idleSlot === undefined && (
              <p className="text-muted-foreground text-sm">
                All extractors are busy. You can start another extraction when one
                finishes.
              </p>
            )}
            <ul className={FARM_CARD_GRID}>
              {farmState.extractableCrops.map((crop) => {
                const key = `extract:${idleSlot}:${crop.userItemId}`;
                const pending = pendingKeys.has(key);
                const max = Math.max(1, Math.min(capacity, crop.quantity));
                const quantity = Math.min(quantities[crop.userItemId] ?? 1, max);
                const validQuantity =
                  Number.isInteger(quantity) && quantity >= 1 && quantity <= max;
                return (
                  <li
                    key={crop.userItemId}
                    className="flex flex-col gap-2 rounded-md border bg-card p-2.5"
                  >
                    <div className="flex items-start gap-3">
                      <Image src={crop.image} alt="" width={40} height={40} />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-sm">{crop.name}</p>
                        <p className="text-muted-foreground text-xs">
                          {validQuantity
                            ? `${quantity} → ${crop.seedCount * quantity} seeds in ${minutesPerCrop * quantity} minutes`
                            : `${crop.seedCount} seeds per crop`}
                        </p>
                      </div>
                      <FarmItemCount count={crop.quantity} label="in storage" />
                    </div>
                    <div className="flex items-center justify-end gap-2">
                      <FarmQuantityStepper
                        value={quantity}
                        max={max}
                        disabled={pending || idleSlot === undefined}
                        onChange={(value) => setQuantity(crop.userItemId, value)}
                        label={`${crop.name} extraction quantity`}
                        showMax
                      />
                      <Button
                        size="sm"
                        disabled={pending || !validQuantity || idleSlot === undefined}
                        onClick={() => {
                          if (idleSlot !== undefined) {
                            void onExtract(idleSlot, crop.userItemId, quantity);
                          }
                        }}
                      >
                        {pending ? "Starting…" : "Extract"}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>
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
