"use client";

import { Check } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import Image from "@/layout/Image";
import Modal2 from "@/layout/Modal2";
import { cn } from "@/libs/shadui";
import type { FarmCollectionLogState } from "@/validators/farming";

type FarmCollectionLogProps = {
  collectionLog: FarmCollectionLogState;
  isOpen: boolean;
  setIsOpen: Dispatch<SetStateAction<boolean>>;
};

const firstHarvestDate = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
});

export function FarmCollectionLog({
  collectionLog,
  isOpen,
  setIsOpen,
}: FarmCollectionLogProps) {
  return (
    <Modal2
      title={`Collection Log — ${collectionLog.collected}/${collectionLog.total}`}
      isOpen={isOpen}
      setIsOpen={setIsOpen}
      className="sm:max-w-3xl"
      bodyClassName="space-y-4"
    >
      <p className="text-muted-foreground text-sm">
        Crops are added the first time you harvest them from a ready farm plot.
      </p>
      {collectionLog.items.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-center text-muted-foreground text-sm">
          No eligible crops are currently configured.
        </p>
      ) : (
        <ul
          className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4"
          aria-label="Farm crop collection"
        >
          {collectionLog.items.map((entry) => (
            <li
              key={entry.itemId}
              className={cn(
                "relative flex min-w-0 flex-col items-center rounded-lg border p-3 text-center",
                entry.harvested
                  ? "border-emerald-500/50 bg-emerald-500/5"
                  : "border-dashed opacity-60",
              )}
              data-harvested={entry.harvested}
            >
              <div className="relative mb-2">
                <Image
                  src={entry.image}
                  alt={entry.name}
                  width={72}
                  height={72}
                  className={cn(
                    "h-16 w-16 object-contain sm:h-[72px] sm:w-[72px]",
                    !entry.harvested && "grayscale",
                  )}
                />
                {entry.harvested && (
                  <span
                    className="absolute -top-1 -right-1 rounded-full bg-emerald-600 p-1 text-white shadow"
                    aria-hidden="true"
                    data-testid={`collection-check-${entry.itemId}`}
                  >
                    <Check className="h-4 w-4" strokeWidth={3} />
                  </span>
                )}
              </div>
              <p className="w-full truncate font-medium text-sm" title={entry.name}>
                {entry.name}
              </p>
              <p className="mt-1 text-muted-foreground text-xs">
                {entry.harvested && entry.firstHarvestedAt
                  ? `First harvested ${firstHarvestDate.format(entry.firstHarvestedAt)}`
                  : "Not yet harvested"}
              </p>
              <span className="sr-only">
                {entry.harvested ? "Collected" : "Not collected"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Modal2>
  );
}
