import { describe, expect, it } from "bun:test";
import { aggregateExperiments } from "@/libs/experimentAnalytics";
import {
  WALLPAPER_EXPERIMENT,
  WALLPAPER_IMAGES,
  WALLPAPER_VARIANTS,
} from "@/libs/wallpaperExperiment";

const cohort = {
  experiment: WALLPAPER_EXPERIMENT,
  variant: "summer",
  userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/129.0",
  loaded: 4,
  register: 2,
};

describe("experiment exposure cohorts", () => {
  it("allocates each distinct village and seasonal image once", () => {
    expect(new Set(Object.values(WALLPAPER_IMAGES)).size).toBe(
      WALLPAPER_VARIANTS.length,
    );
  });

  it("includes all candidates and sums weighted exposure cohorts", () => {
    const result = aggregateExperiments([
      cohort,
      { ...cohort, userAgent: "iPhone", loaded: 3, register: 1 },
      { ...cohort, variant: "winter", loaded: 2, register: 0 },
    ]);
    expect(result[0]?.variants).toHaveLength(WALLPAPER_VARIANTS.length);
    expect(result[0]?.variants.find((arm) => arm.variant === "summer")).toEqual({
      variant: "summer",
      loaded: 7,
      register: 3,
    });
    expect(result[0]?.variants.find((arm) => arm.variant === "winter")).toEqual({
      variant: "winter",
      loaded: 2,
      register: 0,
    });
    expect(result[0]?.variants.find((arm) => arm.variant === "spring")).toEqual({
      variant: "spring",
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
    const summer = (devices?: ("desktop" | "mobile" | "unknown")[]) =>
      aggregateExperiments(rows, devices)[0]?.variants.find(
        (arm) => arm.variant === "summer",
      );
    expect(summer(["desktop"])).toEqual({ variant: "summer", loaded: 9, register: 5 });
    expect(summer(["mobile", "unknown"])).toEqual({
      variant: "summer",
      loaded: 5,
      register: 2,
    });
    expect(summer([])).toEqual({ variant: "summer", loaded: 14, register: 7 });
  });
});
