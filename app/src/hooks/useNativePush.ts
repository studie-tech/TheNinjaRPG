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
  /** The registration currently on the wire, so a sign-out can let it land first. */
  const inFlight = useRef<Promise<unknown> | null>(null);

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

  // Attach listeners before register() — the token arrives as an event, not a return
  // value, so a listener attached afterwards can miss it entirely.
  useEffect(() => {
    if (!isNative() || !enabled) return;

    // A new registration session starts here, so anything still in flight belongs to one
    // that has ended: a registration whose result would be written back, or a sign-out's
    // detach, which deletes by token and would otherwise remove the row this session is
    // about to create. Bumping the epoch is what tells them to stand down.
    registrationEpoch += 1;

    // One player replacing another on the same phone, with no signed-out gap to run the
    // cleanup. The device row is keyed on the token, so the handoff has to happen again to
    // move it — but the token is the same token, and the guard below would drop it as a
    // repeat, leaving the row pointing at whoever was here before. Forget the previous
    // session's token so the handoff goes through, and drop the widget credential, which
    // belongs to the account being left. Skipped on the first run, so a relaunch keeps the
    // credential it already had.
    if (lastAccount.current !== undefined && lastAccount.current !== accountId) {
      registeredToken.current = null;
      setWidgetToken(undefined);
      safeLocalStorageRemoveItem(WIDGET_TOKEN_KEY);
    }
    lastAccount.current = accountId;

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
          // Signed out while this was in flight. The detach in `unregister` waits for this
          // promise before deleting, so the row is already gone by now and there is nothing
          // to undo — only the local write to decline.
          if (epoch !== registrationEpoch || !result) return;
          safeLocalStorageSetItem(LAST_TOKEN_KEY, token);
          if (result.widgetToken) {
            safeLocalStorageSetItem(WIDGET_TOKEN_KEY, result.widgetToken);
            setWidgetToken(result.widgetToken);
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
      inFlight.current = pending;
      void pending;
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
  }, [accountId, enabled, router, sendToken]);

  /** Detach this device from the account. Call when the player signs out. */
  const unregister = useCallback(async () => {
    // Invalidate first, so a registration racing this cannot write its result back after
    // the row has been deleted.
    registrationEpoch += 1;
    const epoch = registrationEpoch;
    setWidgetToken(undefined);
    // The widget credential belongs to the account being left, and nothing below needs it.
    safeLocalStorageRemoveItem(WIDGET_TOKEN_KEY);
    // Let a registration already on the wire land before deleting. Deleting first would
    // leave the phone bound when the upsert arrived afterwards; undoing that upsert once it
    // had is worse still, because the token identifies the phone rather than the account,
    // so by then the row can belong to whoever signed in next.
    await inFlight.current?.catch(() => undefined);
    inFlight.current = null;
    const token = registeredToken.current ?? safeLocalStorageGetItem(LAST_TOKEN_KEY);
    if (!token) return;
    registeredToken.current = null;
    // Somebody signed in while the wait above was running. Their registration has already
    // bound this token to them, and the delete is by token rather than by account, so going
    // ahead would unbind the session that is actually here.
    if (epoch !== registrationEpoch) return;
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
