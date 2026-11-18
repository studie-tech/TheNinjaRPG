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

/**
 * Publishes immediately to active scenes, including when browser storage is unavailable.
 * The effect becomes the player's own choice, which automatic quality never overrides.
 */
export const setVisualEffect = (effect: VisualEffect, enabled: boolean) => {
  // Save sibling choices before changing a key also used by a grouped preference.
  readVisualEffects();
  // Independent markers let tabs choose different effects without overwriting each other.
  safeLocalStorageSetItem(`${CHOSEN_VISUAL_EFFECT_PREFIX}${effect}`, "true");
  publish(VISUAL_EFFECT_KEYS[effect], JSON.stringify(enabled));
};

/**
 * Effects the player has set in settings on this device. Values materialized from defaults
 * or grouped preferences are not choices, so automatic quality may still lower them.
 */
export const readChosenVisualEffects = (): Set<VisualEffect> => {
  return new Set(
    (Object.keys(VISUAL_EFFECT_KEYS) as VisualEffect[]).filter(
      (effect) =>
        safeLocalStorageGetItem(`${CHOSEN_VISUAL_EFFECT_PREFIX}${effect}`) === "true",
    ),
  );
};

/**
 * Renderer detail on this device. Auto bounds canvas pixels and adapts resolution and
 * expensive effects to the measured frame rate; high keeps display density up to 2× and
 * never adapts; low renders at standard density. Effect toggles apply in every mode.
 */
export const RENDER_QUALITIES = ["auto", "high", "low"] as const;
export type RenderQuality = (typeof RENDER_QUALITIES)[number];

/** Reads the saved device quality preference, defaulting missing or malformed values to Auto. */
export const readRenderQuality = (): RenderQuality =>
  parseRenderQuality(safeLocalStorageGetItem(RENDER_QUALITY_KEY));

/** Publishes immediately to active scenes and open settings. */
export const setRenderQuality = (quality: RenderQuality) =>
  publish(RENDER_QUALITY_KEY, JSON.stringify(quality));

/**
 * Identifies a quality preference, effect switches and choices, for state measured under
 * them; the read form takes this device's current storage, however it was changed.
 */
export const visualSettingsKey = (
  quality: RenderQuality,
  effects: VisualEffects,
  chosen: ReadonlySet<VisualEffect>,
) => JSON.stringify([quality, effects, [...chosen].sort()]);

/** Captures stored device preferences to validate the settings attached to session history. */
export const readVisualSettingsKey = () =>
  visualSettingsKey(
    readRenderQuality(),
    readVisualEffects(),
    readChosenVisualEffects(),
  );

/** Follows the player's effect choices from other tabs, which change no effect switch on their own. */
export const subscribeChosenVisualEffects = (onChange: () => void) =>
  subscribeStorage((key) => {
    if (key === null || key.startsWith(CHOSEN_VISUAL_EFFECT_PREFIX)) onChange();
  });

/** Follows quality changes from this and other tabs. */
export const subscribeRenderQuality = (onChange: (quality: RenderQuality) => void) =>
  subscribeStorage((key, value) => {
    if (key === null || key === RENDER_QUALITY_KEY) onChange(parseRenderQuality(value));
  });

/** Publishes effects and same-tab choices, so active scenes honor choices even when storage fails. */
export const subscribeVisualEffects = (
  onChange: (effect: VisualEffect, enabled: boolean, isChoice: boolean) => void,
) =>
  subscribeStorage((key, value, isLocal) => {
    for (const effect of Object.keys(VISUAL_EFFECT_KEYS) as VisualEffect[]) {
      if (key === null || key === VISUAL_EFFECT_KEYS[effect])
        onChange(effect, value !== "false", isLocal === true && key !== null);
    }
  });

const RENDER_QUALITY_KEY = "worldRenderQuality";
const CHOSEN_VISUAL_EFFECT_PREFIX = "worldEffectChoice:";

const parseRenderQuality = (value: string | null): RenderQuality => {
  try {
    const quality: unknown = value === null ? null : JSON.parse(value);
    return RENDER_QUALITIES.find((option) => option === quality) ?? "auto";
  } catch {
    return "auto";
  }
};

const publish = (key: string, value: string) => {
  safeLocalStorageSetItem(key, value);
  window.dispatchEvent(
    new window.CustomEvent("localStorageSync", { detail: { key, value } }),
  );
};

const subscribeStorage = (
  sync: (key: string | null, value: string | null, isLocal?: boolean) => void,
) => {
  const storage = (event: StorageEvent) => {
    if (event.storageArea === null || event.storageArea === window.localStorage)
      sync(event.key, event.newValue);
  };
  const local = (event: Event) => {
    const { key, value } = (event as CustomEvent<{ key: string; value: string }>)
      .detail;
    sync(key, value, true);
  };
  window.addEventListener("storage", storage);
  window.addEventListener("localStorageSync", local);
  return () => {
    window.removeEventListener("storage", storage);
    window.removeEventListener("localStorageSync", local);
  };
};
