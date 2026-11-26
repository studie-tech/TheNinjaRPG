"use client";

import { Hammer } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/ui/number-input";
import {
  CACHE_MAX_ROLLS,
  CACHE_PROBABILITY_TOTAL,
  type KessenPackTier,
} from "@/drizzle/constants";
import { EnumField, Field, TOUCH_FIELD } from "@/layout/cardEditorFields";
import { type DeckFaction, KESSEN_DECK_FACTIONS } from "@/libs/kessen/deck";
import {
  buildKessenPackEffects,
  KESSEN_PACK_TIER_NAMES,
  KESSEN_PACK_TIERS,
  kessenPackFactions,
  kessenPackOdds,
  kessenPackPool,
  kessenPackPoolProblem,
  kessenPackSlots,
  kessenPackTierOf,
} from "@/libs/kessen/packContents";
import { KESSEN_FACTION_NAMES, kessenPackSlotLabels } from "@/libs/kessen/packs";
import type { KessenCard } from "@/libs/kessen/types";
import { cn } from "@/libs/shadui";
import type { ZodAllTags } from "@/validators/combat";
import type { KessenPackSlots } from "@/validators/kessen";

/**
 * Staff builder of a Kessen pack's contents: the card pool, the normal and rare slot
 * counts and each tier's odds per slot kind. "Rebuild contents" replaces the pack's
 * Weighted Cache tags with ones built from the live card catalog, the way the seed packs
 * are built; the item is saved with the rest of the form. It starts from the pack's
 * current caches.
 */
export function KessenPackContentsEditor({
  name,
  effects,
  cards,
  disabled,
  onBuild,
}: {
  /** The pack's name, which the caches display. */
  name: string;
  effects: readonly ZodAllTags[];
  /** The card catalog the pool is drawn from. */
  cards: readonly KessenCard[];
  disabled: boolean;
  onBuild: (effects: ZodAllTags[]) => void;
}) {
  const [draft, setDraft] = useState(() => draftOf(effects, cards));
  const pool = kessenPackPool(cards, draft.faction === ALL ? null : draft.faction);
  const poolCounts = Object.fromEntries(
    KESSEN_PACK_TIERS.map((tier) => [
      tier,
      pool.filter((card) => kessenPackTierOf(card) === tier).length,
    ]),
  ) as Record<KessenPackTier, number>;
  const labels = kessenPackSlotLabels(draft.slots);
  const hasRareSlot = draft.slots.rareSlot > 0;
  const normalTotal = totalOf(draft.normal);
  const rareTotal = totalOf(draft.rareSlot);
  const problem =
    (!name.trim() ? "Enter a pack name." : null) ??
    kessenPackPoolProblem(pool) ??
    draftProblem(draft, normalTotal, rareTotal, poolCounts);
  const setWeight = (column: WeightColumn, tier: KessenPackTier, value: number) =>
    setDraft((current) => ({
      ...current,
      [column]: { ...current[column], [tier]: value },
    }));
  const setSlots = (patch: Partial<KessenPackSlots>) =>
    setDraft((current) => ({ ...current, slots: { ...current.slots, ...patch } }));

  return (
    <section
      aria-labelledby="pack-builder-heading"
      className="@container mt-3 rounded-md border p-2"
    >
      <h4 id="pack-builder-heading" className="text-base font-semibold">
        Build contents
      </h4>
      <p className="text-muted-foreground">
        Pick the pool, the slots and each rarity&apos;s odds, then rebuild. The pack
        lists every collectible card of its pool; the last slots form the rare slot that
        pity raises.
      </p>
      {/* Three fields fit one row from 432px (`@xl` at the 12px root font). */}
      <div className="mt-2 grid grid-cols-1 items-start gap-3 @xl:grid-cols-3">
        <EnumField
          id="pack-pool"
          label="Card pool"
          value={draft.faction}
          values={POOL_VALUES}
          labels={POOL_LABELS}
          disabled={disabled}
          onChange={(faction) => setDraft((current) => ({ ...current, faction }))}
        />
        <Field id="pack-normal-slots" label="Normal slots">
          <NumberInput
            id="pack-normal-slots"
            className={TOUCH_FIELD}
            value={draft.slots.normal}
            min={1}
            max={CACHE_MAX_ROLLS}
            disabled={disabled}
            onValueChange={(normal) => setSlots({ normal })}
          />
        </Field>
        <Field
          id="pack-rare-slots"
          label="Rare slots"
          help="0 for a pack without a rare slot."
        >
          <NumberInput
            id="pack-rare-slots"
            className={TOUCH_FIELD}
            value={draft.slots.rareSlot}
            min={0}
            max={CACHE_MAX_ROLLS}
            disabled={disabled}
            aria-describedby="pack-rare-slots-help"
            onValueChange={(rareSlot) => setSlots({ rareSlot })}
          />
        </Field>
      </div>
      <table className="mt-3 w-full text-left">
        <caption className="sr-only">Odds of each rarity per slot, in percent</caption>
        <thead>
          <tr className="border-b">
            <th scope="col" className="p-1">
              Rarity
            </th>
            <th scope="col" className="p-1">
              In pool
            </th>
            <th scope="col" className="p-1">
              {labels.normal} %
            </th>
            {hasRareSlot && (
              <th scope="col" className="p-1">
                {labels.rareSlot} %
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {KESSEN_PACK_TIERS.map((tier) => (
            <tr key={tier} className="border-b">
              <th scope="row" className="p-1 font-semibold">
                {KESSEN_PACK_TIER_NAMES[tier]}
              </th>
              <td className="p-1 tabular-nums">{poolCounts[tier]}</td>
              {(hasRareSlot ? WEIGHT_COLUMNS : WEIGHT_COLUMNS.slice(0, 1)).map(
                (column) => (
                  <td key={column} className="p-1">
                    <NumberInput
                      aria-label={`${KESSEN_PACK_TIER_NAMES[tier]} odds, ${column === "normal" ? labels.normal : labels.rareSlot}`}
                      className={cn(TOUCH_FIELD, "max-w-28")}
                      value={draft[column][tier]}
                      min={0}
                      max={100}
                      step={0.01}
                      disabled={disabled}
                      onValueChange={(value) => setWeight(column, tier, value)}
                    />
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" className="p-1">
              Total
            </th>
            <td className="p-1 tabular-nums">{pool.length}</td>
            <td
              className={cn(
                "p-1 font-semibold tabular-nums",
                normalTotal !== CACHE_PROBABILITY_TOTAL && "text-destructive",
              )}
            >
              {formatPercent(normalTotal)}
            </td>
            {hasRareSlot && (
              <td
                className={cn(
                  "p-1 font-semibold tabular-nums",
                  rareTotal !== CACHE_PROBABILITY_TOTAL && "text-destructive",
                )}
              >
                {formatPercent(rareTotal)}
              </td>
            )}
          </tr>
        </tfoot>
      </table>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          disabled={disabled || problem !== null}
          onClick={() =>
            onBuild(
              buildKessenPackEffects(
                {
                  name,
                  faction: draft.faction === ALL ? null : draft.faction,
                  slots: draft.slots,
                  normalWeights: weightsOf(draft.normal),
                  rareSlotWeights: weightsOf(draft.rareSlot),
                },
                cards,
              ),
            )
          }
        >
          <Hammer className="mr-2 h-5 w-5" aria-hidden />
          Rebuild contents
        </Button>
        <p
          className={cn(
            "text-sm",
            problem ? "text-destructive" : "text-muted-foreground",
          )}
          role={problem ? "alert" : undefined}
        >
          {problem ??
            "Replaces the pack's Weighted Cache tags; save to keep the new contents."}
        </p>
      </div>
    </section>
  );
}

/** The builder's start: the pool, slots and odds read from the pack's caches. */
const draftOf = (effects: readonly ZodAllTags[], cards: readonly KessenCard[]) => {
  const byId = new Map(cards.map((card) => [card.id, card]));
  const odds = kessenPackOdds(effects, byId);
  const factions = kessenPackFactions(effects, byId).filter(
    (faction) => faction !== "NEUTRAL",
  );
  const single = KESSEN_DECK_FACTIONS.find(
    (faction) => factions.length === 1 && factions[0] === faction,
  );
  const percents = (bp: Record<KessenPackTier, number>) =>
    Object.fromEntries(
      KESSEN_PACK_TIERS.map((tier) => [
        tier,
        (bp[tier] * 100) / CACHE_PROBABILITY_TOTAL,
      ]),
    ) as Record<KessenPackTier, number>;
  return {
    faction: (single ?? ALL) as PoolValue,
    slots: kessenPackSlots(effects),
    normal: percents(odds.normal),
    rareSlot: percents(odds.rareSlot),
  };
};

/** Percent odds as weights of `CACHE_PROBABILITY_TOTAL`. */
const weightsOf = (percents: Record<KessenPackTier, number>) =>
  Object.fromEntries(
    KESSEN_PACK_TIERS.map((tier) => [
      tier,
      Math.round(((percents[tier] || 0) * CACHE_PROBABILITY_TOTAL) / 100),
    ]),
  ) as Record<KessenPackTier, number>;

const totalOf = (percents: Record<KessenPackTier, number>) =>
  KESSEN_PACK_TIERS.reduce((sum, tier) => sum + (weightsOf(percents)[tier] ?? 0), 0);

/** Why the draft cannot be built yet; null when it can. */
const draftProblem = (
  draft: ReturnType<typeof draftOf>,
  normalTotal: number,
  rareTotal: number,
  poolCounts: Record<KessenPackTier, number>,
) => {
  const { normal, rareSlot } = draft.slots;
  if (!Number.isInteger(normal) || normal < 1 || normal > CACHE_MAX_ROLLS)
    return `Normal slots must be 1 to ${CACHE_MAX_ROLLS}.`;
  if (!Number.isInteger(rareSlot) || rareSlot < 0 || rareSlot > CACHE_MAX_ROLLS)
    return `Rare slots must be 0 to ${CACHE_MAX_ROLLS}.`;
  const values = [draft.normal, ...(rareSlot > 0 ? [draft.rareSlot] : [])].flatMap(
    (column) => KESSEN_PACK_TIERS.map((tier) => column[tier]),
  );
  if (values.some((value) => !Number.isFinite(value) || value < 0))
    return "Every odds field needs a number from 0 to 100.";
  if (normalTotal !== CACHE_PROBABILITY_TOTAL)
    return "The normal slots' odds must add up to 100%.";
  if (rareSlot > 0 && rareTotal !== CACHE_PROBABILITY_TOTAL)
    return "The rare slot's odds must add up to 100%.";
  if (
    [draft.normal, ...(rareSlot > 0 ? [draft.rareSlot] : [])]
      .map(weightsOf)
      .some(
        (column) =>
          !KESSEN_PACK_TIERS.some((tier) => column[tier] > 0 && poolCounts[tier] > 0),
      )
  )
    return "Each slot kind needs positive odds for a rarity in its pool.";
  const rareWeights = weightsOf(draft.rareSlot);
  // Pity needs its target tier whenever a lower rarity can be drawn from the rare cache.
  if (
    rareSlot > 0 &&
    (["EPIC", "LEGENDARY"] as const).some(
      (tier) =>
        (rareWeights[tier] <= 0 || poolCounts[tier] === 0) &&
        KESSEN_PACK_TIERS.slice(0, KESSEN_PACK_TIERS.indexOf(tier)).some(
          (lower) => rareWeights[lower] > 0 && poolCounts[lower] > 0,
        ),
    )
  )
    return "Rare slots need Epic and Legendary cards with positive odds for pity guarantees when lower rarities can be drawn.";
  return null;
};

const formatPercent = (weight: number) =>
  `${Number(((weight * 100) / CACHE_PROBABILITY_TOTAL).toFixed(2))}%`;

/** Pool value standing for every faction. */
const ALL = "ALL";
type PoolValue = DeckFaction | typeof ALL;
const POOL_VALUES: readonly PoolValue[] = [ALL, ...KESSEN_DECK_FACTIONS];
const POOL_LABELS = Object.fromEntries([
  [ALL, "Every faction"],
  ...KESSEN_DECK_FACTIONS.map((faction) => [
    faction,
    `${KESSEN_FACTION_NAMES[faction]} and Neutral`,
  ]),
]) as Record<PoolValue, string>;

type WeightColumn = "normal" | "rareSlot";
const WEIGHT_COLUMNS: readonly WeightColumn[] = ["normal", "rareSlot"];
