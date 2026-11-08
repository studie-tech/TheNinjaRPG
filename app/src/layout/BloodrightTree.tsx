"use client";

import { MAX_BLOODRIGHT_TIERS } from "@/drizzle/constants";
import type { SkillTree } from "@/drizzle/schema";
import { SkillCard } from "@/layout/SkillTreeFolderModal";

export const BloodrightTree = ({ tiers, purchasedIds, silver, onSelect }: Props) => {
  const levels = [...new Set(tiers.map((tier) => tier.tier))].sort((a, b) => a - b);
  const rows = levels.map((level) => tiers.filter((tier) => tier.tier === level));
  const width = Math.max(1, ...rows.map((row) => row.length)) * 192;
  const height = rows.length * 192;
  const nodes = rows.flatMap((row, rowIndex) =>
    row.map((skill, column) => ({
      skill,
      x: (width - row.length * 192) / 2 + column * 192 + 12,
      y: rowIndex * 192 + 32,
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
              const fromX = parent.x + 84;
              const fromY = parent.y + 136;
              const toX = node.x + 84;
              const toY = node.y;
              const middle = (fromY + toY) / 2;
              // Skip-tier prerequisites travel around the cards so they cannot
              // appear to connect to an unrelated intermediate tier.
              const path =
                node.y - parent.y > 192
                  ? `M ${fromX} ${fromY} V ${fromY + 12} H ${width - 2} V ${toY - 12} H ${toX} V ${toY}`
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
            style={{ top: index * 192 }}
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
              className="absolute flex h-[136px] w-[168px]"
              style={{ left: x, top: y }}
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
