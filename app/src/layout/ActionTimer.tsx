import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Loader from "./Loader";
import { useUserData } from "@/utils/UserContext";
import { calcActiveUser, availableUserActions } from "@/libs/combat/actions";
import { calcApReduction } from "@/libs/combat/util";
import {
  IMG_ACTIONTIMER_BG,
  IMG_ACTIONTIMER_YELLOW,
  IMG_ACTIONTIMER_RED,
  IMG_ACTIONTIMER_BLUE,
  IMG_ACTIONTIMER_OVERLAY,
} from "@/drizzle/constants";
import type { CombatAction } from "@/libs/combat/types";
import type { ReturnedBattle } from "@/libs/combat/types";

interface ActionTimerProps {
  action?: CombatAction | undefined;
  user: { userId: string | undefined; actionPoints: number };
  battle: ReturnedBattle;
  isPending: boolean;
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

  // Precompute actions for this user, recompute only when battle version changes
  const precomputedActions = useMemo(() => {
    return availableUserActions(battle, user.userId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [battle?.version, user.userId]);

  // Calculate label and color
  const yellow = IMG_ACTIONTIMER_YELLOW;
  const red = IMG_ACTIONTIMER_RED;
  const blue = IMG_ACTIONTIMER_BLUE;

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
        const inform = !waiting ? "Your turn" : `${actor.username}'s turn`;
        const info = left > 0 ? `${inform}: ${left.toFixed(1)}s` : "Finished!";
        setState({ label: `Round: ${battle.round} - ${info}`, canAct, waiting });
      } else {
        setState({ label: `Waiting in Lobby`, canAct, waiting });
      }
      // Set action points
    }, 100);
    return () => clearInterval(interval);
  }, [isPending, battle, user, timeDiff, state, setState, precomputedActions]);

  return (
    <div className="pl-5">
      <div className="relative flex flex-row justify-center pt-2">
        <Image
          className="relative"
          src={IMG_ACTIONTIMER_BG}
          alt="Action Timer"
          width={768}
          height={62}
          priority={true}
        />
        {actionNow > 0 && (
          <>
            <Image
              className={`absolute ${!state.canAct ? "grayscale" : ""}`}
              style={{
                clipPath: `polygon(0 0%, ${actionNow}% 0%, ${actionNow}% 100%, 0% 100%)`,
              }}
              src={actionAfter >= 0 ? yellow : red}
              alt="Action Timer"
              width={768}
              height={62}
            />
            <Image
              className={`absolute ${!state.canAct ? "grayscale" : ""}`}
              style={{
                clipPath: `polygon(0 0%, ${actionAfter}% 0%, ${actionAfter}% 100%, 0% 100%)`,
              }}
              src={blue}
              alt="Action Timer"
              width={768}
              height={62}
            />
          </>
        )}
        <Image
          className="absolute"
          src={IMG_ACTIONTIMER_OVERLAY}
          alt="Action Timer"
          width={768}
          height={62}
        />
        {actionNow > 0 && !isPending && (
          <p
            className={`absolute bottom-0 left-0 right-0 top-3 flex items-center justify-center text-sm font-bold text-white drop-shadow-lg ${
              !state.canAct ? "opacity-50" : ""
            }`}
          >
            {actionNow.toFixed(1)}%
          </p>
        )}
        {(isPending || !user) && (
          <div className="absolute">
            <Loader noPadding={true} />
          </div>
        )}
        {state.label && !isPending && (
          <p
            className={`absolute bottom-0 left-0 right-0 top-0 flex justify-center text-sm font-bold ${
              state.waiting ? "text-red-800" : "text-green-800 "
            }`}
          >
            {state.label}
          </p>
        )}
      </div>
    </div>
  );
};

export default ActionTimer;
