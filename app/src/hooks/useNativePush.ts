"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/app/_trpc/client";
import {
  safeLocalStorageGetItem,
  safeLocalStorageRemoveItem,
  safeLocalStorageSetItem,
} from "@/hooks/localstorage";
import { isNative, parseNativeUserAgent, push, toSafePath } from "@/libs/native";

/** Token last handed to the server, so a resume does not re-register the same value. */
const LAST_TOKEN_KEY = "native-push-token";
/** Widget credential the server minted for this device, kept for the snapshot writes. */
const WIDGET_TOKEN_KEY = "native-widget-token";

/**
 * Bumped on every unregister, so a registration still in flight can tell that the account
 * it was for has since signed out.
 *
 * Module scope rather than a ref on purpose: signing out unmounts the tree that owns this
 * hook, so a ref would be discarded and recreated at zero by the next mount — leaving the
 * in-flight request free to write the previous account's widget token back and hand
 * whoever picks the phone up next a credential for someone else's status.
 */
let registrationEpoch = 0;

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
  const { mutateAsync: detachToken } = unregisterDevice;
  // State, not just localStorage: the widget snapshot effect has to re-run once this
  // exists, and a ref would not wake it.
  const [widgetToken, setWidgetToken] = useState<string | undefined>(
    () => safeLocalStorageGetItem(WIDGET_TOKEN_KEY) ?? undefined,
  );

  // Attach listeners before register() — the token arrives as an event, not a return
  // value, so a listener attached afterwards can miss it entirely.
  useEffect(() => {
    if (!isNative() || !enabled) return;

    const unsubscribeRegistration = push.onRegistration(({ token, platform }) => {
      if (registeredToken.current === token) return;
      registeredToken.current = token;
      const epoch = registrationEpoch;
      void sendToken({
        token,
        platform,
        appVersion: parseNativeUserAgent(navigator.userAgent)?.version,
        locale: navigator.language.slice(0, 16),
      })
        .then((result) => {
          if (epoch !== registrationEpoch) {
            // Signed out while this was in flight. Skipping the local write is not enough:
            // the server has already upserted the row, so the phone is bound to an account
            // that no longer owns it and would go on receiving its notifications. Undo the
            // bind rather than just declining to remember it.
            void detachToken({ token }).catch(() => undefined);
            return;
          }
          safeLocalStorageSetItem(LAST_TOKEN_KEY, token);
          if (result.widgetToken) {
            safeLocalStorageSetItem(WIDGET_TOKEN_KEY, result.widgetToken);
            setWidgetToken(result.widgetToken);
          }
        })
        .catch(() => {
          // Leave the ref cleared so the next resume retries the handoff.
          registeredToken.current = null;
        });
    });

    const unsubscribeError = push.onRegistrationError((error) => {
      console.warn("Push registration failed", error);
    });

    const unsubscribeTap = push.onActionPerformed((payload) => {
      const path = toSafePath(payload.url);
      if (path) router.push(path);
    });

    void push.checkPermissions().then(async (state) => {
      if (state === "granted") await push.register();
    });

    return () => {
      unsubscribeRegistration();
      unsubscribeError();
      unsubscribeTap();
    };
  }, [detachToken, enabled, router, sendToken]);

  /** Detach this device from the account. Call when the player signs out. */
  const unregister = useCallback(async () => {
    // Invalidate first, so a registration racing this cannot write its result back after
    // the row has been deleted.
    registrationEpoch += 1;
    setWidgetToken(undefined);
    // The widget credential belongs to the account being left, and nothing below needs it.
    safeLocalStorageRemoveItem(WIDGET_TOKEN_KEY);
    const token = registeredToken.current ?? safeLocalStorageGetItem(LAST_TOKEN_KEY);
    if (!token) return;
    registeredToken.current = null;
    try {
      await detachToken({ token });
      // Only once the row is actually gone. Discarding the token first and swallowing the
      // failure would leave the device bound to the account with the one credential that
      // could detach it already thrown away.
      safeLocalStorageRemoveItem(LAST_TOKEN_KEY);
    } catch {
      // Kept, so the next sign-out or launch can try the detach again.
    }
  }, [detachToken]);

  return { unregister, widgetToken };
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
