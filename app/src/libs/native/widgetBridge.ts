/**
 * Home screen widgets read a JSON snapshot from the shared container (an iOS App Group,
 * Android shared preferences) rather than calling the API, so they render instantly and
 * without a network round trip. The web app writes that snapshot whenever it has fresh
 * data.
 *
 * `/api/widget/status` serves the same figures over HTTP for a widget that fetches them
 * itself. Neither provider does today -- both render the last snapshot the app wrote -- so
 * what a widget shows depends on the app having run recently. That is why the snapshot is
 * written on every meaningful change rather than only at launch.
 */

import { invokeSafe } from "./bridge";

const PLUGIN = "TNRWidgetSync";

export interface WidgetSnapshot {
  /** ISO timestamp the snapshot was taken, so the widget can age out stale data. */
  updatedAt: string;
  /**
   * Bearer credential for `/api/widget/status`, carried for a provider that fetches its
   * own figures rather than waiting for the app to write a snapshot. It rides along in the
   * same payload because it lives in the same protected container; it is scoped to one
   * device and grants nothing but that device's own status.
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
