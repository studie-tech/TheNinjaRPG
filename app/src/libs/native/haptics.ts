/**
 * Haptic feedback. Every call is fire-and-forget: on the web, on a shell without the
 * plugin, or with the player's haptics switch off, it resolves without doing anything.
 */

import { safeLocalStorageGetItem } from "@/hooks/localstorage";
import { invokeSafe } from "./bridge";

/** localStorage key shared with the haptics switch in game settings. */
export const HAPTICS_STORAGE_KEY = "hapticsOn";

export type ImpactStyle = "LIGHT" | "MEDIUM" | "HEAVY";
export type NotificationStyle = "SUCCESS" | "WARNING" | "ERROR";

/** Haptics default to on; only an explicit `false` disables them. */
export const isEnabled = (): boolean => {
  const stored = safeLocalStorageGetItem(HAPTICS_STORAGE_KEY);
  if (stored === null) return true;
  try {
    return JSON.parse(stored) !== false;
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

/** The light tick used while moving through a list or a picker. */
export const selection = async (): Promise<void> => {
  if (!isEnabled()) return;
  await invokeSafe("Haptics", "selectionChanged");
};

/** Duration in milliseconds. Android honours this; iOS plays a fixed system buzz. */
export const vibrate = async (duration = 300): Promise<void> => {
  if (!isEnabled()) return;
  await invokeSafe("Haptics", "vibrate", { duration });
};
