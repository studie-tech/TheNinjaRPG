import { WORLD_DAY_BRIGHTNESS, WORLD_NIGHT_BRIGHTNESS } from "@/drizzle/constants";
import { getWorldCycleBrightness, getWorldCyclePosition } from "@/libs/dayNight";

/** Share of full daylight in a world brightness: 0 through the night, 1 through the day. */
export const worldDaylight = (brightness: number) =>
  Number.isFinite(brightness)
    ? Math.max(
        0,
        Math.min(
          1,
          (brightness - WORLD_NIGHT_BRIGHTNESS) /
            (WORLD_DAY_BRIGHTNESS - WORLD_NIGHT_BRIGHTNESS),
        ),
      )
    : 1;

/** East (+X), south (−Y), west (−X) follow the existing server-corrected cycle. Null freezes noon. */
export const worldSunlight = (date: Date | null = null, directionStepMs = 0) => {
  const directionDate =
    date && directionStepMs > 0
      ? new Date(Math.floor(date.getTime() / directionStepMs) * directionStepMs)
      : date;
  const cycle = directionDate ? getWorldCyclePosition(directionDate) : null;
  const brightness = date ? getWorldCycleBrightness(date) : WORLD_DAY_BRIGHTNESS;
  const day = worldDaylight(brightness);
  const progress = !cycle
    ? 0.5
    : cycle.phase === "day"
      ? cycle.phaseOffset / cycle.phaseDuration
      : day > 0
        ? 0
        : 1;
  const angle = Math.PI * progress;
  const x = Math.cos(angle),
    y = -Math.sin(angle) * 0.65,
    z = 0.28 + Math.sin(angle) * 0.8;
  const length = Math.hypot(x, y, z);
  return { x: x / length, y: y / length, z: z / length, day };
};
