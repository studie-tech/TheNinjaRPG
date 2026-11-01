import { ensureDom } from "../setup/dom.mjs";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { useVisualEffects } from "@/hooks/visual-effects";
import { VISUAL_EFFECT_KEYS, subscribeVisualEffects } from "@/libs/visualEffects";

const OverlayProbe = () => {
  const { visualEffects: { lighting: showDayNightMapOverlays } } = useVisualEffects();
  return <div data-enabled={showDayNightMapOverlays}>{String(showDayNightMapOverlays)}</div>;
};

describe("useVisualEffects", () => {
  afterEach(cleanup);
  beforeEach(() => {
    ensureDom();
    window.localStorage.clear();
  });

  it("keeps server markup stable when the stored client preference is false", () => {
    window.localStorage.setItem(VISUAL_EFFECT_KEYS.lighting, "false");

    expect(renderToString(<OverlayProbe />)).toBe(
      '<div data-enabled="true">true</div>',
    );
  });

  it("applies the persisted preference after hydration", async () => {
    window.localStorage.setItem(VISUAL_EFFECT_KEYS.lighting, "false");
    const { result } = renderHook(() => useVisualEffects());

    await waitFor(() => {
      expect(result.current.visualEffects.lighting).toBe(false);
    });
  });

  it("synchronizes updates between hook instances on the same page", () => {
    const first = renderHook(() => useVisualEffects());
    const second = renderHook(() => useVisualEffects());

    act(() => first.result.current.setVisualEffect("lighting", false));

    expect(second.result.current.visualEffects.lighting).toBe(false);
    expect(window.localStorage.getItem(VISUAL_EFFECT_KEYS.lighting)).toBe(
      "false",
    );
  });

  it("updates active renderer subscribers for each independent effect and removes listeners", () => {
    const hook = renderHook(() => useVisualEffects());
    const changes: unknown[] = [];
    const unsubscribe = subscribeVisualEffects((...change) => changes.push(change));
    for (const effect of ["shadows", "animations"] as const) {
      act(() => hook.result.current.setVisualEffect(effect, false));
      expect(hook.result.current.visualEffects[effect]).toBe(false);
      expect(window.localStorage.getItem(VISUAL_EFFECT_KEYS[effect])).toBe("false");
    }
    expect(hook.result.current.visualEffects.lighting).toBe(true);
    expect(changes).toEqual([["shadows", false], ["animations", false]]);
    unsubscribe();
    act(() => hook.result.current.setVisualEffect("shadows", true));
    expect(changes).toHaveLength(2);
  });

  it("handles other-tab changes, removed preferences and malformed values", () => {
    const hook = renderHook(() => useVisualEffects());
    const publish = (value: string | null) => act(() => window.dispatchEvent(new window.StorageEvent("storage", { key: VISUAL_EFFECT_KEYS.shadows, newValue: value })));
    publish("false");
    expect(hook.result.current.visualEffects.shadows).toBe(false);
    publish("invalid");
    expect(hook.result.current.visualEffects.shadows).toBe(true);
    publish("false"); publish(null);
    expect(hook.result.current.visualEffects.shadows).toBe(true);
  });
});
