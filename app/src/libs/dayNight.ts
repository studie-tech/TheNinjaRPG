import {
  WORLD_CYCLE_SECONDS,
  WORLD_CYCLE_TRANSITION_SECONDS,
  WORLD_DAY_BRIGHTNESS,
  WORLD_DAY_SECONDS,
  WORLD_NIGHT_BRIGHTNESS,
  WORLD_NIGHT_SECONDS,
} from "@/drizzle/constants";

const CYCLE_MS = WORLD_CYCLE_SECONDS * 1000;
const DAY_MS = WORLD_DAY_SECONDS * 1000;
const NIGHT_MS = WORLD_NIGHT_SECONDS * 1000;

const lerp = (from: number, to: number, amount: number) =>
  from + (to - from) * Math.max(0, Math.min(1, amount));

/** Identify the world cycle containing a timestamp, independently of the host timezone. */
export const getWorldDayCycleIndex = (date: Date) =>
  Math.floor(date.getTime() / CYCLE_MS);

/** Locate a timestamp within the configured world day or night phase. */
export const getWorldCyclePosition = (date: Date) => {
  const ms = date.getTime();
  const cycleStart = Math.floor(ms / CYCLE_MS) * CYCLE_MS;
  const offset = ms - cycleStart;
  const phase = offset < DAY_MS ? ("day" as const) : ("night" as const);
  const phaseOffset = offset < DAY_MS ? offset : offset - DAY_MS;
  return {
    cycleStart,
    cycleMs: CYCLE_MS,
    dayMs: DAY_MS,
    phase,
    phaseOffset,
    phaseDuration: phase === "day" ? DAY_MS : NIGHT_MS,
  };
};

/** Interpolate brightness near each phase boundary using the configured world-cycle timings. */
export const getWorldCycleBrightness = (now = new Date()) => {
  const { phase, phaseOffset, phaseDuration } = getWorldCyclePosition(now);
  const transitionMs = Math.min(
    WORLD_CYCLE_TRANSITION_SECONDS * 1000,
    phaseDuration / 4,
  );

  const [from, to] =
    phase === "day"
      ? [WORLD_DAY_BRIGHTNESS, WORLD_NIGHT_BRIGHTNESS]
      : [WORLD_NIGHT_BRIGHTNESS, WORLD_DAY_BRIGHTNESS];
  const fadeStart = phaseDuration - transitionMs;
  return phaseOffset > fadeStart
    ? lerp(from, to, (phaseOffset - fadeStart) / transitionMs)
    : from;
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
