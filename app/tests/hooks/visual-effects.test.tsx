import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { useVisualEffects } from "@/hooks/visual-effects";
import {
  VISUAL_EFFECT_KEYS,
  readVisualEffects,
  setVisualEffect,
  subscribeVisualEffects,
} from "@/libs/visualEffects";

const OverlayProbe = () => {
  const {
    visualEffects: { dayNight: showDayNightMapOverlays },
  } = useVisualEffects();
  return (
    <div data-enabled={showDayNightMapOverlays}>{String(showDayNightMapOverlays)}</div>
  );
};

describe("useVisualEffects", () => {
  afterEach(cleanup);
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("enables all eight independent effects by default", () => {
    const { result } = renderHook(() => useVisualEffects());
    expect(Object.keys(result.current.visualEffects)).toHaveLength(8);
    expect(Object.values(result.current.visualEffects).every(Boolean)).toBe(true);
  });

  it.each(["dayNight", "spriteAnimations"] as const)(
    "inherits the saved %s group only for missing split preferences",
    (group) => {
      window.localStorage.setItem(VISUAL_EFFECT_KEYS[group], "false");
      const effects = readVisualEffects();
      expect(effects).toEqual({
        sunlight: group !== "dayNight",
        dayNight: group !== "dayNight",
        localLights: group !== "dayNight",
        shadows: true,
        weather: group !== "spriteAnimations",
        wind: group !== "spriteAnimations",
        spriteAnimations: group !== "spriteAnimations",
        wildlife: group !== "spriteAnimations",
      });
    },
  );

  it.each([true, false])(
    "preserves explicit split choices over grouped %s",
    (enabled) => {
      for (const effect of ["dayNight", "spriteAnimations"] as const)
        window.localStorage.setItem(VISUAL_EFFECT_KEYS[effect], String(enabled));
      for (const effect of ["sunlight", "weather"] as const)
        window.localStorage.setItem(VISUAL_EFFECT_KEYS[effect], "true");
      for (const effect of ["localLights", "wind"] as const)
        window.localStorage.setItem(VISUAL_EFFECT_KEYS[effect], "false");
      expect(readVisualEffects()).toEqual({
        sunlight: true,
        dayNight: enabled,
        localLights: false,
        shadows: true,
        weather: true,
        wind: false,
        spriteAnimations: enabled,
        wildlife: enabled,
      });
    },
  );

  it.each([true, false])(
    "keeps split choices independent after changing groups from %s and remounting",
    (enabled) => {
      for (const effect of ["dayNight", "spriteAnimations"] as const)
        window.localStorage.setItem(VISUAL_EFFECT_KEYS[effect], String(enabled));
      const hook = renderHook(() => useVisualEffects());
      const changes: unknown[] = [];
      const unsubscribe = subscribeVisualEffects((...change) => changes.push(change));
      try {
        act(() => {
          hook.result.current.setVisualEffect("dayNight", !enabled);
          hook.result.current.setVisualEffect("spriteAnimations", !enabled);
        });
        hook.unmount();
        const remounted = renderHook(() => useVisualEffects());
        expect(remounted.result.current.visualEffects).toEqual({
          sunlight: enabled,
          dayNight: !enabled,
          localLights: enabled,
          shadows: true,
          weather: enabled,
          wind: enabled,
          spriteAnimations: !enabled,
          wildlife: enabled,
        });
        expect(changes).toEqual([
          ["dayNight", !enabled],
          ["spriteAnimations", !enabled],
        ]);
      } finally {
        unsubscribe();
      }
    },
  );

  it.each([true, false])(
    "materializes siblings before a setter changes saved groups from %s",
    (enabled) => {
      for (const effect of ["dayNight", "spriteAnimations"] as const)
        window.localStorage.setItem(VISUAL_EFFECT_KEYS[effect], String(enabled));
      setVisualEffect("dayNight", !enabled);
      setVisualEffect("spriteAnimations", !enabled);
      expect(readVisualEffects()).toEqual({
        sunlight: enabled,
        dayNight: !enabled,
        localLights: enabled,
        shadows: true,
        weather: enabled,
        wind: enabled,
        spriteAnimations: !enabled,
        wildlife: enabled,
      });
    },
  );

  it("keeps fresh-device siblings on when the first action disables the reused keys", () => {
    setVisualEffect("dayNight", false);
    setVisualEffect("spriteAnimations", false);
    expect(readVisualEffects()).toEqual({
      sunlight: true,
      dayNight: false,
      localLights: true,
      shadows: true,
      weather: true,
      wind: true,
      spriteAnimations: false,
      wildlife: true,
    });
  });

  it("keeps malformed preferences enabled without replacing explicit split values", () => {
    window.localStorage.setItem(VISUAL_EFFECT_KEYS.dayNight, "invalid");
    window.localStorage.setItem(VISUAL_EFFECT_KEYS.spriteAnimations, "invalid");
    window.localStorage.setItem(VISUAL_EFFECT_KEYS.sunlight, "invalid");
    expect(Object.values(readVisualEffects()).every(Boolean)).toBe(true);
    expect(window.localStorage.getItem(VISUAL_EFFECT_KEYS.sunlight)).toBe("invalid");
  });

  it("retains defaults and immediate subscribers when storage is unavailable", () => {
    const storage = Object.getPrototypeOf(window.localStorage);
    const read = spyOn(storage, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const write = spyOn(storage, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const changes: unknown[] = [];
    const unsubscribe = subscribeVisualEffects((...change) => changes.push(change));
    try {
      expect(Object.values(readVisualEffects()).every(Boolean)).toBe(true);
      setVisualEffect("wind", false);
      expect(changes).toEqual([["wind", false]]);
    } finally {
      unsubscribe();
      read.mockRestore();
      write.mockRestore();
      warn.mockRestore();
    }
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
    expect(window.localStorage.getItem(VISUAL_EFFECT_KEYS.dayNight)).toBe("false");
  });

  it("updates active renderer subscribers for each independent effect and removes listeners", () => {
    const hook = renderHook(() => useVisualEffects());
    const changes: unknown[] = [];
    const unsubscribe = subscribeVisualEffects((...change) => changes.push(change));
    for (const effect of [
      "shadows",
      "weather",
      "wind",
      "spriteAnimations",
      "sunlight",
      "localLights",
    ] as const) {
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

  it("handles other-tab changes, removed preferences and malformed values", () => {
    const hook = renderHook(() => useVisualEffects());
    const publish = (value: string | null) =>
      act(() =>
        window.dispatchEvent(
          new window.StorageEvent("storage", {
            key: VISUAL_EFFECT_KEYS.shadows,
            newValue: value,
          }),
        ),
      );
    publish("false");
    expect(hook.result.current.visualEffects.shadows).toBe(false);
    publish("invalid");
    expect(hook.result.current.visualEffects.shadows).toBe(true);
    publish("false");
    publish(null);
    expect(hook.result.current.visualEffects.shadows).toBe(true);
  });
});
