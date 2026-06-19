import { useEffect, useMemo, useState } from "react";
import { getWorldCycleState } from "@/libs/dayNight";
import { useUserData } from "@/utils/UserContext";

export const useDayNightCycle = (tickMs = 1000) => {
  const { timeDiff } = useUserData();
  const [now, setNow] = useState(() => new Date(Date.now() - timeDiff));

  useEffect(() => {
    const updateNow = () => setNow(new Date(Date.now() - timeDiff));
    updateNow();
    const intervalId = window.setInterval(updateNow, tickMs);
    return () => window.clearInterval(intervalId);
  }, [tickMs, timeDiff]);

  return useMemo(() => getWorldCycleState(now), [now]);
};
