import type React from "react";
import { useEffect, useState } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { REGEN_SECONDS } from "@/drizzle/constants";
import type { UserStatus } from "@/drizzle/schema";
import { secondsPassed } from "@/utils/time";

interface StatusBarProps {
  title: string;
  regen?: number;
  lastRegenAt?: Date | null;
  tooltip?: string;
  showText?: boolean;
  status?: UserStatus;
  timeDiff?: number;
  color: "bg-red-500" | "bg-blue-500" | "bg-green-500" | "bg-yellow-500";
  current?: number;
  total?: number;
}

/**
 * Calculate current state of the bar based on regen
 */
export const calcCurrent = (
  start?: number,
  total?: number,
  status?: UserStatus,
  regen?: number,
  regenAt?: Date | null,
  timeDiff?: number,
) => {
  const end = total ?? 100;
  let current = Math.max(start ?? 0, 0);
  if (status === "BATTLE" || start === undefined) {
    current = end;
  } else if (
    regen !== undefined &&
    status !== undefined &&
    regenAt &&
    ["AWAKE", "ASLEEP", "TRAVEL"].includes(status)
  ) {
    const minutes = secondsPassed(regenAt, timeDiff, false) / REGEN_SECONDS;
    if (regen >= 0) {
      current = Math.min(end, start + regen * minutes);
    } else {
      current = Math.max(0, start + regen * minutes);
    }
  }
  const width = (current / end) * 100;

  return { current, width };
};

const StatusBar: React.FC<StatusBarProps> = (props) => {
  // Destructure props
  const { regen, lastRegenAt, timeDiff } = props;
  const { showText, title, current, total, status } = props;

  // Is the user in battle?
  const isInBattle = props.status === "BATTLE";
  const isAwake = props.status === "AWAKE";

  // Calculate initial state
  const [state, setState] = useState(() =>
    calcCurrent(current, total, status, regen, lastRegenAt, timeDiff),
  );

  // Color for the bars
  const color =
    isInBattle || current === undefined || total === undefined
      ? `bg-linear-to-r from-slate-500 to-slate-400 background-animate opacity-20`
      : props.color;

  // Updating the bars based on regen
  useEffect(() => {
    const updateState = () => {
      if (regen !== undefined && current !== undefined && total !== undefined) {
        // Use functional setState to avoid reading state in effect body
        // This prevents React Compiler from adding state as a dependency
        setState((prevState) => {
          if (
            (prevState.current < total || current < total) &&
            (prevState.current >= 0 || current >= 0)
          ) {
            const newState = calcCurrent(
              current,
              total,
              status,
              regen,
              lastRegenAt,
              timeDiff,
            );
            // Only update if values actually changed to prevent unnecessary re-renders
            if (
              prevState.current !== newState.current ||
              prevState.width !== newState.width
            ) {
              return newState;
            }
          }
          return prevState;
        });
      }
    };
    // Call immediately on mount/dependency change to avoid visual lag
    updateState();
    const interval = setInterval(updateState, 250);
    return () => {
      clearInterval(interval);
    };
  }, [isAwake, regen, lastRegenAt, current, total, status, timeDiff]);

  return (
    <div className="group relative flex-row">
      {showText && !isInBattle && (
        <div className="leading-none">
          {title} ({total ? `${Math.round(state.current)} / ${total}` : "?? / ??"})
        </div>
      )}

      <TooltipProvider delayDuration={50}>
        <Tooltip>
          <TooltipTrigger className="w-full">
            <div className={`h-3 w-full border-2 border-black`}>
              <div
                className={`h-full w-3/6 ${color}`}
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
