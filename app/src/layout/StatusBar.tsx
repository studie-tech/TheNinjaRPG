import type React from "react";
import { useEffect, useState } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { UserStatus } from "@/drizzle/schema";
import { calcCurrent } from "@/libs/regeneration";
import { cn } from "@/libs/shadui";
import type { RegenerationPeriod, TimedBuff } from "@/libs/timedBuffs";

export interface StatusBarProps {
  title: string;
  regen?: number;
  lastRegenAt?: Date | null;
  tooltip?: string;
  showText?: boolean;
  status?: UserStatus;
  timeDiff?: number;
  /** Combat Energy uses continuous recovery, including captured timed bonuses. */
  combatRegenerationPeriods?: readonly RegenerationPeriod[];
  /** Discrete recovery uses the base regen rate and retains expired bonus history. */
  timedBuffs?: readonly TimedBuff[];
  color:
    | "bg-red-500"
    | "bg-blue-500"
    | "bg-green-500"
    | "bg-yellow-500"
    | "bg-violet-500";
  current?: number;
  total?: number;
}

const StatusBar: React.FC<StatusBarProps> = (props) => {
  // Destructure props
  const { regen, lastRegenAt, timeDiff, combatRegenerationPeriods, timedBuffs } = props;
  const { showText, title, current, total, status } = props;

  // Is the user in battle?
  const isInBattle = props.status === "BATTLE";

  // Calculate initial state
  const [state, setState] = useState(() =>
    calcCurrent(
      current,
      total,
      status,
      regen,
      lastRegenAt,
      timeDiff,
      combatRegenerationPeriods,
      timedBuffs,
    ),
  );

  // Color for the bars
  const color =
    isInBattle || current === undefined || total === undefined
      ? // An opacity pulse runs on the compositor; a moving gradient repaints every frame.
        `bg-linear-to-r from-slate-500 to-slate-400 animate-placeholder-pulse opacity-20`
      : props.color;

  // Updating the bars based on regen
  useEffect(() => {
    const updateState = () => {
      if (regen !== undefined && current !== undefined && total !== undefined) {
        // Use functional setState to avoid reading state in effect body
        // This prevents React Compiler from adding state as a dependency
        setState((prevState) => {
          const newState = calcCurrent(
            current,
            total,
            status,
            regen,
            lastRegenAt,
            timeDiff,
            combatRegenerationPeriods,
            timedBuffs,
          );
          // Capacity can change while the bar is full; suppress only unchanged values.
          if (
            prevState.current !== newState.current ||
            prevState.width !== newState.width ||
            prevState.nextTickSeconds !== newState.nextTickSeconds
          ) {
            return newState;
          }
          return prevState;
        });
      }
    };
    // Call immediately to avoid visual lag when dependencies change
    updateState();
    // Then update at regular intervals
    const interval = setInterval(updateState, 250);
    return () => {
      clearInterval(interval);
    };
  }, [
    regen,
    lastRegenAt,
    current,
    total,
    status,
    timeDiff,
    combatRegenerationPeriods,
    timedBuffs,
  ]);

  return (
    <div className="group relative flex-row">
      {/* Hidden rather than removed in battle: the status flips to and from BATTLE
          mid-session, and removing the line moved everything below the bars. */}
      {showText && (
        <div className={cn("leading-none", isInBattle && "invisible")}>
          {title} ({total ? `${Math.round(state.current)} / ${total}` : "?? / ??"})
          {state.nextTickSeconds !== undefined && ` (${state.nextTickSeconds}s)`}
        </div>
      )}

      <TooltipProvider delayDuration={50}>
        <Tooltip>
          <TooltipTrigger className="w-full">
            <div className={`h-3 w-full border-2 border-black`}>
              <div
                className={`h-full ${color}`}
                style={{
                  width: `${state.width.toString()}%`,
                }}
              ></div>
            </div>
          </TooltipTrigger>
          {props.tooltip && <TooltipContent>{props.tooltip}</TooltipContent>}
        </Tooltip>
      </TooltipProvider>
    </div>
  );
};

export default StatusBar;
