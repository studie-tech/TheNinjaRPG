"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/app/_trpc/client";
import {
  safeLocalStorageGetItem,
  safeLocalStorageRemoveItem,
  safeLocalStorageSetItem,
} from "@/hooks/localstorage";
import {
  appEvents,
  isNative,
  parseNativeUserAgent,
  push,
  toSafePath,
} from "@/libs/native";

/** Token last handed to the server, so a resume does not re-register the same value. */
const LAST_TOKEN_KEY = "native-push-token";
/** Widget credential the server minted for this device, kept for the snapshot writes. */
const WIDGET_TOKEN_KEY = "native-widget-token";
/** Account allowed to serialize the widget credential into its native snapshot. */
const WIDGET_TOKEN_OWNER_KEY = "native-widget-token-owner";
/** Rotating proof used only to conditionally detach the row created by the last bind. */
const OWNER_TOKEN_KEY = "native-push-owner-token";

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
/** Serialises ownership changes for the one OS token shared by every account on a phone. */
let registrationQueue: Promise<void> = Promise.resolve();

interface UseNativePushOptions {
  /** Register only once the player is signed in; tokens are bound to an account. */
  enabled: boolean;
  /**
   * Whose session this is. Only a dependency: it restarts registration when one account
   * replaces another without a signed-out gap in between, which `enabled` alone misses.
   */
  accountId?: string | null;
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
export const useNativePush = ({ enabled, accountId }: UseNativePushOptions) => {
  const router = useRouter();
  const registeredToken = useRef<string | null>(null);

  const registerDevice = api.push.registerDevice.useMutation();
  const unregisterDevice = api.push.unregisterDevice.useMutation();
  const { mutateAsync: sendToken } = registerDevice;
  const { mutateAsync: detachToken } = unregisterDevice;
  /** The account the effect last ran for, so a swap can be told from a first run. */
  const lastAccount = useRef<string | null | undefined>(undefined);
  // State, not just localStorage: the widget snapshot effect has to re-run once this
  // exists, and a ref would not wake it.
  const [widgetToken, setWidgetToken] = useState<string | undefined>(
    () => safeLocalStorageGetItem(WIDGET_TOKEN_KEY) ?? undefined,
  );
  const [widgetTokenOwner, setWidgetTokenOwner] = useState<string | undefined>(
    () => safeLocalStorageGetItem(WIDGET_TOKEN_OWNER_KEY) ?? undefined,
  );

  const detachOwnedDevice = useCallback(async () => {
    const fallbackOwnershipToken =
      safeLocalStorageGetItem(OWNER_TOKEN_KEY) ??
      safeLocalStorageGetItem(WIDGET_TOKEN_KEY) ??
      undefined;
    setWidgetToken(undefined);
    setWidgetTokenOwner(undefined);
    // Stop exposing the previous account's widget credential immediately. The separate
    // owner proof remains until conditional detach succeeds, so a later cleanup can retry.
    safeLocalStorageRemoveItem(WIDGET_TOKEN_KEY);
    safeLocalStorageRemoveItem(WIDGET_TOKEN_OWNER_KEY);
    registeredToken.current = null;

    // Resolve the proof inside the queue. A registration already in flight may be the
    // operation which creates it; resolving before that operation settles would lose the
    // only credential capable of conditionally deleting its row.
    const pending = registrationQueue
      .catch(() => undefined)
      .then(async () => {
        const ownershipToken =
          safeLocalStorageGetItem(OWNER_TOKEN_KEY) ?? fallbackOwnershipToken;
        const token = safeLocalStorageGetItem(LAST_TOKEN_KEY);
        if (!token || !ownershipToken) return undefined;
        await detachToken({ token, widgetToken: ownershipToken });
        return { ownershipToken, token };
      })
      .then((detached) => {
        if (!detached) return;
        // Do not erase credentials which a newer successful bind has replaced.
        if (safeLocalStorageGetItem(LAST_TOKEN_KEY) === detached.token) {
          safeLocalStorageRemoveItem(LAST_TOKEN_KEY);
        }
        if (safeLocalStorageGetItem(OWNER_TOKEN_KEY) === detached.ownershipToken) {
          safeLocalStorageRemoveItem(OWNER_TOKEN_KEY);
        }
      })
      .catch(() => {
        // Kept, so the next handoff, sign-out, or bind can try the detach again.
      });
    registrationQueue = pending.then(
      () => undefined,
      () => undefined,
    );
    await pending;
  }, [detachToken]);

  // Account identity changes have to invalidate the old session even while registration is
  // disabled because the replacement profile has not loaded yet. In a direct A-to-B swap,
  // detach A now; B's eventual bind joins the same queue and cannot overtake it.
  useEffect(() => {
    if (!isNative()) return;
    const previousAccount = lastAccount.current;
    if (previousAccount === undefined) {
      lastAccount.current = accountId;
      return;
    }
    if (previousAccount === accountId) return;

    registrationEpoch += 1;
    lastAccount.current = accountId;
    if (previousAccount && accountId) void detachOwnedDevice();
  }, [accountId, detachOwnedDevice]);

  // Attach listeners before register() — the token arrives as an event, not a return
  // value, so a listener attached afterwards can miss it entirely.
  useEffect(() => {
    if (!isNative() || !enabled) return;

    // A new registration session invalidates callbacks from the account/session which just
    // ended. Ownership-token detaches do not use this epoch: they remain in the shared queue
    // and are safe to finish because the server applies them conditionally.
    registrationEpoch += 1;

    const unsubscribeRegistration = push.onRegistration(({ token, platform }) => {
      if (registeredToken.current === token) return;
      registeredToken.current = token;
      const epoch = registrationEpoch;
      const pending = registrationQueue
        .catch(() => undefined)
        .then(async () => {
          // If this request has not started yet, a newer account owns the token now. Do
          // not authenticate the old task with the new Clerk session.
          if (epoch !== registrationEpoch) return undefined;
          return await sendToken({
            token,
            platform,
            appVersion: parseNativeUserAgent(navigator.userAgent)?.version,
            locale: navigator.language.slice(0, 16),
          });
        })
        .then((result) => {
          if (!result) return;
          // Persist the conditional cleanup proof even if the session changed while the
          // server bind was in flight. The detach queued behind this operation needs it to
          // remove the now-stale row; it is never exposed as a replacement account's widget
          // credential unless the epoch still matches below.
          safeLocalStorageSetItem(LAST_TOKEN_KEY, token);
          if (result.widgetToken) {
            safeLocalStorageSetItem(OWNER_TOKEN_KEY, result.widgetToken);
          }
          if (epoch !== registrationEpoch) return;
          if (result.widgetToken && accountId) {
            safeLocalStorageSetItem(WIDGET_TOKEN_KEY, result.widgetToken);
            safeLocalStorageSetItem(WIDGET_TOKEN_OWNER_KEY, accountId);
            setWidgetToken(result.widgetToken);
            setWidgetTokenOwner(accountId);
          }
        })
        .catch(() => {
          // Leave the ref cleared so the next resume retries the handoff.
          if (epoch === registrationEpoch) registeredToken.current = null;
        });
      registrationQueue = pending.then(
        () => undefined,
        () => undefined,
      );
      void pending;
    });

    const unsubscribeError = push.onRegistrationError((error) => {
      console.warn("Push registration failed", error);
    });

    const unsubscribeTap = push.onActionPerformed((payload) => {
      const path = toSafePath(payload.url);
      if (path) router.push(path);
    });

    const requestRegistration = async () => {
      const state = await push.checkPermissions();
      if (state === "granted") await push.register();
    };

    void requestRegistration();
    const unsubscribeState = appEvents.onStateChange((isActive) => {
      // A successful handoff keeps this ref populated. Its failure path clears it, so the
      // next foreground transition asks the OS to emit the token again and retries the
      // server bind instead of leaving notifications disabled until a process restart.
      if (isActive && registeredToken.current === null) void requestRegistration();
    });

    return () => {
      unsubscribeRegistration();
      unsubscribeError();
      unsubscribeTap();
      unsubscribeState();
    };
  }, [accountId, enabled, router, sendToken]);

  /** Detach this device from the account. Call when the player signs out. */
  const unregister = useCallback(async () => {
    // Invalidate first, so a registration racing this cannot write its result back after
    // the row has been deleted.
    registrationEpoch += 1;
    await detachOwnedDevice();
  }, [detachOwnedDevice]);

  return {
    unregister,
    widgetToken: accountId && widgetTokenOwner === accountId ? widgetToken : undefined,
  };
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
