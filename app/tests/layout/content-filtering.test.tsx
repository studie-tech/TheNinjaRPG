import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { act, cleanup, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
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

describe("content filter options", () => {
  it("keeps typed and chosen filters when options arrive with unchanged defaults", () => {
    const withOptions = (options: string[]) =>
      defineFilteringSchema({
        fields: [
          { id: "name", label: "Name", type: "text", defaultValue: "" },
          {
            id: "system",
            label: "System",
            type: "single-select",
            defaultValue: "None",
            options: options.map((value) => ({ value, label: value })),
          },
        ] as const,
        exclusions: [{ key: "excludedStats", label: "Stats", options }],
      });
    const { result, rerender } = renderHook(
      ({ schema }) => useContentFiltering(schema),
      { initialProps: { schema: withOptions([]) } },
    );
    act(() => {
      result.current.setters.name("Kunai");
      result.current.setters.system("Combat");
      result.current.setExcluded.excludedStats(["Fire"]);
    });
    const loaded = withOptions(["Combat", "Chat"]);
    rerender({ schema: loaded });
    act(() => vi.advanceTimersByTime(500));
    expect(buildFilter(result.current, loaded)).toEqual({
      name: "Kunai",
      system: "Combat",
      excludedStats: ["Fire"],
    });
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

describe("persisted and reset filters", () => {
  beforeEach(() => window.sessionStorage.clear());

  it("keeps the prerendered and initial client filter at its defaults until restoration", () => {
    const schema = makeSchema();
    const seed = renderHook(() =>
      useContentFiltering(schema, { persistKey: "test-list" }),
    );
    act(() => seed.result.current.setters.category("ARMOR"));
    seed.unmount();
    const Probe = () => {
      const state = useContentFiltering(schema, { persistKey: "test-list" });
      return <span>{`${state.isReady}:${state.values.category}`}</span>;
    };
    expect(renderToString(<Probe />)).toBe("<span>false:WEAPON</span>");
    const renders: { ready: boolean; category: string }[] = [];
    renderHook(() => {
      const state = useContentFiltering(schema, { persistKey: "test-list" });
      renders.push({ ready: state.isReady, category: state.values.category });
      return state;
    });
    expect(renders[0]).toEqual({ ready: false, category: "WEAPON" });
    expect(renders.at(-1)).toEqual({ ready: true, category: "ARMOR" });
  });

  it.each(["missing", "malformed", "stale", "blocked"])(
    "becomes ready with default values when saved storage is %s",
    (mode) => {
      const schema = makeSchema();
      if (mode === "malformed" || mode === "stale") {
        const seed = renderHook(() =>
          useContentFiltering(schema, { persistKey: "test-list" }),
        );
        seed.unmount();
        const key = window.sessionStorage.key(0)!;
        window.sessionStorage.setItem(
          key,
          mode === "malformed"
            ? "{"
            : JSON.stringify({ defaultsKey: "other", values: {} }),
        );
      }
      if (mode === "blocked") {
        vi.spyOn(
          Object.getPrototypeOf(window.sessionStorage),
          "getItem",
        ).mockImplementation(() => {
          throw new Error("Storage blocked");
        });
        vi.spyOn(
          Object.getPrototypeOf(window.sessionStorage),
          "setItem",
        ).mockImplementation(() => {
          throw new Error("Storage blocked");
        });
      }
      const view = renderHook(() =>
        useContentFiltering(schema, { persistKey: "test-list" }),
      );
      expect(view.result.current.isReady).toBe(true);
      expect(buildFilter(view.result.current, schema)).toEqual({ category: "WEAPON" });
    },
  );

  it("restores each persistence key before it becomes ready and persists resets", () => {
    const schema = makeSchema();
    const renders: { key: string; ready: boolean; category: string }[] = [];
    const view = renderHook(
      ({ key }) => {
        const state = useContentFiltering(schema, { persistKey: key });
        renders.push({ key, ready: state.isReady, category: state.values.category });
        return state;
      },
      { initialProps: { key: "first-list" } },
    );
    act(() => view.result.current.setters.category("ARMOR"));
    view.rerender({ key: "second-list" });
    expect(renders.find((render) => render.key === "second-list")?.ready).toBe(false);
    expect(view.result.current.isReady).toBe(true);
    expect(view.result.current.values.category).toBe("WEAPON");
    view.rerender({ key: "first-list" });
    expect(view.result.current.values.category).toBe("ARMOR");
    act(() => view.result.current.reset());
    expect(view.result.current.isReady).toBe(true);
    view.unmount();
    const remount = renderHook(() =>
      useContentFiltering(schema, { persistKey: "first-list" }),
    );
    expect(remount.result.current.values.category).toBe("WEAPON");
  });

  it("restores a persisted filter when the list mounts again", () => {
    const schema = makeSchema();
    const first = renderHook(() =>
      useContentFiltering(schema, { persistKey: "test-list" }),
    );
    act(() => {
      first.result.current.setters.category("ARMOR");
      first.result.current.setters.level(5);
      first.result.current.setters.hidden(false);
      first.result.current.setExcluded.excludedStats(["Ninjutsu"]);
    });
    first.unmount();

    const second = renderHook(() =>
      useContentFiltering(schema, { persistKey: "test-list" }),
    );
    expect(buildFilter(second.result.current, schema)).toEqual({
      category: "ARMOR",
      level: 5,
      hidden: false,
      excludedStats: ["Ninjutsu"],
    });
    expect(second.result.current.debounced).toEqual(second.result.current.values);
  });

  it("keeps a cleared field cleared instead of restoring its default", () => {
    const schema = makeSchema();
    const first = renderHook(() =>
      useContentFiltering(schema, { persistKey: "test-list" }),
    );
    act(() => first.result.current.setters.category(""));
    first.unmount();

    const second = renderHook(() =>
      useContentFiltering(schema, { persistKey: "test-list" }),
    );
    expect(second.result.current.values.category).toBe("");
  });

  it("ignores a filter saved under other defaults and lists without a key", () => {
    const first = renderHook(() =>
      useContentFiltering(makeSchema(), { persistKey: "test-list" }),
    );
    act(() => first.result.current.setters.stats(["Ninjutsu"]));
    first.unmount();

    const otherDefaults = makeSchema("ARMOR");
    const second = renderHook(() =>
      useContentFiltering(otherDefaults, { persistKey: "test-list" }),
    );
    expect(second.result.current.values.stats).toEqual([]);
    const unkeyed = renderHook(() => useContentFiltering(makeSchema()));
    expect(unkeyed.result.current.values.stats).toEqual([]);
    expect(unkeyed.result.current.isReady).toBe(true);
  });

  it("resets every field and exclusion to the schema defaults", () => {
    const schema = makeSchema();
    const { result } = renderHook(() => useContentFiltering(schema));
    act(() => {
      result.current.setters.name("fire");
      result.current.setters.category("ARMOR");
      result.current.setExcluded.excludedStats(["Ninjutsu"]);
    });
    act(() => result.current.reset());
    expect(buildFilter(result.current, schema)).toEqual({ category: "WEAPON" });
    expect(result.current.excluded).toEqual({ excludedStats: [] });
  });
});

const stableBattleSchema = defineFilteringSchema({
  fields: [battleTypesField(["COMBAT"])] as const,
});
