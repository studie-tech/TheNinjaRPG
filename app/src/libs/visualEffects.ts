import { safeLocalStorageGetItem, safeLocalStorageSetItem } from "@/utils/storage";

/** Independent device preferences shared by settings and renderers. */
export const VISUAL_EFFECT_KEYS = {
  sunlight: "showWorldSunlight",
  dayNight: "showDayNightMapOverlays",
  localLights: "showWorldLocalLights",
  shadows: "showWorldShadows",
  weather: "showWorldWeather",
  wind: "showWorldWind",
  spriteAnimations: "showGameAnimations",
  wildlife: "showWorldWildlife",
} as const;

/** One independently persisted visual control. */
export type VisualEffect = keyof typeof VISUAL_EFFECT_KEYS;
/** Complete preference snapshot; each control retains its own stored choice. */
export type VisualEffects = Record<VisualEffect, boolean>;

/** New devices enable every effect; saved device preferences override individual choices. */
export const DEFAULT_VISUAL_EFFECTS: VisualEffects = {
  sunlight: true,
  dayNight: true,
  localLights: true,
  shadows: true,
  weather: true,
  wind: true,
  spriteAnimations: true,
  wildlife: true,
};

/**
 * Materialize missing split choices from saved groups; explicit split preferences win.
 * New devices and malformed values default on. Persisting each split prevents later
 * day/night or sprite toggles from recoupling the migrated sibling choices.
 */
export const readVisualEffects = (): VisualEffects => {
  const effects = Object.fromEntries(
    Object.entries(VISUAL_EFFECT_KEYS).map(([effect, key]) => [
      effect,
      safeLocalStorageGetItem(key) !== "false",
    ]),
  ) as VisualEffects;
  for (const [effect, group] of [
    ["sunlight", "dayNight"],
    ["localLights", "dayNight"],
    ["weather", "spriteAnimations"],
    ["wind", "spriteAnimations"],
    ["wildlife", "spriteAnimations"],
  ] as const) {
    const key = VISUAL_EFFECT_KEYS[effect];
    if (safeLocalStorageGetItem(key) === null) {
      effects[effect] = effects[group];
      safeLocalStorageSetItem(key, JSON.stringify(effects[effect]));
    }
  }
  return effects;
};

/** Publishes immediately to active scenes, including when browser storage is unavailable. */
export const setVisualEffect = (effect: VisualEffect, enabled: boolean) => {
  // Save sibling choices before changing a key also used by a grouped preference.
  readVisualEffects();
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
