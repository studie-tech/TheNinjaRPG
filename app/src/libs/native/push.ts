/**
 * Push registration on the device side.
 *
 * `@capacitor/push-notifications` hands back the raw APNs token on iOS and an FCM
 * registration token on Android; the server keeps them apart by the `platform` column and
 * routes each to its own transport. Nothing here talks to our API — `useNativePush` owns
 * that, so this module stays free of tRPC and React.
 */

import type { PushPlatform } from "@/drizzle/constants";
import { addNativeListener, invoke, isNative } from "./bridge";

const PLUGIN = "PushNotifications";

export type PermissionState = "prompt" | "prompt-with-rationale" | "granted" | "denied";

export interface RegistrationToken {
  token: string;
  platform: Extract<PushPlatform, "ios" | "android">;
}

/** Payload the shell forwards when a notification is tapped or arrives in the foreground. */
export interface PushPayload {
  title?: string;
  body?: string;
  /** Deep link path, e.g. `/battlearena`. Set by the server's notification templates. */
  url?: string;
  data?: Record<string, unknown>;
}

/**
 * Current permission state without prompting. Returns `"denied"` off-device so callers
 * treat the web the same as a player who said no.
 */
export const checkPermissions = async (): Promise<PermissionState> => {
  if (!isNative()) return "denied";
  try {
    const result = await invoke<{ receive: PermissionState }>(
      PLUGIN,
      "checkPermissions",
    );
    return result.receive;
  } catch {
    return "denied";
  }
};

/**
 * Show the system permission prompt. Call this from a deliberate action — a player
 * enabling alerts in settings — never on launch, which burns the one prompt iOS allows.
 */
export const requestPermissions = async (): Promise<PermissionState> => {
  if (!isNative()) return "denied";
  const result = await invoke<{ receive: PermissionState }>(
    PLUGIN,
    "requestPermissions",
  );
  return result.receive;
};

/**
 * Ask the OS for a token. Resolves through the `registration` event rather than a return
 * value, so the listener has to be attached before the call — see `onRegistration`.
 */
export const register = async (): Promise<void> => {
  if (!isNative()) return;
  await invoke(PLUGIN, "register");
};

/** Remove all delivered notifications from the shade. */
export const clearDelivered = async (): Promise<void> => {
  if (!isNative()) return;
  await invoke(PLUGIN, "removeAllDeliveredNotifications");
};

export const onRegistration = (
  callback: (registration: RegistrationToken) => void,
): (() => void) =>
  addNativeListener(PLUGIN, "registration", (data) => {
    const token = (data as { value?: unknown } | null)?.value;
    const platform = (data as { platform?: unknown } | null)?.platform;
    if (typeof token !== "string" || token.length === 0) return;
    callback({
      token,
      platform: platform === "android" ? "android" : "ios",
    });
  });

export const onRegistrationError = (callback: (error: string) => void): (() => void) =>
  addNativeListener(PLUGIN, "registrationError", (data) => {
    const error = (data as { error?: unknown } | null)?.error;
    callback(typeof error === "string" ? error : "Unknown push registration error");
  });

/** Notification delivered while the app is in the foreground. */
export const onReceived = (callback: (payload: PushPayload) => void): (() => void) =>
  addNativeListener(PLUGIN, "pushNotificationReceived", (data) => {
    callback(toPayload(data));
  });

/** Player tapped a notification; the shell has already foregrounded the app. */
export const onActionPerformed = (
  callback: (payload: PushPayload) => void,
): (() => void) =>
  addNativeListener(PLUGIN, "pushNotificationActionPerformed", (data) => {
    const notification = (data as { notification?: unknown } | null)?.notification;
    callback(toPayload(notification));
  });

const toPayload = (raw: unknown): PushPayload => {
  const notification = (raw ?? {}) as {
    title?: unknown;
    body?: unknown;
    data?: unknown;
  };
  const data = (notification.data ?? {}) as Record<string, unknown>;
  const url = data.url;
  return {
    title: typeof notification.title === "string" ? notification.title : undefined,
    body: typeof notification.body === "string" ? notification.body : undefined,
    url: typeof url === "string" ? url : undefined,
    data,
  };
};
