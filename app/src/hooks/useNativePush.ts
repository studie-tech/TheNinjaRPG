"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/app/_trpc/client";
import { safeLocalStorageGetItem, safeLocalStorageSetItem } from "@/hooks/localstorage";
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
 * Registration is deliberately passive: it asks the OS for a token only when permission
 * has already been granted. Prompting is left to the notification settings panel, because
 * iOS allows the system prompt exactly once and burning it on app launch means a player
 * who taps "Don't Allow" can never be reached again without a trip to Settings.
 */
export const useNativePush = ({ enabled }: UseNativePushOptions) => {
  const router = useRouter();
  const [permission, setPermission] = useState<push.PermissionState>("prompt");
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
      setPermission(state);
      if (state === "granted") await push.register();
    });

    return () => {
      unsubscribeRegistration();
      unsubscribeError();
      unsubscribeTap();
    };
  }, [enabled, router, sendToken]);

  /** Show the system prompt and register on approval. Call from a deliberate action. */
  const requestPermission = useCallback(async () => {
    if (!isNative()) return "denied" as const;
    const state = await push.requestPermissions();
    setPermission(state);
    if (state === "granted") await push.register();
    return state;
  }, []);

  /** Detach this device from the account. Call before signing out. */
  const unregister = useCallback(async () => {
    const token = registeredToken.current ?? safeLocalStorageGetItem(LAST_TOKEN_KEY);
    if (!token) return;
    registeredToken.current = null;
    await unregisterDevice.mutateAsync({ token }).catch(() => undefined);
  }, [unregisterDevice]);

  return {
    isSupported: isNative(),
    permission,
    requestPermission,
    unregister,
  };
};
