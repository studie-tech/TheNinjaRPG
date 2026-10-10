import { describe, expect, it } from "bun:test";
import { aggregateExperiments } from "@/libs/experimentAnalytics";
import { WALLPAPER_EXPERIMENT, WALLPAPER_VARIANTS, WALLPAPER_IMAGES } from "@/libs/wallpaperExperiment";

const visit = { experiment: WALLPAPER_EXPERIMENT, variant: "summer", event: "loaded", ipHash: "visitor", userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/129.0" };
describe("experiment exposure cohorts", () => {
  it("allocates each distinct village and seasonal image once", () => {
    expect(new Set(Object.values(WALLPAPER_IMAGES)).size).toBe(WALLPAPER_VARIANTS.length);
  });
  it("includes all candidates and counts a completion only for its exposure variant", () => {
    const result = aggregateExperiments([visit, visit, { ...visit, event: "success" }, { ...visit, event: "success", variant: "winter" }]);
    expect(result[0]?.variants).toHaveLength(WALLPAPER_VARIANTS.length);
    expect(result[0]?.variants.find((arm) => arm.variant === "summer")).toEqual({ variant: "summer", loaded: 1, register: 1 });
    expect(result[0]?.variants.find((arm) => arm.variant === "winter")?.register).toBe(0);
  });
  it("excludes conversions whose exposure is outside the requested cohort", () => {
    expect(aggregateExperiments([{ ...visit, event: "success" }])).toEqual([]);
  });
  it("uses the exposure device even if the completion is on another device", () => {
    const result = aggregateExperiments([visit, { ...visit, event: "success", userAgent: "iPhone" }], ["desktop"]);
    expect(result[0]?.variants.find((arm) => arm.variant === "summer")?.register).toBe(1);
    expect(aggregateExperiments([visit, { ...visit, event: "success", userAgent: "iPhone" }], ["mobile"])).toEqual([]);
  });
});
