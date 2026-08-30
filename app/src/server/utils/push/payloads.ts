/**
 * Provider payload shapes, kept free of configuration so they can be asserted directly.
 */

import type { PushMessage } from "./types";

/** The `aps` dictionary plus custom keys for an ordinary alert. */
export const apnsAlertPayload = (message: PushMessage): Record<string, unknown> => ({
  aps: {
    alert: { title: message.title, body: message.body },
    sound: "default",
    "thread-id": message.category,
    ...(message.badge === undefined ? {} : { badge: message.badge }),
  },
  ...(message.url ? { url: message.url } : {}),
  ...(message.data ?? {}),
});

/**
 * An FCM HTTP v1 `message`. Its `data` map only carries strings — a number anywhere in
 * there fails the whole send with INVALID_ARGUMENT — so every value is a string here.
 */
export const fcmMessage = (
  token: string,
  message: PushMessage,
): Record<string, unknown> => ({
  token,
  notification: { title: message.title, body: message.body },
  data: {
    category: message.category,
    ...(message.url ? { url: message.url } : {}),
    ...(message.data ?? {}),
  },
  android: {
    priority: "HIGH",
    ...(message.collapseId ? { collapse_key: message.collapseId } : {}),
    notification: {
      // Channels are declared by the shell; one per entry in PUSH_CATEGORIES.
      channel_id: message.category,
      click_action: "TNR_NOTIFICATION_CLICK",
      ...(message.badge === undefined ? {} : { notification_count: message.badge }),
    },
  },
});
