import {
  WORLD_CYCLE_SECONDS,
  WORLD_CYCLE_TRANSITION_SECONDS,
  WORLD_DAY_BRIGHTNESS,
  WORLD_DAY_SECONDS,
  WORLD_NIGHT_BRIGHTNESS,
  WORLD_NIGHT_SECONDS,
} from "@/drizzle/constants";

const getCycleMs = () => WORLD_CYCLE_SECONDS * 1000;
const getDayMs = () => WORLD_DAY_SECONDS * 1000;
const getNightMs = () => WORLD_NIGHT_SECONDS * 1000;

const lerp = (from: number, to: number, amount: number) =>
  from + (to - from) * Math.max(0, Math.min(1, amount));

export const getWorldDayCycleIndex = (date: Date) =>
  Math.floor(date.getTime() / getCycleMs());

export const getWorldCyclePosition = (date: Date) => {
  const ms = date.getTime();
  const cycleMs = getCycleMs();
  const dayMs = getDayMs();
  const nightMs = getNightMs();
  const cycleStart = Math.floor(ms / cycleMs) * cycleMs;
  const offset = ms - cycleStart;
  const phase = offset < dayMs ? ("day" as const) : ("night" as const);
  const phaseOffset = offset < dayMs ? offset : offset - dayMs;
  return {
    cycleStart,
    cycleMs,
    dayMs,
    phase,
    phaseOffset,
    phaseDuration: phase === "day" ? dayMs : nightMs,
  };
};

export const getWorldCycleBrightness = (now = new Date()) => {
  const { phase, phaseOffset, phaseDuration } = getWorldCyclePosition(now);
  const transitionMs = Math.min(
    WORLD_CYCLE_TRANSITION_SECONDS * 1000,
    phaseDuration / 4,
  );

  if (phase === "day") {
    if (phaseOffset > phaseDuration - transitionMs) {
      return lerp(
        WORLD_DAY_BRIGHTNESS,
        WORLD_NIGHT_BRIGHTNESS,
        (phaseOffset - (phaseDuration - transitionMs)) / transitionMs,
      );
    }
    return WORLD_DAY_BRIGHTNESS;
  }

  if (phaseOffset > phaseDuration - transitionMs) {
    return lerp(
      WORLD_NIGHT_BRIGHTNESS,
      WORLD_DAY_BRIGHTNESS,
      (phaseOffset - (phaseDuration - transitionMs)) / transitionMs,
    );
  }
  return WORLD_NIGHT_BRIGHTNESS;
};

export const getWorldCycleState = (now = new Date()) => {
  const position = getWorldCyclePosition(now);
  const nextPhaseAt =
    position.phase === "day"
      ? new Date(position.cycleStart + position.dayMs)
      : new Date(position.cycleStart + position.cycleMs);
  return {
    phase: position.phase,
    brightness: getWorldCycleBrightness(now),
    nextPhaseAt,
    nextDayCycleAt: new Date(position.cycleStart + position.cycleMs),
    dayCycleIndex: getWorldDayCycleIndex(now),
  };
};

export type WorldCycleState = ReturnType<typeof getWorldCycleState>;
