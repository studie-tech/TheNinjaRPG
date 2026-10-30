import { z } from "zod";

/**
 * Battle hotkeys bind a key to an action id, never to a slot: the action list
 * changes mid-fight (stealth, disarm, summon prevention), so a slot-based key
 * would silently fire a different action. Jutsu loadouts hold the keys for their
 * jutsu and the basic actions; item loadouts hold the keys for their items.
 */
export type HotkeyMap = Record<string, string>;

export type HotkeyKind = "jutsu" | "item";

/** Keys that can be bound: letters, digits and a few punctuation keys. */
export const HOTKEY_KEYS = [
  ..."abcdefghijklmnopqrstuvwxyz",
  ..."0123456789",
  "-",
  "=",
  "[",
  "]",
  ";",
  "'",
  ",",
  ".",
  "/",
] as const;

/** Basic action ids that can carry a key, in the order players see them. */
export const BASIC_HOTKEY_ACTIONS = [
  { id: "basicAttack", name: "Basic Attack" },
  { id: "move", name: "Move" },
  { id: "basicHeal", name: "Basic Heal" },
  { id: "meditate", name: "Meditate" },
  { id: "clear", name: "Clear" },
  { id: "cleanse", name: "Cleanse" },
  { id: "offensiveStance", name: "Offensive Stance" },
  { id: "defensiveStance", name: "Defensive Stance" },
  { id: "replacementTechnique", name: "Replacement Technique" },
  { id: "flee", name: "Flee" },
  { id: "wait", name: "End Turn" },
] as const;

/** Keys the basics start with; a loadout's own entries override them. */
export const DEFAULT_BASIC_HOTKEYS: HotkeyMap = {
  wait: "w",
  move: "m",
  basicAttack: "a",
  basicHeal: "h",
};

export const MAX_LOADOUT_HOTKEYS = 60;

/** A stored map: action id → key, or "" to clear a default. */
export const hotkeyMapSchema = z
  .record(z.string().min(1).max(191), z.union([z.enum(HOTKEY_KEYS), z.literal("")]))
  .refine((map) => Object.keys(map).length <= MAX_LOADOUT_HOTKEYS, {
    message: `At most ${MAX_LOADOUT_HOTKEYS} hotkeys per loadout`,
  });

/** Normalize a keyboard event key, or undefined when it cannot be bound. */
export const toHotkey = (key: string): string | undefined => {
  const lower = key.length === 1 ? key.toLowerCase() : key;
  return (HOTKEY_KEYS as readonly string[]).includes(lower) ? lower : undefined;
};

/**
 * Bind `key` to `actionId` within one loadout's map; "" removes the binding.
 * Any other action in the same map that held the key loses it.
 */
export const assignHotkey = (
  map: HotkeyMap,
  actionId: string,
  key: string,
  defaults: HotkeyMap = {},
) => {
  const effective = { ...defaults, ...map };
  const displaced = key
    ? Object.keys(effective).filter((id) => id !== actionId && effective[id] === key)
    : [];
  const next: HotkeyMap = { ...map, [actionId]: key };
  for (const id of displaced) next[id] = "";
  // Drop entries that just restate a default or clear a non-default.
  for (const [id, value] of Object.entries(next)) {
    if ((defaults[id] ?? "") === value) delete next[id];
  }
  return { map: next, displaced };
};

/** Find a key used by the other kind in any saved loadout, including basic defaults. */
export const findLoadoutHotkeyConflict = (
  kind: HotkeyKind,
  map: HotkeyMap,
  otherLoadouts: { name: string; hotkeys: HotkeyMap | null }[],
) => {
  const keys = new Set(
    Object.values(kind === "jutsu" ? { ...DEFAULT_BASIC_HOTKEYS, ...map } : map).filter(
      Boolean,
    ),
  );
  // Basic actions remain available even before a jutsu loadout has been created.
  const loadouts =
    kind === "item" && otherLoadouts.length === 0
      ? [{ name: "", hotkeys: {} }]
      : otherLoadouts;
  for (const [index, loadout] of loadouts.entries()) {
    const otherMap =
      kind === "item"
        ? { ...DEFAULT_BASIC_HOTKEYS, ...loadout.hotkeys }
        : (loadout.hotkeys ?? {});
    for (const [actionId, key] of Object.entries(otherMap)) {
      if (key && keys.has(key)) {
        const label = kind === "item" ? "jutsu" : "item";
        return {
          actionId,
          key,
          loadoutName: `${label} loadout "${loadout.name || `Loadout ${index + 1}`}"`,
        };
      }
    }
  }
  return undefined;
};

/**
 * Effective bindings for a battle: basic defaults, then the active jutsu
 * loadout, then the active item loadout. Returns both lookup directions; a key
 * claimed twice across the two loadouts goes to the jutsu loadout.
 */
export const resolveHotkeys = (
  jutsuMap: HotkeyMap | null | undefined,
  itemMap: HotkeyMap | null | undefined,
) => {
  const byAction: HotkeyMap = {};
  const byKey: HotkeyMap = {};
  const add = (map: HotkeyMap) => {
    for (const [actionId, key] of Object.entries(map)) {
      if (!key || byKey[key] || byAction[actionId]) continue;
      byAction[actionId] = key;
      byKey[key] = actionId;
    }
  };
  add({ ...DEFAULT_BASIC_HOTKEYS, ...(jutsuMap ?? {}) });
  add(itemMap ?? {});
  return { byAction, byKey };
};

/** Display label for a key badge. */
export const hotkeyLabel = (key: string) => key.toUpperCase();
