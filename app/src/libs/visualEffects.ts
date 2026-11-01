import { safeLocalStorageGetItem, safeLocalStorageSetItem } from "@/hooks/localstorage";

/** Device preferences shared by settings and renderers; lighting retains the saved map preference. */
export const VISUAL_EFFECT_KEYS = {
  lighting: "showDayNightMapOverlays",
  shadows: "showWorldShadows",
  animations: "showGameAnimations",
} as const;

export type VisualEffect = keyof typeof VISUAL_EFFECT_KEYS;
export type VisualEffects = Record<VisualEffect, boolean>;

/** Missing or malformed preferences keep the full visual presentation enabled. */
export const readVisualEffects = (): VisualEffects => ({
  lighting: safeLocalStorageGetItem(VISUAL_EFFECT_KEYS.lighting) !== "false",
  shadows: safeLocalStorageGetItem(VISUAL_EFFECT_KEYS.shadows) !== "false",
  animations: safeLocalStorageGetItem(VISUAL_EFFECT_KEYS.animations) !== "false",
});

/** Publishes immediately to active scenes, including when browser storage is unavailable. */
export const setVisualEffect = (effect: VisualEffect, enabled: boolean) => {
  const key = VISUAL_EFFECT_KEYS[effect];
  const value = JSON.stringify(enabled);
  safeLocalStorageSetItem(key, value);
  window.dispatchEvent(
    new window.CustomEvent("localStorageSync", { detail: { key, value } }),
  );
};

/** Uses the same storage events as layout preferences without sending frame updates through React. */
export const subscribeVisualEffects = (
  onChange: (effect: VisualEffect, enabled: boolean) => void,
) => {
  const sync = (key: string | null, value: string | null) => {
    for (const effect of Object.keys(VISUAL_EFFECT_KEYS) as VisualEffect[]) {
      if (key === null || key === VISUAL_EFFECT_KEYS[effect])
        onChange(effect, value !== "false");
    }
  };
  const storage = (event: StorageEvent) => {
    if (event.storageArea === null || event.storageArea === window.localStorage)
      sync(event.key, event.newValue);
  };
  const local = (event: Event) => {
    const { key, value } = (event as CustomEvent<{ key: string; value: string }>)
      .detail;
    sync(key, value);
  };
  window.addEventListener("storage", storage);
  window.addEventListener("localStorageSync", local);
  return () => {
    window.removeEventListener("storage", storage);
    window.removeEventListener("localStorageSync", local);
  };
};
