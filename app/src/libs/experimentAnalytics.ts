import { WALLPAPER_EXPERIMENT, WALLPAPER_VARIANTS } from "@/libs/wallpaperExperiment";
import { type DeviceType, getDeviceType } from "@/utils/hardware";

type ExperimentEvent = {
  experiment: string;
  variant: string;
  event: string;
  ipHash: string | null;
  userAgent: string | null;
};
export const aggregateExperiments = (
  rows: ExperimentEvent[],
  devices?: DeviceType[],
) => {
  const successes = new Set(
    rows
      .filter((row) => row.event === "success" && row.ipHash)
      .map((row) => JSON.stringify([row.experiment, row.ipHash, row.variant])),
  );
  const experiments = new Map<
    string,
    Map<string, { loaded: number; register: number }>
  >();
  const exposures = new Set<string>();
  for (const row of rows) {
    if (
      row.event !== "loaded" ||
      (devices?.length && !devices.includes(getDeviceType(row.userAgent ?? undefined)))
    )
      continue;
    const key = JSON.stringify([row.experiment, row.ipHash, row.variant]);
    if (row.ipHash && exposures.has(key)) continue;
    exposures.add(key);
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
    counts.loaded++;
    if (row.ipHash && successes.has(key)) counts.register++;
    variants.set(row.variant, counts);
  }
  return Array.from(experiments, ([experiment, variants]) => ({
    experiment,
    variants: Array.from(variants, ([variant, counts]) => ({ variant, ...counts })),
  }));
};
