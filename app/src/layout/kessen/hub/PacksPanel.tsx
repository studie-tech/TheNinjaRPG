"use client";

import "../kessen.css";
import "./hub.css";
import "./packs.css";
import { Info, Loader2, PackageOpen, Store } from "lucide-react";
import type React from "react";
import { useId, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { KESSEN_CARD_SELL_VALUES } from "@/drizzle/constants";
import { EmptyState } from "@/layout/EmptyState";
import { FeedbackAlert } from "@/layout/FeedbackAlert";
import Image from "@/layout/Image";
import {
  KESSEN_PACK_IDS,
  kessenPackSlotLabels,
  kessenVillagePackFaction,
} from "@/libs/kessen/packs";
import { cn } from "@/libs/shadui";
import type {
  KessenOwnedPack,
  KessenPackEntry,
  KessenPackOdds,
} from "@/validators/kessen";
import {
  KESSEN_RARITY_LABELS,
  type KessenRarityTier,
  kessenPackArt,
  kessenRenditionWidth,
} from "../kessenArt";
import { RarityGem } from "../RarityGem";

/** One stack of an owned pack, opened through its user item. */
/**
 * The player's packs as item tiles with Open buttons in a fixed order (Paper, Village,
 * Lacquer, First), the pity counters, the auto-sell switch with what a sale pays, and a
 * slot for the Card Master stall (the page passes the shop in). Without packs an empty
 * state points to the stall.
 */
export const PacksPanel = ({
  packs,
  catalogPacks = [],
  pity,
  autoSellSurplus,
  onAutoSellChange,
  onOpen,
  openingUserItemId,
  error,
  stall,
  className,
}: {
  packs: readonly KessenOwnedPack[];
  /** Catalog packs, for the odds popovers. */
  catalogPacks?: readonly KessenPackEntry[];
  pity: { epicIn: number; legendaryIn: number } | null;
  autoSellSurplus?: boolean;
  onAutoSellChange?: (enabled: boolean) => void;
  onOpen: (userItemId: string) => void;
  /** The stack being opened; its button shows progress and every button waits. */
  openingUserItemId?: string | null;
  error?: string | null;
  /** The Card Master stall. */
  stall?: React.ReactNode;
  className?: string;
}) => {
  const stallRef = useRef<HTMLElement>(null);
  const stallTitleId = useId();
  const sorted = [...packs].sort((a, b) => packOrder(a.itemId) - packOrder(b.itemId));
  return (
    // Closing a ceremony whose stack ran out returns focus to the first remaining control.
    <section className={cn("kh-packs", className)} aria-label="Packs" data-focus-group>
      <div className="kh-pack-shelf">
        <div className="kh-pack-shelf-head">
          <h2 className="kh-pack-shelf-title">Your packs</h2>
          {pity ? <PityLine pity={pity} /> : null}
        </div>
        {packs.length === 0 ? (
          <EmptyState
            icon={PackageOpen}
            className="kh-pack-empty"
            title="No packs yet"
            description="Your first rewarded win of the week brings a Paper Bundle, and the Card Master sells Paper and Village Bundles."
            action={
              stall ? (
                <Button
                  variant="outline"
                  className="h-auto min-h-[40px] text-[13px] pointer-coarse:min-h-[44px]"
                  onClick={() => {
                    stallRef.current?.scrollIntoView({ block: "start" });
                    stallRef.current?.focus({ preventScroll: true });
                  }}
                >
                  <Store className="mr-2 h-4 w-4" aria-hidden />
                  Visit the Card Master
                </Button>
              ) : null
            }
          />
        ) : (
          <ul className="kh-pack-grid">
            {sorted.map((pack) => {
              const odds = catalogPacks.find((entry) => entry.id === pack.itemId);
              const opening = openingUserItemId === pack.userItemId;
              return (
                <li key={pack.userItemId} className="kh-pack">
                  <PackArt itemId={pack.itemId} size={128} className="kh-pack-art" />
                  <Badge variant="secondary" className="kh-pack-count">
                    ×{pack.quantity}
                    <span className="sr-only"> owned</span>
                  </Badge>
                  <span data-pack-name className="kh-pack-name">
                    {pack.name}
                  </span>
                  <div className="kh-pack-actions">
                    {/* aria-disabled, not disabled: the pressed button keeps focus, so
                      closing the ceremony can return to it. */}
                    <Button
                      aria-disabled={openingUserItemId ? true : undefined}
                      aria-busy={opening}
                      className={cn(
                        "h-auto min-h-[36px] px-4 text-[13px] font-bold pointer-coarse:min-h-[44px]",
                        openingUserItemId && "cursor-not-allowed opacity-60",
                      )}
                      onClick={() => {
                        if (!openingUserItemId) onOpen(pack.userItemId);
                      }}
                    >
                      {opening ? (
                        <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />
                      ) : (
                        <PackageOpen className="mr-1.5 h-4 w-4" aria-hidden />
                      )}
                      {opening ? "Opening" : "Open"}
                    </Button>
                    {odds ? <PackOdds pack={odds} /> : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {error ? (
          <div className="kh-feedback">
            <FeedbackAlert feedback={{ success: false, message: error }} foreground />
          </div>
        ) : null}
        {onAutoSellChange ? (
          <div className="kh-autosell">
            <Switch
              id={`${stallTitleId}-autosell`}
              touchTarget
              checked={autoSellSurplus ?? false}
              aria-describedby={`${stallTitleId}-sell`}
              onCheckedChange={onAutoSellChange}
            />
            <div className="min-w-0">
              <Label htmlFor={`${stallTitleId}-autosell`} className="kh-autosell-label">
                Auto-sell surplus copies (beyond the copy limit) when they are granted
              </Label>
              <p id={`${stallTitleId}-sell`} className="kh-autosell-help">
                A sold copy pays {sellValues()} ryo by rarity. Forbidden copies and
                leaders are never sold.
              </p>
            </div>
          </div>
        ) : null}
      </div>
      {stall ? (
        <section
          ref={stallRef}
          className="kh-pack-shelf kh-stall"
          tabIndex={-1}
          aria-labelledby={stallTitleId}
        >
          <div className="kh-pack-shelf-head">
            <h2 id={stallTitleId} className="kh-pack-shelf-title">
              The Card Master's stall
            </h2>
          </div>
          {stall}
        </section>
      ) : null}
    </section>
  );
};

/** Fixed tile order of the pack kinds. */
const packOrder = (itemId: string) =>
  itemId === KESSEN_PACK_IDS.paper
    ? 0
    : kessenVillagePackFaction(itemId)
      ? 1
      : itemId === KESSEN_PACK_IDS.lacquer
        ? 2
        : itemId === KESSEN_PACK_IDS.first
          ? 3
          : 4;

/** "50 / 200 / 1,000 / 5,000": what a surplus copy of each rarity sells for. */
const sellValues = () =>
  (["COMMON", "RARE", "EPIC", "LEGENDARY"] as const)
    .map((rarity) => KESSEN_CARD_SELL_VALUES[rarity].toLocaleString())
    .join(" / ");

/** "Epic within 3 packs · Legendary within 23 packs". */
export const PityLine = ({
  pity,
  className,
}: {
  pity: { epicIn: number; legendaryIn: number };
  className?: string;
}) => (
  <p className={cn("kh-pity", className)}>
    <span>
      <RarityGem tier="EPIC" decorative /> Epic within {pity.epicIn}{" "}
      {pity.epicIn === 1 ? "pack" : "packs"}
    </span>
    <span>
      <RarityGem tier="LEGENDARY" decorative /> Legendary within {pity.legendaryIn}{" "}
      {pity.legendaryIn === 1 ? "pack" : "packs"}
    </span>
  </p>
);

/** Pack illustration. */
export const PackArt = ({
  itemId,
  size,
  className,
}: {
  itemId: string;
  /** CSS width it is shown at; picks the rendition. */
  size: number;
  className?: string;
}) => {
  const width = kessenRenditionWidth(size);
  return (
    <span
      className={cn("block aspect-square drop-shadow-md", className)}
      style={{ width: size }}
      aria-hidden
    >
      <Image
        src={kessenPackArt(itemId)}
        alt=""
        width={width}
        height={width}
        className="h-full w-full object-contain"
      />
    </span>
  );
};

/** Slot odds of a pack in a popover. */
const PackOdds = ({ pack }: { pack: KessenPackEntry }) => {
  const labels = kessenPackSlotLabels(pack.slots);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 pointer-coarse:h-[44px] pointer-coarse:w-[44px]"
          aria-label={`Odds of the ${pack.name}`}
        >
          <Info className="h-[18px] w-[18px]" aria-hidden />
        </Button>
      </PopoverTrigger>
      {/* Portalled under <body>: `kessen-ui` carries the hall's type scale into it. */}
      <PopoverContent className="kessen-ui w-72 p-3">
        <p className="kh-odds-title">{pack.name}</p>
        <p className="kh-odds-sub">Rarity odds for each card</p>
        <table className="kh-odds">
          <thead>
            <tr>
              <th scope="col">Rarity</th>
              <th scope="col">{labels.normal}</th>
              {pack.slots.rareSlot > 0 ? <th scope="col">{labels.rareSlot}</th> : null}
            </tr>
          </thead>
          <tbody>
            {ODDS_TIERS.map((tier) => (
              <tr key={tier}>
                <th scope="row">
                  <span className="kh-odds-tier">
                    <RarityGem tier={tier} decorative /> {KESSEN_RARITY_LABELS[tier]}
                  </span>
                </th>
                <td>{formatOdds(pack.odds.normal, tier)}</td>
                {pack.slots.rareSlot > 0 ? (
                  <td>{formatOdds(pack.odds.rareSlot, tier)}</td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </PopoverContent>
    </Popover>
  );
};

const ODDS_TIERS: readonly KessenRarityTier[] = [
  "COMMON",
  "RARE",
  "EPIC",
  "LEGENDARY",
  "FORBIDDEN",
];

/** Basis points as a percentage: one decimal from 1 %, two below, no trailing zeros. */
export const formatOdds = (odds: KessenPackOdds, tier: KessenRarityTier) => {
  const bp = odds[tier] ?? 0;
  if (bp <= 0) return "–";
  const percent = bp / 100;
  return `${Number(percent.toFixed(percent < 1 ? 2 : 1))}%`;
};
