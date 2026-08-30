/**
 * Home screen widgets read a JSON snapshot from the shared container (an iOS App Group,
 * Android shared preferences) rather than calling the API, so they render instantly and
 * without a network round trip. The web app writes that snapshot whenever it has fresh
 * data; `/api/widget/status` is the fallback the widget itself hits when the app has not
 * run in a while.
 */

import { invokeSafe } from "./bridge";

const PLUGIN = "TNRWidgetSync";

export interface WidgetSnapshot {
  /** ISO timestamp the snapshot was taken, so the widget can age out stale data. */
  updatedAt: string;
  /**
   * Bearer credential for `/api/widget/status`, which the widget uses when this snapshot
   * has gone stale. It rides along in the same payload because it lives in the same
   * protected container and the widget needs both together; it is scoped to one device
   * and grants nothing but that device's own status.
   */
  widgetToken?: string;
  username: string;
  avatar?: string;
  village?: string;
  rank?: string;
  level: number;
  curHealth: number;
  maxHealth: number;
  curChakra: number;
  maxChakra: number;
  curStamina: number;
  maxStamina: number;
  /** ISO timestamp the player leaves hospital, when hospitalised. */
  hospitalUntil?: string;
  unreadNotifications: number;
  activeQuest?: string;
  questProgress?: number;
}

/** Write the snapshot and ask the OS to redraw the widgets. */
export const sync = async (snapshot: WidgetSnapshot): Promise<void> => {
  await invokeSafe(PLUGIN, "sync", { snapshot: JSON.stringify(snapshot) });
};

/** Drop the snapshot on sign-out so a signed-out phone stops showing someone's stats. */
export const clear = async (): Promise<void> => {
  await invokeSafe(PLUGIN, "clear");
};
