import { useAtomValue } from "jotai";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Progress } from "@/components/ui/progress";
import { usePageActive } from "@/hooks/usePageActive";
import Loader from "@/layout/Loader";
import { availableUserActions, calcActiveUser } from "@/libs/combat/actions";
import { areBattleAllies } from "@/libs/combat/participants";
import { calcApReduction } from "@/libs/combat/turn";
import type { CombatAction, ReturnedBattle } from "@/libs/combat/types";
import { clamp } from "@/utils/math";
import { combatPendingActionAtom, useUserData } from "@/utils/UserContext";

interface ActionTimerProps {
  action?: CombatAction | undefined;
  user: { userId: string | undefined; actionPoints: number };
  battle: ReturnedBattle;
  isPending: boolean;
  options?: React.ReactNode;
}

/** Shows turn timing, projected AP and layout controls within the available width. */
const ActionTimer: React.FC<ActionTimerProps> = (props) => {
  // Destructure props
  const { action, user, battle, isPending } = props;

  // Data from the DB
  const { timeDiff } = useUserData();
  const isPageActive = usePageActive();
  const pendingAction = useAtomValue(combatPendingActionAtom);
  // The submitted action reserves its AP until the response settles the real value.
  const reserved =
    isPending && pendingAction?.battleId === battle.id ? pendingAction : undefined;

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
  const stateRef = useRef(state);
  stateRef.current = state;

  // Derived values
  const stunReduction = calcApReduction(battle, user.userId);
  const cost = reserved?.cost ?? action?.actionCostPerc ?? 0;
  const actionNow = user.actionPoints - stunReduction;
  const actionAfter = actionNow - cost;
  const clampedActionNow = clamp(actionNow, 0, 100);
  const clampedActionAfter = clamp(actionAfter, 0, 100);
  const isProjectedNegative = actionAfter < 0;
  const spentStart = Math.max(0, Math.min(clampedActionAfter, clampedActionNow));
  const spentWidth = Math.max(0, clampedActionNow - Math.max(0, clampedActionAfter));

  // Precompute actions for this user, recompute only when battle version changes
  const precomputedActions = useMemo(() => {
    return availableUserActions(battle, user.userId);
  }, [battle?.version, user.userId]);

  // Active updating of this component
  useLayoutEffect(() => {
    const nextTimerState = () => {
      const {
        actor,
        mseconds,
        secondsLeft: left,
      } = calcActiveUser(battle, user.userId, timeDiff, {
        precomputedUserId: user.userId,
        precomputedActions,
      });
      const canAct = actor.userId === user.userId;
      const waiting = user.userId !== actor.userId;
      if (mseconds >= 0) {
        const self = battle.usersState.find((u) => u.userId === user.userId);
        const inform = !waiting
          ? "You"
          : self && areBattleAllies(actor, self)
            ? "Ally"
            : "Opponent";
        const info = left > 0 ? `${inform}: ${left.toFixed(1)}s` : "Finished!";
        return { label: info, canAct, waiting };
      }
      return { label: "Lobby", canAct, waiting };
    };

    const updateState = () => {
      const next = nextTimerState();
      const prev = stateRef.current;
      if (
        prev.label === next.label &&
        prev.canAct === next.canAct &&
        prev.waiting === next.waiting
      ) {
        return;
      }
      stateRef.current = next;
      setState(next);
    };

    updateState();
    if (!isPageActive) return;
    const interval = setInterval(updateState, 100);
    return () => clearInterval(interval);
  }, [isPending, battle, user, timeDiff, precomputedActions, isPageActive]);

  return (
    <div className="@container/timer grow pb-1">
      <div className="relative w-full overflow-hidden rounded-lg border bg-slate-700/70 shadow-lg backdrop-blur-sm">
        <div className="flex flex-row">
          {/* Round & action bar */}
          <div className="flex grow flex-col px-2 py-1 @min-[400px]/timer:px-4">
            <div className="flex flex-wrap items-center gap-3 font-semibold text-[11px] text-slate-200 uppercase tracking-wide">
              <div className="flex w-full items-center gap-1 whitespace-nowrap @min-[400px]/timer:gap-3">
                {/* Compact labels leave room for both controls in narrow timers. */}
                <span title={`Round ${battle.round}`}>
                  <span className="hidden @min-[400px]/timer:inline">Round </span>
                  <span className="@min-[400px]/timer:hidden">R</span>
                  {battle.round}
                </span>
                <div className="grow"></div>
                <div
                  className={`flex items-center gap-2 rounded-full px-2 pt-1 text-[11px] @min-[400px]/timer:px-3 ${state.waiting ? "bg-amber-500/10 text-amber-200" : "bg-emerald-500/10 text-emerald-200"}`}
                >
                  <span
                    className={`h-2 w-2 rounded-full ${state.waiting ? "bg-amber-300" : "bg-emerald-300"}`}
                  />
                  <span
                    title={state.label}
                    className={`font-semibold ${state.label ? "" : "invisible"}`}
                  >
                    {state.label.startsWith("Opponent:") ? (
                      <>
                        <span className="@min-[400px]/timer:hidden">
                          {state.label.replace("Opponent:", "Opp:")}
                        </span>
                        <span className="hidden @min-[400px]/timer:inline">
                          {state.label}
                        </span>
                      </>
                    ) : (
                      state.label || "..."
                    )}
                  </span>
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
                {spentWidth > 0 && (
                  <div
                    data-testid={reserved ? "reserved-ap" : undefined}
                    className={`pointer-events-none absolute inset-y-0 right-0 z-10 ${reserved ? "animate-pulse bg-amber-200/60" : "bg-white/35"} ${spentStart <= 0 && spentWidth >= 100 ? "rounded-r-full rounded-l-full" : spentStart <= 0 ? "rounded-l-full" : spentStart + spentWidth >= 100 ? "rounded-r-full" : ""}
                    `}
                    style={{ left: `${spentStart}%`, width: `${spentWidth}%` }}
                  />
                )}
                <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center font-bold text-white text-xs drop-shadow-sm">
                  {`${Math.max(actionNow, 0).toFixed(1)}% AP`}
                </div>
              </div>
            </div>
          </div>
          {/* Cost before & after */}
          <div className="flex flex-col items-center gap-1 pt-1 pr-1 @min-[400px]/timer:pr-2">
            <span className="flex w-full items-center gap-1 rounded-full bg-slate-800/70 px-2 font-semibold @min-[400px]/timer:px-2.5">
              <span className="text-[11px] text-slate-400 uppercase tracking-wide">
                Cost
              </span>
              <div className="grow"></div>
              <span className={isProjectedNegative ? "text-red-300" : "text-sky-200"}>
                {cost ? `${cost.toFixed(1)}%` : "N/A"}
              </span>
            </span>
            <span className="flex w-full items-center gap-1 rounded-full bg-slate-800/70 px-2 font-semibold @min-[400px]/timer:px-2.5">
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
            // Layout controls stay reachable while an action response is pending.
            <div className="relative z-10 flex shrink-0 items-center justify-center gap-2 pt-1 pr-2">
              {props.options}
            </div>
          )}
        </div>

        {!user && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-950/10 backdrop-blur-sm">
            <Loader noPadding={true} />
          </div>
        )}
      </div>
    </div>
  );
};

export default ActionTimer;
