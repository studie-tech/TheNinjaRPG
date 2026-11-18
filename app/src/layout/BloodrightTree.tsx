"use client";

import { MAX_BLOODRIGHT_TIERS } from "@/drizzle/constants";
import type { SkillTree } from "@/drizzle/schema";
import { SkillCard } from "@/layout/SkillTreeFolderModal";
import { POTENCY_TAG_LABELS } from "@/libs/combat/potency";
import type { ZodAllTags } from "@/validators/combat";

/** Card geometry: each card sits inset in its cell; edges attach to card edges. */
const CARD_WIDTH = 168;
const CARD_HEIGHT = 136;
const CARD_INSET = 12;
const CELL_SIZE = CARD_WIDTH + 2 * CARD_INSET;
/** Extra card height for the stat list's divider and for each stat row. */
const STATS_DIVIDER_HEIGHT = 12;
const STAT_ROW_HEIGHT = 18;
/** Space above each row's cards for its tier heading. */
const TIER_LABEL_HEIGHT = 32;
/** Vertical clearance a skip-tier edge keeps from the cards it leaves and enters. */
const EDGE_CLEARANCE = 12;

export const BloodrightTree = ({ tiers, purchasedIds, silver, onSelect }: Props) => {
  const levels = [...new Set(tiers.map((tier) => tier.tier))].sort((a, b) => a - b);
  const rows = orderTiersByPrerequisite(
    levels.map((level) => tiers.filter((tier) => tier.tier === level)),
  );
  const stats = new Map(
    tiers.map((tier) => [tier.id, getBloodrightStats(tier.effects)]),
  );
  const maxStats = Math.max(0, ...[...stats.values()].map((rows) => rows.length));
  const cardHeight =
    CARD_HEIGHT + (maxStats ? STATS_DIVIDER_HEIGHT + maxStats * STAT_ROW_HEIGHT : 0);
  const rowHeight = cardHeight + TIER_LABEL_HEIGHT + 2 * CARD_INSET;
  const width = Math.max(1, ...rows.map((row) => row.length)) * CELL_SIZE;
  const height = rows.length * rowHeight;
  const nodes = rows.flatMap((row, rowIndex) =>
    row.map((skill, column) => ({
      skill,
      x: (width - row.length * CELL_SIZE) / 2 + column * CELL_SIZE + CARD_INSET,
      y: rowIndex * rowHeight + TIER_LABEL_HEIGHT,
    })),
  );

  return (
    <section
      className="overflow-x-auto rounded-lg border bg-card p-3"
      aria-label="Bloodright skill tree"
    >
      <p className="mb-3 text-muted-foreground text-sm">
        Select a node to view its effects and unlock or refund it. Lines show required
        tiers.
      </p>
      <div className="relative mx-auto" style={{ width, height }}>
        <svg
          className="pointer-events-none absolute inset-0"
          width={width}
          height={height}
          aria-hidden="true"
        >
          {nodes.flatMap((node) =>
            node.skill.requiredSkillIds.map((id) => {
              const parent = nodes.find((entry) => entry.skill.id === id);
              if (!parent) return null;
              const fromX = parent.x + CARD_WIDTH / 2;
              const fromY = parent.y + cardHeight;
              const toX = node.x + CARD_WIDTH / 2;
              const toY = node.y;
              const middle = (fromY + toY) / 2;
              // Skip-tier prerequisites travel around the cards so they cannot
              // appear to connect to an unrelated intermediate tier.
              const path =
                node.y - parent.y > rowHeight
                  ? `M ${fromX} ${fromY} V ${fromY + EDGE_CLEARANCE} H ${width - 2} V ${toY - EDGE_CLEARANCE} H ${toX} V ${toY}`
                  : `M ${fromX} ${fromY} C ${fromX} ${middle}, ${toX} ${middle}, ${toX} ${toY}`;
              return (
                <path
                  key={`${id}-${node.skill.id}`}
                  d={path}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  className={
                    purchasedIds.includes(id)
                      ? "text-green-500"
                      : "text-muted-foreground"
                  }
                />
              );
            }),
          )}
        </svg>
        {levels.map((level, index) => (
          <h4
            key={level}
            className="absolute left-0 font-semibold text-muted-foreground text-sm"
            style={{ top: index * rowHeight }}
          >
            Tier {level}
          </h4>
        ))}
        {nodes.map(({ skill, x, y }) => {
          const isOwned = purchasedIds.includes(skill.id);
          const hasPrereqs = skill.requiredSkillIds.every((id) =>
            purchasedIds.includes(id),
          );
          const hasPoints =
            silver >= skill.seichiSilverCost &&
            purchasedIds.length < MAX_BLOODRIGHT_TIERS;
          return (
            <div
              key={skill.id}
              className="absolute flex"
              style={{ left: x, top: y, width: CARD_WIDTH, height: cardHeight }}
            >
              <SkillCard
                skill={skill}
                status={{ isOwned, isActivated: isOwned, hasPrereqs, hasPoints }}
                costLabel={`${skill.seichiSilverCost.toLocaleString()} Silver`}
                stats={stats.get(skill.id)}
                onClick={() => onSelect(skill.id)}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
};

/**
 * Orders each tier under its prerequisites so connecting lines run straight down
 * instead of crossing. A node sorts by the mean centred column of its prerequisites
 * in earlier tiers; nodes without one keep their given order after the rest.
 */
export const orderTiersByPrerequisite = <
  T extends { id: string; requiredSkillIds: string[] },
>(
  rows: T[][],
) => {
  const columns = new Map<string, number>();
  return rows.map((row) => {
    const ordered = row
      .map((skill) => {
        const placed = skill.requiredSkillIds.flatMap((id) => columns.get(id) ?? []);
        const key = placed.length
          ? placed.reduce((sum, column) => sum + column, 0) / placed.length
          : Number.POSITIVE_INFINITY;
        return { skill, key };
      })
      .sort((a, b) => (a.key === b.key ? 0 : a.key - b.key))
      .map(({ skill }) => skill);
    ordered.forEach((skill, column) => {
      columns.set(skill.id, column - (ordered.length - 1) / 2);
    });
    return ordered;
  });
};

/** Summarise a tier's potency effects as short stat rows, e.g. Afterburn +2. */
export const getBloodrightStats = (effects: ZodAllTags[]) =>
  effects.flatMap((effect) => {
    if (effect.type !== "increasepotency" && effect.type !== "decreasepotency")
      return [];
    const sign = effect.type === "increasepotency" ? "+" : "-";
    const unit = effect.calculation === "percentage" ? "%" : "";
    return [
      {
        label: POTENCY_TAG_LABELS[effect.affectedTag],
        value: `${sign}${Number(effect.power.toFixed(2))}${unit}`,
      },
    ];
  });

type Props = {
  tiers: SkillTree[];
  purchasedIds: string[];
  silver: number;
  onSelect: (id: string) => void;
};
