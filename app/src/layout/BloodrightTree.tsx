"use client";

import { MAX_BLOODRIGHT_TIERS } from "@/drizzle/constants";
import type { SkillTree } from "@/drizzle/schema";
import { SkillCard } from "@/layout/SkillTreeFolderModal";

/** Card geometry: each card sits inset in a square cell; edges attach to card edges. */
const CARD_WIDTH = 168;
const CARD_HEIGHT = 136;
const CARD_INSET = 12;
const CELL_SIZE = CARD_WIDTH + 2 * CARD_INSET;
/** Space above each row's cards for its tier heading. */
const TIER_LABEL_HEIGHT = 32;
/** Vertical clearance a skip-tier edge keeps from the cards it leaves and enters. */
const EDGE_CLEARANCE = 12;

export const BloodrightTree = ({ tiers, purchasedIds, silver, onSelect }: Props) => {
  const levels = [...new Set(tiers.map((tier) => tier.tier))].sort((a, b) => a - b);
  const rows = levels.map((level) => tiers.filter((tier) => tier.tier === level));
  const width = Math.max(1, ...rows.map((row) => row.length)) * CELL_SIZE;
  const height = rows.length * CELL_SIZE;
  const nodes = rows.flatMap((row, rowIndex) =>
    row.map((skill, column) => ({
      skill,
      x: (width - row.length * CELL_SIZE) / 2 + column * CELL_SIZE + CARD_INSET,
      y: rowIndex * CELL_SIZE + TIER_LABEL_HEIGHT,
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
              const fromY = parent.y + CARD_HEIGHT;
              const toX = node.x + CARD_WIDTH / 2;
              const toY = node.y;
              const middle = (fromY + toY) / 2;
              // Skip-tier prerequisites travel around the cards so they cannot
              // appear to connect to an unrelated intermediate tier.
              const path =
                node.y - parent.y > CELL_SIZE
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
            style={{ top: index * CELL_SIZE }}
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
              style={{ left: x, top: y, width: CARD_WIDTH, height: CARD_HEIGHT }}
            >
              <SkillCard
                skill={skill}
                status={{ isOwned, isActivated: isOwned, hasPrereqs, hasPoints }}
                costLabel={`${skill.seichiSilverCost.toLocaleString()} Silver`}
                onClick={() => onSelect(skill.id)}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
};

type Props = {
  tiers: SkillTree[];
  purchasedIds: string[];
  silver: number;
  onSelect: (id: string) => void;
};
