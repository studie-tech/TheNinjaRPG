import { useEffect, useMemo, useState } from "react";
import { Progress } from "@/components/ui/progress";
import { availableUserActions, calcActiveUser } from "@/libs/combat/actions";
import type { CombatAction, ReturnedBattle } from "@/libs/combat/types";
import { calcApReduction } from "@/libs/combat/util";
import { useUserData } from "@/utils/UserContext";
import Loader from "./Loader";

interface ActionTimerProps {
  action?: CombatAction | undefined;
  user: { userId: string | undefined; actionPoints: number };
  battle: ReturnedBattle;
  isPending: boolean;
  options?: React.ReactNode;
}

const ActionTimer: React.FC<ActionTimerProps> = (props) => {
  // Destructure props
  const { action, user, battle, isPending } = props;

  // Data from the DB
  const { timeDiff } = useUserData();

  // State
  const [state, setState] = useState<{
    label: string;
    canAct: boolean;
    waiting: boolean;
  }>({
    label: "",
    canAct: false,
    waiting: false,
  });

  // Derived values
  const stunReduction = calcApReduction(battle, user.userId);
  const cost = action?.actionCostPerc ?? 0;
  const actionNow = user.actionPoints - stunReduction;
  const actionAfter = actionNow - cost;
  const clampedActionNow = Math.max(0, Math.min(100, actionNow));
  const clampedActionAfter = Math.max(0, Math.min(100, actionAfter));
  const isProjectedNegative = actionAfter < 0;
  const spentStart = Math.max(0, Math.min(clampedActionAfter, clampedActionNow));
  const spentWidth = Math.max(0, clampedActionNow - Math.max(0, clampedActionAfter));

  // Precompute actions for this user, recompute only when battle version changes
  const precomputedActions = useMemo(() => {
    return availableUserActions(battle, user.userId);
  }, [battle?.version, user.userId]);

  // Active updating of this component
  useEffect(() => {
    const interval = setInterval(() => {
      // If not in focus, nothing
      if (!document.hasFocus() && process.env.NODE_ENV !== "development") {
        setState({ label: `Not in Focus`, canAct: false, waiting: false });
        return;
      }
      // Set label
      const {
        actor,
        mseconds,
        secondsLeft: left,
      } = calcActiveUser(battle, user.userId, timeDiff, {
        precomputedUserId: user.userId,
        precomputedActions,
      });
      // Is it the user in question
      const canAct = actor.userId === user.userId;
      const waiting = user.userId !== actor.userId;
      // Update state
      if (mseconds >= 0) {
        const inform = !waiting ? "You" : `Opponent`;
        const info = left > 0 ? `${inform}: ${left.toFixed(1)}s` : "Finished!";
        setState({ label: info, canAct, waiting });
      } else {
        setState({ label: `Lobby`, canAct, waiting });
      }
      // Set action points
    }, 100);
    return () => clearInterval(interval);
  }, [isPending, battle, user, timeDiff, precomputedActions]);

  return (
    <div className="grow pb-1">
      <div className="relative w-full overflow-hidden rounded-lg border bg-slate-700/70 shadow-lg backdrop-blur-sm">
        <div className="flex flex-row">
          {/* Round & action bar */}
          <div className="flex grow flex-col px-4 py-1">
            <div className="flex flex-wrap items-center gap-3 font-semibold text-[11px] text-slate-200 uppercase tracking-wide">
              <div className="flex w-full items-center gap-3 whitespace-nowrap">
                <span>Round {battle.round}</span>
                <div className="grow"></div>
                <div
                  className={`flex items-center gap-2 rounded-full px-3 pt-1 text-[11px] ${state.waiting ? "bg-amber-500/10 text-amber-200" : "bg-emerald-500/10 text-emerald-200"}`}
                >
                  <span
                    className={`h-2 w-2 rounded-full ${state.waiting ? "bg-amber-300" : "bg-emerald-300"}`}
                  />
                  <span className="font-semibold">{state.label || "..."}</span>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="relative min-w-0 flex-1">
                <Progress
                  value={clampedActionNow}
                  className={`h-6 rounded-full border border-slate-700/60 bg-slate-900/60 shadow-inner ring-1 ring-black/10 ${state.canAct ? "" : "opacity-60"}`}
                  indicatorClassName={
                    state.canAct
                      ? "bg-gradient-to-r from-emerald-400/80 via-emerald-500/90 to-emerald-600/80"
                      : "bg-gradient-to-r from-slate-600/70 via-slate-500/70 to-slate-600/80"
                  }
                />
                {spentWidth > 0 && !isPending && (
                  <div
                    className={`pointer-events-none absolute inset-y-0 right-0 z-10 bg-white/35 ${spentStart <= 0 && spentWidth >= 100 ? "rounded-r-full rounded-l-full" : spentStart <= 0 ? "rounded-l-full" : spentStart + spentWidth >= 100 ? "rounded-r-full" : ""}
                    `}
                    style={{ left: `${spentStart}%`, width: `${spentWidth}%` }}
                  />
                )}
                <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center font-bold text-white text-xs drop-shadow-sm">
                  {!isPending && `${Math.max(actionNow, 0).toFixed(1)}% AP`}
                </div>
              </div>
            </div>
          </div>
          {/* Cost before & after */}
          <div className="flex flex-col items-center gap-1 pt-1 pr-2">
            <span className="flex w-full items-center gap-1 rounded-full bg-slate-800/70 px-2.5 font-semibold">
              <span className="text-[11px] text-slate-400 uppercase tracking-wide">
                Cost
              </span>
              <div className="grow"></div>
              <span className={isProjectedNegative ? "text-red-300" : "text-sky-200"}>
                {cost ? `${cost.toFixed(1)}%` : "N/A"}
              </span>
            </span>
            <span className="flex w-full items-center gap-1 rounded-full bg-slate-800/70 px-2.5 font-semibold">
              <span className="text-[11px] text-slate-400 uppercase tracking-wide">
                After
              </span>
              <div className="grow"></div>
              <span
                className={isProjectedNegative ? "text-red-300" : "text-emerald-200"}
              >
                {cost ? `${Math.max(actionAfter, 0).toFixed(1)}%` : "N/A"}
              </span>
            </span>
          </div>
          {props?.options && (
            <div className="flex flex-col items-center justify-center gap-1 pt-1 pr-2">
              {props.options}
            </div>
          )}
        </div>

        {(isPending || !user) && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-950/10 backdrop-blur-sm">
            <Loader noPadding={true} />
          </div>
        )}
      </div>
    </div>
  );
};

export default ActionTimer;
