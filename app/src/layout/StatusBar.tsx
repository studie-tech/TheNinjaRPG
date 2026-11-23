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
  /** Full resource name revealed by spacious character summaries. */
  resourceName?: string;
  regen?: number;
  lastRegenAt?: Date | null;
  tooltip?: string;
  showText?: boolean;
  /** Slim labeled meter with values available to touch, keyboard and screen-reader users. */
  compact?: boolean;
  /** Open the detailed character readings from a compact HUD meter. */
  onInspect?: () => void;
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
  const { showText, title, current, total, status, compact = false } = props;

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
    // Regeneration and the next-tick countdown change at most once a second.
    const interval = setInterval(updateState, 1000);
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

  const valueLabel = isInBattle
    ? "In battle"
    : current === undefined || total === undefined
      ? "Loading"
      : `${Math.round(state.current)} / ${total}`;

  return (
    <div className="group relative flex-row" data-compact-meter={compact || undefined}>
      {/* Hidden rather than removed in battle: the status flips to and from BATTLE
          mid-session, and removing the line moved everything below the bars. */}
      {showText && !compact && (
        <div className={cn("leading-none", isInBattle && "invisible")}>
          {title} ({total ? `${Math.round(state.current)} / ${total}` : "?? / ??"})
          {state.nextTickSeconds !== undefined && ` (${state.nextTickSeconds}s)`}
        </div>
      )}

      <TooltipProvider delayDuration={50}>
        <Tooltip>
          <TooltipTrigger
            className={compact ? "player-status-meter" : "w-full"}
            onClick={props.onInspect}
            aria-haspopup={props.onInspect ? "dialog" : undefined}
            aria-label={compact ? `${title}: ${valueLabel}` : undefined}
          >
            {compact && (
              <span className="player-status-meter-label">
                <span className="player-status-meter-title">
                  <span className="player-status-meter-short">{title}</span>
                  <span className="player-status-meter-name">
                    {props.resourceName ?? title}
                  </span>
                </span>
                <span className="player-status-meter-value">{valueLabel}</span>
              </span>
            )}
            <div
              className={
                compact
                  ? "player-status-meter-track"
                  : "h-3 w-full border-2 border-black"
              }
            >
              <div
                className={`h-full ${color}`}
                style={{
                  width: `${state.width.toString()}%`,
                }}
              ></div>
            </div>
          </TooltipTrigger>
          {props.tooltip && (
            <TooltipContent>
              {props.tooltip}
              {compact && <> · {valueLabel}</>}
            </TooltipContent>
          )}
        </Tooltip>
      </TooltipProvider>
    </div>
  );
};

export default StatusBar;
