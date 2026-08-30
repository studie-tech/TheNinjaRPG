"use client";

import { Moon, Sun } from "lucide-react";
import { useDayNightCycle } from "@/hooks/day-night-cycle";
import Countdown from "@/layout/Countdown";
import { useUserData } from "@/utils/UserContext";

type DayNightIndicatorProps = {
  className?: string;
};

export function DayNightIndicator({ className }: DayNightIndicatorProps) {
  const dayNightCycle = useDayNightCycle();
  const { timeDiff } = useUserData();

  return (
    <div
      className={
        className ??
        "rounded-lg border bg-background/90 px-3 py-2 shadow-md backdrop-blur-sm"
      }
    >
      <div className="flex items-center gap-2 font-medium text-sm">
        {dayNightCycle.phase === "day" ? (
          <Sun className="h-4 w-4 text-amber-500" />
        ) : (
          <Moon className="h-4 w-4 text-indigo-300" />
        )}
        {dayNightCycle.phase === "day" ? "Day" : "Night"}
      </div>
      <div className="text-muted-foreground text-xs">
        {dayNightCycle.phase === "day" ? "Night" : "Day"} in{" "}
        <Countdown targetDate={dayNightCycle.nextPhaseAt} timeDiff={timeDiff} />
      </div>
    </div>
  );
}
