import { Progress } from "@/components/ui/progress";
import type { CombatResourceBarsVisibility } from "@/hooks/combat";
import { useEffectivePools } from "@/hooks/useEffectivePools";
import type { ReturnedBattle } from "@/libs/combat/types";
import { cn } from "@/libs/shadui";
import { calculatePercent } from "@/utils/math";

export const CombatResourceBars = ({
  battle,
  userId,
  visibility,
}: CombatResourceBarsProps) => {
  const actor = battle.usersState.find((user) => user.userId === userId);
  const pools = useEffectivePools({
    battleUser: actor,
    usersEffects: battle.usersEffects,
  });

  if (!actor || visibility === "off") return null;

  const resources = [
    {
      label: "HP",
      name: "Health",
      current: pools.curHealth,
      maximum: pools.maxHealth,
      color: "bg-red-700/90",
    },
    {
      label: "CP",
      name: "Chakra",
      current: pools.curChakra,
      maximum: pools.maxChakra,
      color: "bg-blue-700/90",
    },
    {
      label: "SP",
      name: "Stamina",
      current: pools.curStamina,
      maximum: pools.maxStamina,
      color: "bg-green-700/90",
    },
  ];

  return (
    // Keep the gauges inside the canvas footprint and let map gestures pass through.
    <div
      className={cn(
        "pointer-events-none absolute inset-x-2 bottom-2 z-10 max-w-md select-none",
        visibility === "mobile-only" && "md:hidden",
      )}
    >
      {actor.isSummon && (
        <div className="mb-1 w-fit max-w-full truncate rounded bg-slate-950/85 px-2 py-0.5 text-white text-xs">
          Controlling {actor.username}
        </div>
      )}
      <div className="grid grid-cols-3 gap-1.5 text-white">
        {resources.map((resource) => {
          const current = Math.max(0, Math.round(resource.current));
          const maximum = Math.max(0, Math.round(resource.maximum));
          const percentage =
            resource.maximum > 0
              ? calculatePercent(resource.current, resource.maximum)
              : 0;

          return (
            <div
              key={resource.label}
              className="relative min-w-0 overflow-hidden rounded-sm border border-white/20 bg-slate-950/90 shadow-sm"
            >
              <Progress
                value={percentage}
                aria-label={`${actor.username}: ${resource.name}`}
                aria-valuenow={current}
                aria-valuemax={Math.max(current, maximum, 1)}
                aria-valuetext={`${current} / ${maximum}`}
                className="h-5 rounded-none bg-transparent"
                indicatorClassName={resource.color}
              />
              <div className="absolute inset-0 flex items-center justify-between gap-1 whitespace-nowrap px-1 text-[10px] tabular-nums leading-none">
                <span className="font-semibold">{resource.label}</span>
                <span>
                  {poolNumberFormat.format(current)}
                  <span className="text-white/70">
                    /{poolNumberFormat.format(maximum)}
                  </span>
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const poolNumberFormat = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

interface CombatResourceBarsProps {
  battle: ReturnedBattle;
  userId: string;
  visibility: CombatResourceBarsVisibility;
}
