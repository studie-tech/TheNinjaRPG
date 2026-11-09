import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { StrictMode } from "react";
import {
  battleTypesField,
  buildFilter,
  defineFilteringSchema,
  hiddenVisibilityField,
  minCountField,
  useContentFiltering,
} from "@/layout/ContentFiltering";

const makeSchema = (category = "WEAPON") =>
  defineFilteringSchema({
    fields: [
      { id: "name", label: "Name", type: "text", defaultValue: "" },
      { id: "level", label: "Level", type: "number", defaultValue: undefined },
      { id: "date", label: "Date", type: "date", defaultValue: "" },
      {
        id: "category",
        label: "Category",
        type: "single-select",
        defaultValue: category,
      },
      {
        id: "stats",
        label: "Stats",
        type: "multi-select",
        defaultValue: [] as string[],
      },
      { id: "hidden", label: "Hidden", type: "tri-state", defaultValue: undefined },
    ] as const,
    exclusions: [{ key: "excludedStats", label: "Stats", options: ["Ninjutsu"] }],
  });

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("content filter timing", () => {
  it("applies selects, toggles and exclusions without waiting for a timer", () => {
    const schema = makeSchema();
    const { result } = renderHook(() => useContentFiltering(schema));
    act(() => {
      result.current.setters.category("ARMOR");
      result.current.setters.stats(["Ninjutsu"]);
      result.current.setters.hidden(false);
      result.current.setExcluded.excludedStats(["Taijutsu"]);
    });

    expect(buildFilter(result.current, schema)).toEqual({
      category: "ARMOR",
      stats: ["Ninjutsu"],
      hidden: false,
      excludedStats: ["Taijutsu"],
    });
    expect(result.current.debounced).toEqual(result.current.values);
    expect(result.current.debouncedExcluded).toEqual(result.current.excluded);
  });

  it("keeps text, number and date input debounced until typing stops", () => {
    const schema = makeSchema();
    const { result } = renderHook(() => useContentFiltering(schema));
    act(() => {
      result.current.setters.name("K");
      result.current.setters.level(10);
      result.current.setters.date("2026-10-26");
    });
    act(() => vi.advanceTimersByTime(300));
    act(() => result.current.setters.name("Kunai"));
    act(() => vi.advanceTimersByTime(499));
    expect(buildFilter(result.current, schema)).toEqual({ category: "WEAPON" });
    act(() => vi.advanceTimersByTime(1));
    expect(buildFilter(result.current, schema)).toEqual({
      category: "WEAPON",
      name: "Kunai",
      level: 10,
      date: "2026-10-26",
    });
  });

  it("applies a category immediately while preserving a pending text edit", () => {
    const schema = makeSchema();
    const { result } = renderHook(() => useContentFiltering(schema));
    act(() => result.current.setters.name("Kunai"));
    act(() => vi.advanceTimersByTime(200));
    act(() => result.current.setters.category("ARMOR"));
    expect(buildFilter(result.current, schema)).toEqual({ category: "ARMOR" });
    act(() => vi.advanceTimersByTime(500));
    expect(buildFilter(result.current, schema)).toEqual({
      category: "ARMOR",
      name: "Kunai",
    });
  });

  it("preserves consecutive functional updates and clears discrete filters immediately", () => {
    const schema = makeSchema();
    const { result } = renderHook(() => useContentFiltering(schema), {
      wrapper: StrictMode,
    });
    act(() => {
      result.current.setters.stats((previous) => [...previous, "Ninjutsu"]);
      result.current.setters.stats((previous) => [...previous, "Taijutsu"]);
      result.current.setters.hidden(false);
      result.current.setExcluded.excludedStats((previous) => [...previous, "Fire"]);
      result.current.setExcluded.excludedStats((previous) => [...previous, "Wind"]);
    });
    expect(result.current.debounced.stats).toEqual(["Ninjutsu", "Taijutsu"]);
    expect(result.current.debounced.hidden).toBe(false);
    expect(result.current.debouncedExcluded.excludedStats).toEqual(["Fire", "Wind"]);
    act(() => {
      result.current.setters.stats([]);
      result.current.setters.hidden(undefined);
      result.current.setExcluded.excludedStats([]);
    });
    expect(buildFilter(result.current, schema)).toEqual({ category: "WEAPON" });
  });

  it("resets schema defaults and cancels pending input when the schema changes", () => {
    const { result, rerender, unmount } = renderHook(
      ({ schema }) => useContentFiltering(schema),
      { initialProps: { schema: makeSchema() } },
    );
    act(() => {
      result.current.setters.name("Kunai");
      result.current.setExcluded.excludedStats(["Fire"]);
    });
    const nextSchema = makeSchema("ARMOR");
    rerender({ schema: nextSchema });
    act(() => vi.advanceTimersByTime(500));
    expect(buildFilter(result.current, nextSchema)).toEqual({ category: "ARMOR" });
    act(() => result.current.setters.name("Helmet"));
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("shared filter fields", () => {
  it("sends no minimum count below 1", () => {
    expect(minCountField.normalizeForFilter(undefined)).toBeUndefined();
    expect(minCountField.normalizeForFilter(0)).toBeUndefined();
    expect(minCountField.normalizeForFilter(1)).toBe(1);
  });

  it("starts battle types from the given selection", () => {
    const { result } = renderHook(() => useContentFiltering(stableBattleSchema));
    expect(result.current.values.battleTypes).toEqual(["COMBAT"]);
    expect(buildFilter(result.current, stableBattleSchema)).toEqual({
      battleTypes: ["COMBAT"],
    });
  });

  it("shows the visibility toggle to content editors only", () => {
    const field = hiddenVisibilityField(false);
    expect(field.defaultValue).toBe(false);
    expect(hiddenVisibilityField().defaultValue).toBeUndefined();
    expect(field.visibleIf({ canEdit: true })).toBe(true);
    expect(field.visibleIf({ canEdit: false })).toBe(false);
    expect(field.visibleIf()).toBe(false);
  });
});

const stableBattleSchema = defineFilteringSchema({
  fields: [battleTypesField(["COMBAT"])] as const,
});
