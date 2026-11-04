import { safeLocalStorageGetItem, safeLocalStorageSetItem } from "@/hooks/localstorage";

/** Independent device preferences shared by settings and renderers. */
export const VISUAL_EFFECT_KEYS = {
  sunlight: "showWorldSunlight",
  dayNight: "showDayNightMapOverlays",
  localLights: "showWorldLocalLights",
  shadows: "showWorldShadows",
  weather: "showWorldWeather",
  wind: "showWorldWind",
  spriteAnimations: "showGameAnimations",
} as const;

export type VisualEffect = keyof typeof VISUAL_EFFECT_KEYS;
export type VisualEffects = Record<VisualEffect, boolean>;

export const DEFAULT_VISUAL_EFFECTS: VisualEffects = {
  sunlight: true,
  dayNight: true,
  localLights: true,
  shadows: true,
  weather: true,
  wind: true,
  spriteAnimations: true,
};

/** Effects split from a combined setting keep its saved opt-out until they are saved themselves. */
const LEGACY_VISUAL_EFFECTS: Partial<Record<VisualEffect, VisualEffect>> = {
  sunlight: "dayNight",
  localLights: "dayNight",
  weather: "spriteAnimations",
  wind: "spriteAnimations",
};

const readPreference = (key: string) => safeLocalStorageGetItem(key) !== "false";

/** Missing or malformed preferences keep the full visual presentation enabled. */
export const readVisualEffects = (): VisualEffects =>
  Object.fromEntries(
    (Object.entries(VISUAL_EFFECT_KEYS) as [VisualEffect, string][]).map(
      ([effect, key]) => {
        const legacy = LEGACY_VISUAL_EFFECTS[effect];
        return [
          effect,
          readPreference(
            legacy && safeLocalStorageGetItem(key) === null
              ? VISUAL_EFFECT_KEYS[legacy]
              : key,
          ),
        ];
      },
    ),
  ) as VisualEffects;

/** Publishes immediately to active scenes, including when browser storage is unavailable. */
export const setVisualEffect = (effect: VisualEffect, enabled: boolean) => {
  const key = VISUAL_EFFECT_KEYS[effect];
  const value = JSON.stringify(enabled);
  // Pin inherited effects first so this choice no longer changes them after a reload.
  const current = readVisualEffects();
  for (const [split, legacy] of Object.entries(LEGACY_VISUAL_EFFECTS)) {
    const splitKey = VISUAL_EFFECT_KEYS[split as VisualEffect];
    if (legacy === effect && safeLocalStorageGetItem(splitKey) === null)
      safeLocalStorageSetItem(splitKey, JSON.stringify(current[split as VisualEffect]));
  }
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
