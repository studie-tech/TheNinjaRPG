"use client";

import { type ReactNode, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MultiSelect } from "@/components/ui/multi-select";
import { NumberInput } from "@/components/ui/number-input";
import {
  CACHE_MAX_BUNDLE_ITEMS,
  CACHE_MAX_ENTRIES,
  CACHE_MAX_QUANTITY,
  CACHE_MAX_ROLLS,
  CACHE_MAX_TIERS,
  CACHE_PROBABILITY_TOTAL,
} from "@/drizzle/constants";
import {
  type CacheIssue,
  cacheItemChance,
  cacheItemIds,
  getWeightedCacheIssues,
} from "@/libs/weightedCache";
import type { WeightedCache } from "@/validators/weightedCache";

/**
 * Edit the parent-owned cache draft without discarding incomplete or inactive settings.
 * Schema and catalog errors stay rendered inside collapsible sections for Save to reveal.
 */
export const WeightedCacheEditor = ({
  cache,
  onChange,
  items,
  isLoading,
  isError,
  onRetry,
  isActive = true,
  disabled = false,
}: {
  cache: WeightedCache;
  onChange: (cache: WeightedCache) => void;
  items: { id: string; name: string; isRestrictedCacheReward?: boolean }[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  isActive?: boolean;
  disabled?: boolean;
}) => {
  const editor = useRef<HTMLElement>(null);
  const { issues, isSchemaValid } = getWeightedCacheIssues(cache, items, {
    isActive,
    catalogReady: !isLoading && !isError,
  });
  const itemById = new Map(items.map((item) => [item.id, item]));
  const renderErrors = (errors: CacheIssue[]) =>
    errors.map((issue, index) => (
      <p
        key={`error-${index}`}
        role="alert"
        tabIndex={-1}
        data-weighted-cache-error=""
        className="text-destructive text-sm"
      >
        {cacheIssueMessage(cache, issue)}
      </p>
    ));
  const changeTier = (index: number, tier: WeightedCache["tiers"][number]) =>
    onChange({
      ...cache,
      tiers: cache.tiers.map((value, i) => (i === index ? tier : value)),
    });
  const moveTier = (index: number, direction: number) => {
    const tiers = [...cache.tiers];
    const other = index + direction;
    if (tiers[index] && tiers[other])
      [tiers[index], tiers[other]] = [tiers[other], tiers[index]];
    onChange({ ...cache, tiers });
  };
  return (
    <section
      ref={editor}
      aria-label="Weighted Cache editor"
      className="my-3 min-w-0 space-y-4 rounded-lg border p-3"
    >
      <h3 className="font-bold">Weighted Cache</h3>
      {issues.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-destructive text-sm">
          <p>
            Fix {issues.length} cache issue{issues.length === 1 ? "" : "s"} before
            saving.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => focusWeightedCacheError(editor.current ?? document)}
          >
            Review first issue
          </Button>
        </div>
      )}
      <Label className="block space-y-1">
        <span>Cache display name</span>
        <Input
          value={cache.displayName}
          maxLength={100}
          onChange={(event) => onChange({ ...cache, displayName: event.target.value })}
        />
      </Label>
      {renderErrors(
        issues.filter((issue) => !["rolls", "tiers"].includes(String(issue.path[0]))),
      )}
      <p className="text-muted-foreground text-sm">
        Each opening selects a roll count, then one tier and one equally likely entry
        per roll. Every item in that entry is granted. Standard reward settings are
        preserved while inactive. Reputation and bloodline rewards are not allowed.
      </p>
      <fieldset className="space-y-2">
        <legend className="font-semibold">Reward rolls</legend>
        <ProbabilityTotal label="Roll" values={cache.rolls} />
        {renderErrors(issues.filter((issue) => issue.path[0] === "rolls"))}
        {cache.rolls.map((roll, index) => (
          <div key={`roll-${index}`} className="flex flex-wrap items-end gap-2">
            <Label className="min-w-24 flex-1">
              Roll count
              <NumberInput
                min={1}
                max={CACHE_MAX_ROLLS}
                value={roll.count}
                onValueChange={(count) =>
                  onChange({
                    ...cache,
                    rolls: cache.rolls.map((value, i) =>
                      i === index ? { ...value, count } : value,
                    ),
                  })
                }
              />
            </Label>
            <ProbabilityInput
              value={roll.probability}
              onChange={(probability) =>
                onChange({
                  ...cache,
                  rolls: cache.rolls.map((value, i) =>
                    i === index ? { ...value, probability } : value,
                  ),
                })
              }
            />
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                onChange({ ...cache, rolls: cache.rolls.filter((_, i) => i !== index) })
              }
            >
              Remove roll
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          disabled={cache.rolls.length >= CACHE_MAX_ROLLS}
          onClick={() =>
            onChange({
              ...cache,
              rolls: [...cache.rolls, { count: 1, probability: 0 }],
            })
          }
        >
          Add roll outcome
        </Button>
      </fieldset>
      <fieldset className="min-w-0 space-y-3">
        <legend className="font-semibold">Reward tiers</legend>
        <ProbabilityTotal label="Tier" values={cache.tiers} />
        {renderErrors(
          issues.filter(
            (issue) => issue.path[0] === "tiers" && typeof issue.path[1] !== "number",
          ),
        )}
        {cache.tiers.map((tier, tierIndex) => {
          const tierIssues = issues.filter(
            (issue) => issue.path[0] === "tiers" && issue.path[1] === tierIndex,
          );
          return (
            <CacheSection
              key={`tier-${tierIndex}`}
              title={`${tier.name || `Tier ${tierIndex + 1}`} · ${tier.probability / 100}% · ${tier.entries.length} ${tier.entries.length === 1 ? "entry" : "entries"}`}
              initiallyOpen={tier.entries.length === 0 || tierIssues.length > 0}
              hasErrors={tierIssues.length > 0}
            >
              {renderErrors(
                tierIssues.filter((issue) => typeof issue.path[3] !== "number"),
              )}
              <div className="flex flex-wrap items-end gap-2">
                <Label className="min-w-32 flex-1">
                  Tier name
                  <Input
                    value={tier.name}
                    maxLength={100}
                    onChange={(event) =>
                      changeTier(tierIndex, { ...tier, name: event.target.value })
                    }
                  />
                </Label>
                <ProbabilityInput
                  value={tier.probability}
                  onChange={(probability) =>
                    changeTier(tierIndex, { ...tier, probability })
                  }
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={tierIndex === 0}
                  onClick={() => moveTier(tierIndex, -1)}
                >
                  Move up
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={tierIndex === cache.tiers.length - 1}
                  onClick={() => moveTier(tierIndex, 1)}
                >
                  Move down
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    onChange({
                      ...cache,
                      tiers: cache.tiers.filter((_, i) => i !== tierIndex),
                    })
                  }
                >
                  Remove tier
                </Button>
              </div>
              {tier.probability === 0 && (
                <p className="text-muted-foreground text-sm">
                  Draft tier: never selected while its probability is 0%.
                </p>
              )}
              {tier.entries.map((entry, entryIndex) => {
                const entryIssues = tierIssues.filter(
                  (issue) =>
                    issue.path[2] === "entries" && issue.path[3] === entryIndex,
                );
                const changeEntry = (next: typeof entry) =>
                  changeTier(tierIndex, {
                    ...tier,
                    entries: tier.entries.map((value, i) =>
                      i === entryIndex ? next : value,
                    ),
                  });
                return (
                  <CacheSection
                    key={`entry-${entryIndex}`}
                    title={`Entry ${entryIndex + 1} · ${(100 / tier.entries.length).toFixed(2)}% within tier · ${entry.items.length} item${entry.items.length === 1 ? "" : "s"}`}
                    initiallyOpen={entry.items.length === 0 || entryIssues.length > 0}
                    hasErrors={entryIssues.length > 0}
                  >
                    {renderErrors(entryIssues)}
                    <MultiSelect
                      options={items
                        .filter(
                          (item) =>
                            !item.isRestrictedCacheReward ||
                            entry.items.some((reward) => reward.itemId === item.id),
                        )
                        .map((item) => ({
                          value: item.id,
                          label: item.name,
                        }))}
                      selected={entry.items.map((item) => item.itemId)}
                      placeholder="Search reward items (including hidden items)"
                      disabled={disabled || isLoading || isError}
                      onChange={(update) => {
                        const ids =
                          typeof update === "function"
                            ? update(entry.items.map((item) => item.itemId))
                            : update;
                        changeEntry({
                          items: ids.slice(0, CACHE_MAX_BUNDLE_ITEMS).map(
                            (itemId) =>
                              entry.items.find((item) => item.itemId === itemId) ?? {
                                itemId,
                                quantity: 1,
                              },
                          ),
                        });
                      }}
                    />
                    {entry.items.map((reward, itemIndex) => (
                      <Label
                        key={reward.itemId}
                        className="flex flex-wrap items-center gap-2 text-sm"
                      >
                        <span className="min-w-0 flex-1 break-words">
                          {itemById.get(reward.itemId)?.name ??
                            `Missing item: ${reward.itemId}`}{" "}
                          quantity
                        </span>
                        <NumberInput
                          className="w-24"
                          min={1}
                          max={CACHE_MAX_QUANTITY}
                          value={reward.quantity}
                          onValueChange={(quantity) =>
                            changeEntry({
                              items: entry.items.map((value, i) =>
                                i === itemIndex ? { ...value, quantity } : value,
                              ),
                            })
                          }
                        />
                      </Label>
                    ))}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        changeTier(tierIndex, {
                          ...tier,
                          entries: tier.entries.filter((_, i) => i !== entryIndex),
                        })
                      }
                    >
                      Remove entry
                    </Button>
                  </CacheSection>
                );
              })}
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={tier.entries.length >= CACHE_MAX_ENTRIES}
                onClick={() =>
                  changeTier(tierIndex, {
                    ...tier,
                    entries: [...tier.entries, { items: [] }],
                  })
                }
              >
                Add reward entry
              </Button>
            </CacheSection>
          );
        })}
        <Button
          type="button"
          variant="outline"
          disabled={cache.tiers.length >= CACHE_MAX_TIERS}
          onClick={() =>
            onChange({
              ...cache,
              tiers: [
                ...cache.tiers,
                { name: "New tier", probability: 0, entries: [] },
              ],
            })
          }
        >
          Add tier
        </Button>
      </fieldset>
      {isLoading && <p>Loading item catalog…</p>}
      {isError && (
        <p role="alert">
          Could not load the item catalog.{" "}
          <Button type="button" variant="outline" onClick={onRetry}>
            Retry
          </Button>
        </p>
      )}
      {isSchemaValid && (
        <div className="space-y-1 text-sm">
          <h4 className="font-semibold">Reward summary</h4>
          <p>
            {cache.rolls
              .map(
                (roll) =>
                  `${roll.count} roll${roll.count === 1 ? "" : "s"}: ${roll.probability / 100}%`,
              )
              .join("; ")}
          </p>
          {cache.tiers.map((tier, index) => (
            <p key={`summary-${index}`}>
              {tier.name}: {tier.probability / 100}% per roll ·{" "}
              {tier.entries
                .map((entry) =>
                  entry.items
                    .map(
                      (item) =>
                        `${item.quantity} × ${itemById.get(item.itemId)?.name ?? item.itemId}`,
                    )
                    .join(" + "),
                )
                .join(" or ") || "No entries"}
            </p>
          ))}
          {cacheItemIds(cache).map((id) => (
            <p key={id}>
              {itemById.get(id)?.name ?? id}: {cacheItemChance(cache, id).toFixed(2)}%
              chance per opening
            </p>
          ))}
        </div>
      )}
      <p className="text-muted-foreground text-xs">
        Probabilities support 0.01% precision. Up to {CACHE_MAX_ROLLS} rolls,{" "}
        {CACHE_MAX_TIERS} tiers, {CACHE_MAX_ENTRIES} entries per tier,{" "}
        {CACHE_MAX_BUNDLE_ITEMS} items per bundle, and {CACHE_MAX_QUANTITY} of each
        item.
      </p>
    </section>
  );
};

/** Collapse visual detail while keeping draft controls and validation errors mounted. */
const CacheSection = ({
  title,
  initiallyOpen,
  hasErrors,
  children,
}: {
  title: string;
  initiallyOpen: boolean;
  hasErrors: boolean;
  children: ReactNode;
}) => {
  const [isOpen, setIsOpen] = useState(initiallyOpen);
  return (
    <details
      open={isOpen}
      onToggle={(event) => setIsOpen(event.currentTarget.open)}
      className="min-w-0 rounded border p-2"
    >
      <summary className="cursor-pointer break-words font-semibold text-sm">
        {title}
        {hasErrors && <span className="text-destructive"> · Needs attention</span>}
      </summary>
      <div className="mt-3 space-y-3">{children}</div>
    </details>
  );
};

/** Convert percentages to basis points while preserving invalid precision for validation. */
const ProbabilityInput = ({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) => (
  <Label className="min-w-28 flex-1">
    Probability (%)
    <NumberInput
      min={0}
      max={100}
      step={0.01}
      value={value / 100}
      onValueChange={(percent) =>
        onChange(Math.round(percent * 100_000_000) / 1_000_000)
      }
    />
  </Label>
);

/** Show whether a roll or tier distribution fills the complete probability interval. */
const ProbabilityTotal = ({
  label,
  values,
}: {
  label: string;
  values: { probability: number }[];
}) => {
  const total = values.reduce((sum, value) => sum + value.probability, 0);
  return (
    <p
      className={
        total === CACHE_PROBABILITY_TOTAL ? "text-sm" : "text-destructive text-sm"
      }
    >
      {label} probability total: {total / 100}% / 100%
    </p>
  );
};

/** Cache fields share the parent draft without registered inputs, so reveal their errors explicitly. */
export const focusWeightedCacheError = (container: ParentNode = document) => {
  const error = container.querySelector<HTMLElement>("[data-weighted-cache-error]");
  if (!error) return;
  let section = error.closest("details");
  while (section) {
    section.open = true;
    section = section.parentElement?.closest("details") ?? null;
  }
  error.focus();
  error.scrollIntoView({ behavior: "smooth", block: "center" });
  return error.textContent;
};

/** Turn schema paths into named tier/entry locations and actionable numeric feedback. */
const cacheIssueMessage = (cache: WeightedCache, issue: CacheIssue) => {
  const [field, index, , entryIndex, , itemIndex] = issue.path;
  const location =
    field === "tiers"
      ? typeof index === "number"
        ? [
            cache.tiers[index]?.name || `Tier ${index + 1}`,
            typeof entryIndex === "number" ? `Entry ${entryIndex + 1}` : null,
            typeof itemIndex === "number" ? `Item ${itemIndex + 1}` : null,
          ]
            .filter(Boolean)
            .join(" · ")
        : "Reward tiers"
      : field === "rolls"
        ? typeof index === "number"
          ? `Roll outcome ${index + 1}`
          : "Reward rolls"
        : field === "displayName"
          ? "Cache display name"
          : "Weighted Cache";
  const message =
    "code" in issue &&
    issue.code === "invalid_type" &&
    "expected" in issue &&
    issue.expected === "number"
      ? "Enter a valid number"
      : issue.message;
  return `${location}: ${message}`;
};
