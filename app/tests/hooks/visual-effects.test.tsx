import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { useVisualEffects } from "@/hooks/visual-effects";
import { VISUAL_EFFECT_KEYS, readVisualEffects, subscribeVisualEffects } from "@/libs/visualEffects";

const OverlayProbe = () => {
  const { visualEffects: { dayNight: showDayNightMapOverlays } } = useVisualEffects();
  return <div data-enabled={showDayNightMapOverlays}>{String(showDayNightMapOverlays)}</div>;
};

describe("useVisualEffects", () => {
  afterEach(cleanup);
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("enables all seven independent effects by default", () => {
    const { result } = renderHook(() => useVisualEffects());
    expect(Object.keys(result.current.visualEffects)).toHaveLength(7);
    expect(Object.values(result.current.visualEffects).every(Boolean)).toBe(true);
  });

  it("keeps server markup stable when the stored client preference is false", () => {
    window.localStorage.setItem(VISUAL_EFFECT_KEYS.dayNight, "false");

    expect(renderToString(<OverlayProbe />)).toBe(
      '<div data-enabled="true">true</div>',
    );
  });

  it("applies the persisted preference after hydration", async () => {
    window.localStorage.setItem(VISUAL_EFFECT_KEYS.dayNight, "false");
    const { result } = renderHook(() => useVisualEffects());

    await waitFor(() => {
      expect(result.current.visualEffects.dayNight).toBe(false);
    });
  });

  it("synchronizes updates between hook instances on the same page", () => {
    const first = renderHook(() => useVisualEffects());
    const second = renderHook(() => useVisualEffects());

    act(() => first.result.current.setVisualEffect("dayNight", false));

    expect(second.result.current.visualEffects.dayNight).toBe(false);
    expect(window.localStorage.getItem(VISUAL_EFFECT_KEYS.dayNight)).toBe(
      "false",
    );
  });

  it("updates active renderer subscribers for each independent effect and removes listeners", () => {
    const hook = renderHook(() => useVisualEffects());
    const changes: unknown[] = [];
    const unsubscribe = subscribeVisualEffects((...change) => changes.push(change));
    for (const effect of ["shadows", "weather", "wind", "spriteAnimations", "sunlight", "localLights"] as const) {
      act(() => hook.result.current.setVisualEffect(effect, false));
      expect(hook.result.current.visualEffects[effect]).toBe(false);
      expect(window.localStorage.getItem(VISUAL_EFFECT_KEYS[effect])).toBe("false");
    }
    expect(hook.result.current.visualEffects.dayNight).toBe(true);
    expect(changes).toHaveLength(6);
    unsubscribe();
    act(() => hook.result.current.setVisualEffect("shadows", true));
    expect(changes).toHaveLength(6);
  });

  it("keeps combined opt-outs saved before the effects were split", () => {
    window.localStorage.setItem(VISUAL_EFFECT_KEYS.dayNight, "false");
    window.localStorage.setItem(VISUAL_EFFECT_KEYS.spriteAnimations, "false");
    expect(readVisualEffects()).toMatchObject({ sunlight: false, dayNight: false, localLights: false, shadows: true, weather: false, wind: false, spriteAnimations: false });
    window.localStorage.setItem(VISUAL_EFFECT_KEYS.sunlight, "true");
    window.localStorage.setItem(VISUAL_EFFECT_KEYS.wind, "true");
    expect(readVisualEffects()).toMatchObject({ sunlight: true, localLights: false, weather: false, wind: true });
  });

  it("keeps split effects independent after reloading a changed combined key", () => {
    const hook = renderHook(() => useVisualEffects());
    act(() => hook.result.current.setVisualEffect("spriteAnimations", false));
    act(() => hook.result.current.setVisualEffect("dayNight", false));
    expect(readVisualEffects()).toMatchObject({ sunlight: true, dayNight: false, localLights: true, weather: true, wind: true, spriteAnimations: false });
    window.localStorage.clear();
    window.localStorage.setItem(VISUAL_EFFECT_KEYS.spriteAnimations, "false");
    act(() => hook.result.current.setVisualEffect("spriteAnimations", true));
    expect(readVisualEffects()).toMatchObject({ weather: false, wind: false, spriteAnimations: true });
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
