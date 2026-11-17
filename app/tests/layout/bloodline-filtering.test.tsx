import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { act, cleanup, renderHook } from "@testing-library/react";
import { GeneralTypes } from "@/drizzle/constants";
import { getFilter, useFiltering } from "@/layout/BloodlineFiltering";
import { bloodlineFilteringSchema } from "@/validators/bloodline";

beforeEach(() => window.sessionStorage.clear());
afterEach(cleanup);

describe("bloodline filters", () => {
  it("ignores a restored legacy stat selection before the filter becomes ready", () => {
    const seed = renderHook(() =>
      useFiltering(undefined, { persistKey: "manual-bloodline" }),
    );
    seed.unmount();
    const key = window.sessionStorage.key(0)!;
    const saved = JSON.parse(window.sessionStorage.getItem(key)!);
    const defaults = JSON.parse(saved.defaultsKey);
    defaults[0] = defaults[0].map(([id, value]: [string, unknown]) => [
      id === "generals" ? "stat" : id,
      value,
    ]);
    saved.defaultsKey = JSON.stringify(defaults);
    saved.values.stat = ["Ninjutsu"];
    delete saved.values.generals;
    window.sessionStorage.clear();
    window.sessionStorage.setItem(
      `contentFilter:manual-bloodline:${saved.defaultsKey}`,
      JSON.stringify(saved),
    );

    const readyFilters: Record<string, unknown>[] = [];
    const restored = renderHook(() => {
      const state = useFiltering(undefined, { persistKey: "manual-bloodline" });
      if (state.cf.isReady) readyFilters.push(getFilter(state));
      return state;
    });
    expect(restored.result.current.cf.isReady).toBe(true);
    expect(readyFilters.length).toBeGreaterThan(0);
    for (const filter of readyFilters) {
      expect(filter).toEqual({});
      expect(bloodlineFilteringSchema.safeParse(filter).success).toBe(true);
    }
  });

  it("sends general selections through the stat filter and keeps classification separate", () => {
    const view = renderHook(() => useFiltering());
    act(() => {
      view.result.current.cf.setters.generals([...GeneralTypes]);
      view.result.current.cf.setters.classification("Ninjutsu");
    });
    const filter = getFilter(view.result.current);
    expect(filter).toEqual({ stat: [...GeneralTypes], classification: "Ninjutsu" });
    expect(bloodlineFilteringSchema.safeParse(filter).success).toBe(true);
  });

  it("restores a current general selection when the list mounts again", () => {
    const seed = renderHook(() =>
      useFiltering(undefined, { persistKey: "manual-bloodline" }),
    );
    act(() => seed.result.current.cf.setters.generals(["Strength"]));
    seed.unmount();

    const restored = renderHook(() =>
      useFiltering(undefined, { persistKey: "manual-bloodline" }),
    );
    expect(restored.result.current.cf.isReady).toBe(true);
    expect(restored.result.current.generals).toEqual(["Strength"]);
    const filter = getFilter(restored.result.current);
    expect(filter).toEqual({ stat: ["Strength"] });
    expect(bloodlineFilteringSchema.safeParse(filter).success).toBe(true);
  });
});
