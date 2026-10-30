"use client";

import { Moon, RotateCcw, SlidersHorizontal, Sun } from "lucide-react";
import { useId } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDayNightCycle } from "@/hooks/day-night-cycle";
import Countdown from "@/layout/Countdown";
import { getWorldCyclePosition, getWorldCycleState } from "@/libs/dayNight";
import type { WorldWeather } from "@/libs/rendering/worldWeather";
import { isStaffRole } from "@/utils/permissions";
import { useUserData } from "@/utils/UserContext";

type DayNightIndicatorProps = {
  className?: string;
  previewDate?: Date | null;
  onPreviewDateChange?: (date: Date | null) => void;
  previewWeather?: WorldWeather | null;
  onPreviewWeatherChange?: (weather: WorldWeather | null) => void;
};

/** Shows live world time, with local staff controls for the owning map's lighting and weather. */
export function DayNightIndicator({
  className,
  previewDate = null,
  onPreviewDateChange,
  previewWeather = null,
  onPreviewWeatherChange,
}: DayNightIndicatorProps) {
  const dayNightCycle = useDayNightCycle();
  const { data: userData, timeDiff } = useUserData();
  const sliderId = useId();
  const weatherId = useId(),
    strengthId = useId();
  const canPreview = isStaffRole(userData?.role) && !!onPreviewDateChange;
  const selectedDate = canPreview ? previewDate : null;
  const selectedWeather = canPreview && onPreviewWeatherChange ? previewWeather : null;
  const cycle = selectedDate ? getWorldCycleState(selectedDate) : dayNightCycle;
  const position = getWorldCyclePosition(selectedDate ?? dayNightCycle.now);
  // The inspection clock places dawn at 06:00 and dusk at 18:00, respecting each phase's duration.
  const minutes = Math.floor(
    (360 +
      (position.phase === "day" ? 0 : 720) +
      (position.phaseOffset / position.phaseDuration) * 720) %
      1440,
  );
  const clock = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  const indicator = (
    <>
      <span className="flex items-center gap-2 text-sm font-medium">
        {cycle.phase === "day" ? (
          <Sun className="h-4 w-4 text-amber-500" />
        ) : (
          <Moon className="h-4 w-4 text-indigo-300" />
        )}
        {cycle.phase === "day" ? "Day" : "Night"}
        {canPreview && (
          <SlidersHorizontal className="text-muted-foreground ml-auto h-3 w-3" />
        )}
      </span>
      <span className="text-muted-foreground block text-xs">
        {selectedDate || selectedWeather ? (
          <>
            Preview ·{" "}
            {selectedDate
              ? clock
              : selectedWeather && WEATHER_LABELS[selectedWeather.kind]}
          </>
        ) : (
          <>
            {cycle.phase === "day" ? "Night" : "Day"} in{" "}
            <Countdown targetDate={cycle.nextPhaseAt} timeDiff={timeDiff} />
          </>
        )}
      </span>
    </>
  );

  return (
    <div
      className={
        className ??
        "bg-background/90 rounded-lg border px-3 py-2 shadow-md backdrop-blur-sm"
      }
    >
      {canPreview ? (
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Preview map lighting and weather"
              className="focus-visible:ring-ring block w-full cursor-pointer rounded-sm text-left outline-hidden focus-visible:ring-2"
            >
              {indicator}
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" sideOffset={8} className="z-[60] w-64 p-3">
            <div className="mb-3 flex items-center justify-between gap-3">
              <span className="text-sm font-medium">World preview</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 px-2"
                disabled={!selectedDate && !selectedWeather}
                aria-label="Use live world conditions"
                onClick={() => {
                  onPreviewDateChange?.(null);
                  onPreviewWeatherChange?.(null);
                }}
              >
                <RotateCcw className="h-3 w-3" />
                Live
              </Button>
            </div>
            <div className="mb-2 flex items-center justify-between text-xs">
              <label htmlFor={sliderId}>Time of day</label>
              <output htmlFor={sliderId} className="font-medium tabular-nums">
                {clock}
              </output>
            </div>
            <input
              id={sliderId}
              type="range"
              min={0}
              max={1439}
              step={1}
              value={minutes}
              aria-valuetext={clock}
              className="focus-visible:outline-ring h-5 w-full cursor-pointer appearance-none rounded-lg bg-orange-200 accent-orange-800 focus-visible:outline-2 focus-visible:outline-offset-2"
              onChange={(event) => {
                const phaseMinutes = (Number(event.target.value) + 1080) % 1440;
                const offset =
                  phaseMinutes < 720
                    ? (phaseMinutes / 720) * position.dayMs
                    : position.dayMs +
                      ((phaseMinutes - 720) / 720) *
                        (position.cycleMs - position.dayMs);
                onPreviewDateChange?.(new Date(position.cycleStart + offset));
              }}
            />
            <div className="text-muted-foreground mt-1 flex justify-between text-xs tabular-nums">
              <span>00:00</span>
              <span>12:00</span>
              <span>23:59</span>
            </div>
            {onPreviewWeatherChange && (
              <div className="mt-3 space-y-2 border-t pt-3">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <label htmlFor={weatherId}>Weather</label>
                  <Select
                    value={selectedWeather?.kind ?? "auto"}
                    onValueChange={(value) =>
                      onPreviewWeatherChange(
                        value === "auto"
                          ? null
                          : {
                              kind: value as WorldWeather["kind"],
                              intensity: selectedWeather?.intensity ?? 0.65,
                            },
                      )
                    }
                  >
                    <SelectTrigger id={weatherId} className="h-8 w-36 px-2 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="z-[70]">
                      <SelectItem value="auto">Regional</SelectItem>
                      {Object.entries(WEATHER_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {selectedWeather && selectedWeather.kind !== "clear" && (
                  <div>
                    <div className="flex justify-between text-xs">
                      <label htmlFor={strengthId}>Weather strength</label>
                      <output htmlFor={strengthId} className="tabular-nums">
                        {Math.round(selectedWeather.intensity * 100)}%
                      </output>
                    </div>
                    <input
                      id={strengthId}
                      type="range"
                      min={0}
                      max={100}
                      step={5}
                      value={Math.round(selectedWeather.intensity * 100)}
                      aria-valuetext={`${Math.round(selectedWeather.intensity * 100)}%`}
                      className="focus-visible:outline-ring mt-1 h-5 w-full cursor-pointer appearance-none rounded-lg bg-orange-200 accent-orange-800 focus-visible:outline-2 focus-visible:outline-offset-2"
                      onChange={(event) =>
                        onPreviewWeatherChange({
                          ...selectedWeather,
                          intensity: Number(event.target.value) / 100,
                        })
                      }
                    />
                  </div>
                )}
              </div>
            )}
            <p className="text-muted-foreground mt-3 text-xs">Local preview only</p>
          </PopoverContent>
        </Popover>
      ) : (
        indicator
      )}
    </div>
  );
}

const WEATHER_LABELS: Record<WorldWeather["kind"], string> = {
  clear: "Clear",
  rain: "Rain",
  snow: "Snow",
  sandstorm: "Sandstorm",
};
