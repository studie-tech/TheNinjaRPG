import type { RendererSurface } from "@/libs/rendering/telemetry";
import type { RenderQuality, VisualEffect, VisualEffects } from "@/libs/visualEffects";

/** Display density above this costs fill rate without visible gain at game viewing distance. */
export const MAX_RENDER_RESOLUTION = 2;
/**
 * Automatic quality bounds backing pixels per canvas. Touch devices pay for every pixel with a
 * phone or tablet GPU; desktops keep full density for ordinary windows and lose it only on very
 * large canvases. Each budget still allows standard density on any canvas.
 */
export const AUTO_PIXEL_BUDGET = { touch: 2.1e6, desktop: 4.2e6 } as const;
/**
 * Effects automatic quality may switch off for a session, after resolution, in this order.
 * Each removes per-pixel or per-frame work: shadow depth and occlusion passes, the local
 * light target, then falling weather particles.
 */
export const ADAPTIVE_EFFECTS = [
  "shadows",
  "localLights",
  "weather",
] as const satisfies readonly VisualEffect[];

/**
 * Density a renderer draws at before adaptation. An explicit scene resolution always wins;
 * otherwise auto fits the budget in quarter steps, high keeps display density and low draws
 * one backing pixel per CSS pixel.
 */
export const baseRenderResolution = ({
  quality,
  width,
  height,
  devicePixelRatio,
  isTouch,
}: {
  quality: RenderQuality;
  width: number;
  height: number;
  devicePixelRatio: number;
  isTouch: boolean;
}) => {
  const display = Math.min(devicePixelRatio || 1, MAX_RENDER_RESOLUTION);
  if (quality === "high") return display;
  if (quality === "low") return Math.min(display, 1);
  const budget = isTouch ? AUTO_PIXEL_BUDGET.touch : AUTO_PIXEL_BUDGET.desktop;
  const fitted = Math.floor(Math.sqrt(budget / Math.max(1, width * height)) * 4) / 4;
  return Math.min(display, Math.max(1, fitted));
};

/**
 * Ordered quality levels from full detail: resolution steps to 1.5× and 1× (no lower than
 * the floor), then each adaptive effect that is currently on and not kept. Kept effects are
 * the player's choices in settings and effects whose removal did not speed this scene up.
 */
export const renderQualityLevels = (
  base: number,
  effects: VisualEffects,
  kept: ReadonlySet<VisualEffect>,
  resolutionFloor = 1,
): QualityLevel[] => {
  const levels: QualityLevel[] = [{ resolution: base, disabled: [] }];
  let resolution = base;
  for (const step of [1.5, 1]) {
    if (base <= step || step < resolutionFloor) continue;
    resolution = step;
    levels.push({ resolution, disabled: [] });
  }
  const disabled: VisualEffect[] = [];
  for (const effect of ADAPTIVE_EFFECTS) {
    if (!effects[effect] || kept.has(effect)) continue;
    disabled.push(effect);
    levels.push({ resolution, disabled: [...disabled] });
  }
  return levels;
};

/**
 * The most reduced level of a rebuilt ladder that is no lower than the previous level: no
 * lower density and no effect the previous level kept. Settings and resizes therefore never
 * take away more than the governor already had.
 */
export const matchingQualityLevel = (
  levels: readonly QualityLevel[],
  previous: QualityLevel,
) => {
  for (let index = levels.length - 1; index > 0; index--) {
    const level = levels[index];
    if (
      level &&
      level.resolution >= previous.resolution &&
      level.disabled.every((effect) => previous.disabled.includes(effect))
    )
      return index;
  }
  return 0;
};

/**
 * First level for a renderer without session history. Software rasterizers start without
 * the costliest lighting work; low-memory or few-core devices start at standard density.
 * Measured headroom still raises either start.
 */
export const initialRenderQualityLevel = (
  levels: readonly QualityLevel[],
  device: { software: boolean; memory?: number; cores?: number },
) => {
  const standard = Math.max(
    0,
    levels.findIndex((level) => level.resolution <= 1),
  );
  if (device.software) {
    // The most reduced level that switches off nothing beyond shadows and local lights.
    for (let index = levels.length - 1; index > standard; index--) {
      const disabled = levels[index]?.disabled ?? [];
      if (disabled.every((effect) => effect === "shadows" || effect === "localLights"))
        return index;
    }
    return standard;
  }
  if ((device.memory ?? Infinity) <= 2 || (device.cores ?? Infinity) <= 2)
    return standard;
  return 0;
};

/**
 * Chooses a quality level from presented frame intervals. Each sample is its interval over its
 * requested rate's nominal interval, so 30 fps ambient scenes and 60 fps motion share thresholds;
 * the nominal interval is used because a loaded GPU also delays the refreshes a measured display
 * rate would come from. Two-second windows step down one level when their 75th percentile runs
 * 40% slow (one window when it runs 2.5× slow), and step up after consecutive windows at full
 * rate with headroom. A step down that does not cut the slow percentile by a tenth is undone
 * and reported as rejected, so the caller can drop it from the ladder and try the next kind
 * of step. A step up followed by a slowdown doubles the wait for the next one, so a device
 * on the edge of a level settles instead of oscillating.
 */
export const createRenderQualityGovernor = (initial: GovernorState) => {
  const ratios = new Uint16Array(RATIO_BUCKETS);
  let { level, patience } = initial;
  let maxLevel = level;
  let pending = WARMUP_MS;
  let elapsed = 0,
    samples = 0,
    fullRate = 0,
    slowWindows = 0,
    healthyWindows = 0,
    windowsSinceRaise = Number.POSITIVE_INFINITY;
  /** The slow percentile that caused the last step down, until the next window verifies it. */
  let loweredFrom: number | null = null;

  const restart = (settle: number) => {
    ratios.fill(0);
    // An interruption during warm-up keeps the rest of the warm-up.
    pending = Math.max(pending, settle);
    elapsed = samples = fullRate = 0;
  };
  const change = (next: number) => {
    if (next > level && windowsSinceRaise <= REGRESSION_WINDOWS)
      patience = Math.min(MAX_HEALTHY_WINDOWS, patience * 2);
    const step = next > level ? "lowered" : "raised";
    windowsSinceRaise = next < level ? 0 : Number.POSITIVE_INFINITY;
    level = next;
    slowWindows = healthyWindows = 0;
    restart(SETTLE_MS);
    return step;
  };
  return {
    get level() {
      return level;
    },
    /** Windows of headroom the next step up waits for. */
    get patience() {
      return patience;
    },
    /**
     * Moves to a level of a rebuilt ladder without counting it as a step. Moving, or an
     * interruption such as a resize, discards the measurement in progress.
     */
    setLevel(value: number, max: number, isInterrupted: boolean) {
      maxLevel = Math.max(0, max);
      const next = Math.max(0, Math.min(maxLevel, value));
      if (next === level && !isInterrupted) return;
      level = next;
      loweredFrom = null;
      slowWindows = healthyWindows = 0;
      restart(SETTLE_MS);
    },
    /**
     * Records one presented interval and returns the step it took, if any. Long gaps are
     * stalls or suspensions rather than sustained load. Allocation-free for frame callbacks.
     */
    sample(
      interval: number,
      expected: number,
      isFullRate: boolean,
    ): QualityStep | null {
      if (interval <= 0 || expected <= 0 || interval > MAX_SAMPLE_MS) return null;
      if (pending > 0) {
        pending -= interval;
        return null;
      }
      ratios[Math.min(RATIO_BUCKETS - 1, Math.round((interval / expected) * 16))]!++;
      samples++;
      if (isFullRate) fullRate++;
      elapsed += interval;
      if (elapsed < WINDOW_MS || samples < WINDOW_FRAMES) return null;
      const ratio = ratioPercentile(ratios, samples, 0.75);
      const isFull = fullRate >= samples * 0.75;
      restart(0);
      windowsSinceRaise++;
      const steppedFrom = loweredFrom;
      loweredFrom = null;
      if (ratio >= SLOW_RATIO) {
        healthyWindows = 0;
        // A step that bought no speed is limited elsewhere (scene work on the CPU, a slow
        // display, a cost this scene does not have); undo it rather than lose detail for nothing.
        if (steppedFrom !== null && ratio > steppedFrom * USEFUL_STEP_RATIO) {
          level--;
          slowWindows = 0;
          restart(SETTLE_MS);
          return "rejected";
        }
        if (level >= maxLevel) return null;
        if (ratio >= SEVERE_RATIO || ++slowWindows >= SLOW_WINDOWS) {
          loweredFrom = ratio;
          return change(level + 1);
        }
        return null;
      }
      slowWindows = 0;
      if (ratio <= HEALTHY_RATIO && isFull && level > 0) {
        if (++healthyWindows >= patience) return change(level - 1);
        return null;
      }
      healthyWindows = 0;
      return null;
    },
  };
};

/** Last automatic level per surface, so the next battle or map visit starts where this one settled. */
export const sessionRenderQuality = new Map<
  RendererSurface,
  {
    level: QualityLevel;
    patience: number;
    resolutionFloor: number;
    ineffectiveEffects: readonly VisualEffect[];
  }
>();

/** The first wait for headroom; regressions double it up to the maximum. */
export const INITIAL_HEALTHY_WINDOWS = 5;

/** Reductions automatic quality currently applies on visible scenes, for the settings panel. */
export const publishRenderQualityStatus = (
  owner: object,
  status: QualityStatus | null,
) => {
  const previous = statuses.get(owner);
  if (
    previous?.isResolutionReduced === status?.isResolutionReduced &&
    previous?.disabled.join() === status?.disabled.join()
  )
    return;
  if (status && (status.isResolutionReduced || status.disabled.length))
    statuses.set(owner, status);
  else if (!statuses.delete(owner)) return;
  for (const listener of statusListeners) listener();
};

/** Union of every scene's current reductions. */
export const readRenderQualityStatus = (): QualityStatus => {
  const disabled = new Set<VisualEffect>();
  let isResolutionReduced = false;
  for (const status of statuses.values()) {
    isResolutionReduced ||= status.isResolutionReduced;
    for (const effect of status.disabled) disabled.add(effect);
  }
  return {
    isResolutionReduced,
    disabled: ADAPTIVE_EFFECTS.filter((effect) => disabled.has(effect)),
  };
};

export const subscribeRenderQualityStatus = (listener: () => void) => {
  statusListeners.add(listener);
  return () => {
    statusListeners.delete(listener);
  };
};

const ratioPercentile = (histogram: Uint16Array, total: number, quantile: number) => {
  const target = Math.ceil(total * quantile);
  let seen = 0;
  for (let bucket = 0; bucket < histogram.length; bucket++) {
    seen += histogram[bucket] ?? 0;
    if (seen >= target) return bucket / 16;
  }
  return (histogram.length - 1) / 16;
};

const statuses = new Map<object, QualityStatus>();
const statusListeners = new Set<() => void>();
/** Sixteenth-of-target buckets up to 32 times the target interval (about 2 fps at 60). */
const RATIO_BUCKETS = 513;
/** Shader compilation and first texture uploads are not sustained load. */
const WARMUP_MS = 3_000;
/** Resizing targets and rebuilding passes stalls the first frames after a change. */
const SETTLE_MS = 500;
const WINDOW_MS = 2_000;
/** Very slow scenes extend a window until a percentile means something. */
const WINDOW_FRAMES = 12;
/** Longer gaps are stalls or suspensions; slower sustained frames still count. */
const MAX_SAMPLE_MS = 1_000;
const SLOW_RATIO = 1.4;
const SEVERE_RATIO = 2.5;
const HEALTHY_RATIO = 1.1;
const SLOW_WINDOWS = 2;
/** A step down must cut the slow percentile by at least a tenth to be kept. */
const USEFUL_STEP_RATIO = 0.9;
const MAX_HEALTHY_WINDOWS = 60;
/** A slowdown this many windows after a step up counts as that step failing. */
const REGRESSION_WINDOWS = 5;

/** Renderer density and session-disabled effects at one quality level. */
export type QualityLevel = { resolution: number; disabled: readonly VisualEffect[] };
type GovernorState = { level: number; patience: number };
/** Rejected: a step down that did not speed frames up and was undone. */
type QualityStep = "lowered" | "raised" | "rejected";
type QualityStatus = {
  isResolutionReduced: boolean;
  disabled: readonly VisualEffect[];
};
