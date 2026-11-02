import { useEffect, useMemo, useRef, useState } from "react";
import { getWorldCycleState } from "@/libs/dayNight";
import { useUserInfo } from "@/utils/UserContext";

/** Publishes server-corrected time; phase-only consumers stay stable between phase boundaries. */
export const useDayNightCycle = (tickMs = 1000, enabled = true, phaseOnly = false) => {
  const { timeDiff } = useUserInfo();
  const [now, setNow] = useState(() => new Date(Date.now() - timeDiff));

  const sampled = useRef(now);
  useEffect(() => {
    if (!enabled) return;
    const updateNow = () => {
      const next = new Date(Date.now() - timeDiff);
      if (
        phaseOnly &&
        getWorldCycleState(sampled.current).nextPhaseAt.getTime() ===
          getWorldCycleState(next).nextPhaseAt.getTime()
      )
        return;
      sampled.current = next;
      setNow(next);
    };
    updateNow();
    const intervalId = window.setInterval(updateNow, tickMs);
    return () => window.clearInterval(intervalId);
  }, [tickMs, timeDiff, enabled, phaseOnly]);

  return useMemo(() => ({ ...getWorldCycleState(now), now }), [now]);
};
