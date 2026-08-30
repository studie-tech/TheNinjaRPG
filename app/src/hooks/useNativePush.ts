"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/app/_trpc/client";
import {
  safeLocalStorageGetItem,
  safeLocalStorageRemoveItem,
  safeLocalStorageSetItem,
} from "@/hooks/localstorage";
import { isNative, parseNativeUserAgent, push } from "@/libs/native";

/** Token last handed to the server, so a resume does not re-register the same value. */
const LAST_TOKEN_KEY = "native-push-token";

interface UseNativePushOptions {
  /** Register only once the player is signed in; tokens are bound to an account. */
  enabled: boolean;
}

/**
 * Keeps the device's push token in sync with the account and routes notification taps.
 *
 * Mount this exactly once — `NativeBridge` does — because it attaches the plugin
 * listeners. Anything that only needs the permission state should use
 * `useNativePushPermission` instead.
 *
 * Registration is deliberately passive: it asks the OS for a token only when permission
 * has already been granted. Prompting is left to the notification settings panel, because
 * iOS allows the system prompt exactly once and burning it on app launch means a player
 * who taps "Don't Allow" can never be reached again without a trip to Settings.
 */
export const useNativePush = ({ enabled }: UseNativePushOptions) => {
  const router = useRouter();
  const registeredToken = useRef<string | null>(null);

  const registerDevice = api.push.registerDevice.useMutation();
  const unregisterDevice = api.push.unregisterDevice.useMutation();
  const { mutateAsync: sendToken } = registerDevice;

  // Attach listeners before register() — the token arrives as an event, not a return
  // value, so a listener attached afterwards can miss it entirely.
  useEffect(() => {
    if (!isNative() || !enabled) return;

    const unsubscribeRegistration = push.onRegistration(({ token, platform }) => {
      if (registeredToken.current === token) return;
      registeredToken.current = token;
      void sendToken({
        token,
        platform,
        appVersion: parseNativeUserAgent(navigator.userAgent)?.version,
        locale: navigator.language.slice(0, 16),
      })
        .then(() => safeLocalStorageSetItem(LAST_TOKEN_KEY, token))
        .catch(() => {
          // Leave the ref cleared so the next resume retries the handoff.
          registeredToken.current = null;
        });
    });

    const unsubscribeError = push.onRegistrationError((error) => {
      console.warn("Push registration failed", error);
    });

    const unsubscribeTap = push.onActionPerformed((payload) => {
      if (payload.url?.startsWith("/")) router.push(payload.url);
    });

    void push.checkPermissions().then(async (state) => {
      if (state === "granted") await push.register();
    });

    return () => {
      unsubscribeRegistration();
      unsubscribeError();
      unsubscribeTap();
    };
  }, [enabled, router, sendToken]);

  /** Detach this device from the account. Call when the player signs out. */
  const unregister = useCallback(async () => {
    const token = registeredToken.current ?? safeLocalStorageGetItem(LAST_TOKEN_KEY);
    if (!token) return;
    registeredToken.current = null;
    safeLocalStorageRemoveItem(LAST_TOKEN_KEY);
    await unregisterDevice.mutateAsync({ token }).catch(() => undefined);
  }, [unregisterDevice]);

  return { unregister };
};

/**
 * Permission state only — no listeners, so it is safe to mount alongside `useNativePush`.
 */
export const useNativePushPermission = () => {
  const [permission, setPermission] = useState<push.PermissionState>("prompt");

  useEffect(() => {
    if (!isNative()) return;
    void push.checkPermissions().then(setPermission);
  }, []);

  /**
   * Show the system prompt and ask for a token on approval. The token itself arrives on
   * the `registration` event that `useNativePush` is already listening for.
   */
  const requestPermission = useCallback(async () => {
    if (!isNative()) return "denied" as const;
    const state = await push.requestPermissions();
    setPermission(state);
    if (state === "granted") await push.register();
    return state;
  }, []);

  return { isSupported: isNative(), permission, requestPermission };
};
