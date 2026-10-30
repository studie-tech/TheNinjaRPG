import { useEffect, useMemo, useState } from "react";
import { getWorldCycleState } from "@/libs/dayNight";
import { useUserData } from "@/utils/UserContext";

/** Publishes the server-corrected instant and its cycle state together on each tick. */
export const useDayNightCycle = (tickMs = 1000) => {
  const { timeDiff } = useUserData();
  const [now, setNow] = useState(() => new Date(Date.now() - timeDiff));

  useEffect(() => {
    const updateNow = () => setNow(new Date(Date.now() - timeDiff));
    updateNow();
    const intervalId = window.setInterval(updateNow, tickMs);
    return () => window.clearInterval(intervalId);
  }, [tickMs, timeDiff]);

  return useMemo(() => ({ ...getWorldCycleState(now), now }), [now]);
};
