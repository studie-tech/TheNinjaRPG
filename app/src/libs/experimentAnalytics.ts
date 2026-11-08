import { LEMU_EXPERIMENT, normalizeLemuVariant } from "@/libs/lemuExperiment";
import {
  parseWallpaperVariant,
  WALLPAPER_EXPERIMENT,
  WALLPAPER_VARIANTS,
} from "@/libs/wallpaperExperiment";
import { type DeviceType, getDeviceType } from "@/utils/hardware";

/** SQL-counted exposures and matched completions for one exact user-agent cohort. */
type ExperimentCohort = {
  experiment: string;
  variant: string;
  userAgent: string | null;
  loaded: number;
  /** Tutorial completions attributed to this cohort's exposures. */
  register: number;
};

/**
 * Sum SQL-counted cohorts into variant totals, filtering by the exposure's device.
 * The query owns visitor deduplication and completion matching; omitted or empty
 * device filters include every cohort. Wallpaper arms retain zero-count entries.
 */
export const aggregateExperiments = (
  rows: ExperimentCohort[],
  devices?: DeviceType[],
) => {
  const experiments = new Map<
    string,
    Map<string, { loaded: number; register: number }>
  >();
  for (const row of rows) {
    if (devices?.length && !devices.includes(getDeviceType(row.userAgent ?? undefined)))
      continue;
    let variants = experiments.get(row.experiment);
    if (!variants) {
      variants = new Map();
      if (row.experiment === WALLPAPER_EXPERIMENT) {
        for (const variant of WALLPAPER_VARIANTS)
          variants.set(variant, { loaded: 0, register: 0 });
      }
      experiments.set(row.experiment, variants);
    }
    const counts = variants.get(row.variant) ?? { loaded: 0, register: 0 };
    counts.loaded += row.loaded;
    counts.register += row.register;
    variants.set(row.variant, counts);
  }
  return Array.from(experiments, ([experiment, variants]) => ({
    experiment,
    variants: Array.from(variants, ([variant, counts]) => ({ variant, ...counts })),
  }));
};

export interface ExperimentAssignment {
  experiment: string;
  variant: string;
}

/** Normalize persisted experiment variants into valid assignments for exposure and completion attribution. */
export const getExperimentAssignments = (variants: {
  abLemuReplacementVariant?: string | null;
  wallpaperVariant?: string | null;
}): ExperimentAssignment[] => {
  const assignments: ExperimentAssignment[] = [];
  const variant = normalizeLemuVariant(variants.abLemuReplacementVariant);
  if (variant) {
    assignments.push({
      experiment: LEMU_EXPERIMENT,
      variant,
    });
  }
  const wallpaper = parseWallpaperVariant(variants.wallpaperVariant);
  if (wallpaper)
    assignments.push({ experiment: WALLPAPER_EXPERIMENT, variant: wallpaper });
  return assignments;
};
