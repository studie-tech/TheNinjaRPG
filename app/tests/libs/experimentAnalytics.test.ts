import { describe, expect, it } from "bun:test";
import { aggregateExperiments } from "@/libs/experimentAnalytics";
import {
  WALLPAPER_EXPERIMENT,
  WALLPAPER_IMAGES,
  WALLPAPER_VARIANTS,
} from "@/libs/wallpaperExperiment";

const cohort = {
  experiment: WALLPAPER_EXPERIMENT,
  variant: "hyorin",
  userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/129.0",
  loaded: 4,
  register: 2,
};

describe("experiment exposure cohorts", () => {
  it("allocates each distinct village image once", () => {
    expect(new Set(Object.values(WALLPAPER_IMAGES)).size).toBe(
      WALLPAPER_VARIANTS.length,
    );
  });

  it("includes all candidates and sums weighted exposure cohorts", () => {
    const result = aggregateExperiments([
      cohort,
      { ...cohort, userAgent: "iPhone", loaded: 3, register: 1 },
      { ...cohort, variant: "control", loaded: 2, register: 0 },
    ]);
    expect(result[0]?.variants).toHaveLength(WALLPAPER_VARIANTS.length);
    expect(result[0]?.variants.find((arm) => arm.variant === "hyorin")).toEqual({
      variant: "hyorin",
      loaded: 7,
      register: 3,
    });
    expect(result[0]?.variants.find((arm) => arm.variant === "control")).toEqual({
      variant: "control",
      loaded: 2,
      register: 0,
    });
    expect(result[0]?.variants.find((arm) => arm.variant === "tsukimori")).toEqual({
      variant: "tsukimori",
      loaded: 0,
      register: 0,
    });
  });

  it("excludes experiments with no exposure in the requested device cohort", () => {
    expect(aggregateExperiments([])).toEqual([]);
    expect(aggregateExperiments([cohort], ["mobile"])).toEqual([]);
  });

  it("filters weighted counts by the exposure user agent", () => {
    const rows = [
      cohort,
      { ...cohort, userAgent: "Macintosh", loaded: 5, register: 3 },
      { ...cohort, userAgent: "iPhone", loaded: 3, register: 1 },
      { ...cohort, userAgent: null, loaded: 2, register: 1 },
    ];
    const hyorin = (devices?: ("desktop" | "mobile" | "unknown")[]) =>
      aggregateExperiments(rows, devices)[0]?.variants.find(
        (arm) => arm.variant === "hyorin",
      );
    expect(hyorin(["desktop"])).toEqual({ variant: "hyorin", loaded: 9, register: 5 });
    expect(hyorin(["mobile", "unknown"])).toEqual({
      variant: "hyorin",
      loaded: 5,
      register: 2,
    });
    expect(hyorin([])).toEqual({ variant: "hyorin", loaded: 14, register: 7 });
  });
});
