/**
 * Haptic feedback. Every call is fire-and-forget: on the web, on a shell without the
 * plugin, or with the player's haptics switch off, it resolves without doing anything.
 */

import { invokeSafe } from "./bridge";

/** localStorage key shared with the haptics switch in game settings. */
export const HAPTICS_STORAGE_KEY = "hapticsOn";

export type ImpactStyle = "LIGHT" | "MEDIUM" | "HEAVY";
export type NotificationStyle = "SUCCESS" | "WARNING" | "ERROR";

/**
 * Haptics default to on; only an explicit `false` disables them. Storage is read directly
 * so a blocked store stays silent: this runs on every haptic call, including off device.
 */
export const isEnabled = (): boolean => {
  try {
    if (typeof window === "undefined") return false;
    const stored = window.localStorage.getItem(HAPTICS_STORAGE_KEY);
    return stored === null || JSON.parse(stored) !== false;
  } catch {
    return true;
  }
};

/** A physical tap — a landed hit, a charged jutsu, a completed travel leg. */
export const impact = async (style: ImpactStyle = "MEDIUM"): Promise<void> => {
  if (!isEnabled()) return;
  await invokeSafe("Haptics", "impact", { style });
};

/** An outcome — battle won or lost, level up, item obtained. */
export const notify = async (type: NotificationStyle = "SUCCESS"): Promise<void> => {
  if (!isEnabled()) return;
  await invokeSafe("Haptics", "notification", { type });
};
