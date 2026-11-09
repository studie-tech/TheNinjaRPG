"use client";

import { useClerk } from "@clerk/nextjs";
import type { SignInResource } from "@clerk/nextjs/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNativeAuthHandoff } from "@/hooks/useNativeAuthHandoff";
import { appEvents, appleAuth, isNative, oauthBrowser, platform } from "@/libs/native";
import { createAuthProof } from "@/libs/native/authProof";
import { browserAuthContinuation } from "@/libs/native/deepLink";
import { nativeAuthStartSchema } from "@/validators/nativeAuth";

/** Where the provider sends the player back to. Registered in both native projects. */
const OAUTH_REDIRECT = "tnr://oauth-callback";
const OAUTH_CALLBACK_GRACE_MS = 2000;

export type NativeAuthResult =
  | { status: "complete" }
  | { status: "cancelled" }
  | { status: "error"; message: string };

/** Apple uses its native sheet. Other providers finish in one browser cookie store,
 * then return a one-use PKCE handoff to the shell's own Clerk client. */
export const useNativeAuth = () => {
  const clerk = useClerk();
  const [isPending, setIsPending] = useState(false);
  const handoff = useNativeAuthHandoff();
  const alive = useRef(true);
  const busy = useRef(false);
  const cancelPending = useRef<(() => void) | undefined>(undefined);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      cancelPending.current?.();
    };
  }, []);

  const isReady = isNative() && Boolean(clerk.client?.signIn);

  /**
   * Clerk keeps sign-in and sign-up separate, so a first-time player's sign-in comes back
   * "transferable" rather than complete. Transferring is what turns the same OAuth result
   * into an account.
   */
  const completeOrTransfer = useCallback(
    async (result: SignInResource): Promise<NativeAuthResult> => {
      if (!alive.current) return { status: "cancelled" };
      if (result.createdSessionId) {
        await clerk.setActive({ session: result.createdSessionId });
        return { status: "complete" };
      }
      if (result.firstFactorVerification.status === "transferable") {
        const signUp = clerk.client?.signUp;
        if (!signUp) return { status: "error", message: "Sign-up is unavailable" };
        const created = await signUp.create({ transfer: true });
        if (!alive.current) return { status: "cancelled" };
        if (created.createdSessionId) {
          await clerk.setActive({ session: created.createdSessionId });
          return { status: "complete" };
        }
        return {
          status: "error",
          message:
            "This account needs a few more details. Finish signing up on the web.",
        };
      }
      if (result.firstFactorVerification.error) {
        return toResult({ errors: [result.firstFactorVerification.error] });
      }
      return { status: "error", message: "Sign-in did not complete" };
    },
    [clerk],
  );

  const signInWithApple = useCallback(async (): Promise<NativeAuthResult> => {
    const signIn = clerk.client?.signIn;
    if (!isNative() || !signIn) {
      return { status: "error", message: "Authentication is still loading" };
    }
    if (busy.current) return { status: "cancelled" };
    busy.current = true;
    setIsPending(true);
    try {
      const credential = await appleAuth.authorize();
      const result = await signIn.create({
        strategy: "oauth_token_apple",
        token: credential.identityToken,
      });
      return await completeOrTransfer(result);
    } catch (error) {
      return toResult(error);
    } finally {
      busy.current = false;
      setIsPending(false);
    }
  }, [clerk, completeOrTransfer]);

  const signInWithProvider = useCallback(
    async (provider: oauthBrowser.ExternalOAuthProvider): Promise<NativeAuthResult> => {
      const signIn = clerk.client?.signIn;
      if (!isNative() || !signIn) {
        return { status: "error", message: "Authentication is still loading" };
      }
      const handoffProvider = nativeAuthStartSchema.shape.provider.safeParse(provider);
      if (!handoffProvider.success) {
        return { status: "error", message: "This provider is unavailable" };
      }
      if (busy.current) return { status: "cancelled" };
      busy.current = true;
      setIsPending(true);
      const initialSessionId = clerk.session?.id ?? null;
      let stopListening: () => void = () => undefined;
      let browserOpened = false;
      try {
        const proof = await createAuthProof();
        const { flowId } = await handoff.start({
          provider: handoffProvider.data,
          challenge: proof.challenge,
        });
        if (!alive.current) return { status: "cancelled" };
        const target = new URL("/native-sign-in", window.location.origin);
        target.searchParams.set("flow", flowId);
        const isAndroid = platform() === "android";
        browserOpened = true;
        const wait = waitForOAuthCallback(flowId, target, isAndroid, (cancel) => {
          cancelPending.current = cancel;
        });
        stopListening = wait.stop;
        const callback = await wait.result;
        if (!callback || !alive.current) return { status: "cancelled" };
        const exchanged = await handoff.exchange({
          flowId,
          verifier: proof.verifier,
          code: callback.searchParams.get("code") ?? "",
        });
        if (!alive.current || (clerk.session?.id ?? null) !== initialSessionId) {
          return { status: "cancelled" };
        }
        if (!exchanged.success) return { status: "error", message: exchanged.message };
        const { ticket } = exchanged;
        // This ticket is consumed by the WebView's client, so existing SSR/session
        // cookies, logout and device isolation retain their normal behavior.
        const created = await signIn.create({ strategy: "ticket", ticket });
        const currentSessionId = clerk.session?.id ?? null;
        if (
          !alive.current ||
          (currentSessionId !== initialSessionId &&
            currentSessionId !== created.createdSessionId)
        ) {
          return { status: "cancelled" };
        }
        return await completeOrTransfer(created);
      } catch (error) {
        return toResult(error);
      } finally {
        stopListening();
        if (browserOpened) await oauthBrowser.close();
        cancelPending.current = undefined;
        busy.current = false;
        setIsPending(false);
      }
    },
    [clerk, completeOrTransfer, handoff.exchange, handoff.start],
  );

  return { isReady, isPending, signInWithApple, signInWithProvider };
};

/**
 * Wait for the OAuth browser to hand back this flow's callback. `result` resolves with
 * the callback, or with undefined once the browser is dismissed or the cancel handed to
 * `onCancel` runs; `stop` unsubscribes without settling.
 */
const waitForOAuthCallback = (
  flowId: string,
  target: URL,
  isAndroid: boolean,
  onCancel: (cancel: () => void) => void,
) => {
  let callback: URL | undefined;
  let stopListening: () => void = () => undefined;
  const result = new Promise<URL | undefined>((resolveCallback) => {
    const resolve = () => resolveCallback(callback);
    let settled = false;
    let revision = 0;
    let dismissalTimer: ReturnType<typeof setTimeout> | undefined;
    const clearDismissal = () => {
      revision += 1;
      clearTimeout(dismissalTimer);
    };
    const finish = () => {
      if (settled) return;
      settled = true;
      clearDismissal();
      resolve();
    };
    // An intermediate App Link can hide the first tab while its replacement is
    // opening. Check the shell after the grace period instead of treating the
    // old tab's browserFinished event as cancellation of the replacement.
    const scheduleDismissal = () => {
      if (settled) return;
      clearDismissal();
      const currentRevision = revision;
      dismissalTimer = setTimeout(() => {
        // Safari's sheet is inside the active iOS app; only browserFinished
        // signals its dismissal. Android's tab runs in another activity.
        if (!isAndroid) {
          finish();
          return;
        }
        void appEvents.getState().then(
          ({ isActive }) => {
            if (currentRevision === revision && isActive) finish();
          },
          () => {
            if (currentRevision === revision) finish();
          },
        );
      }, OAUTH_CALLBACK_GRACE_MS);
    };
    let shellActive = false;
    let pendingContinuation: string | undefined;
    let openingContinuation = false;
    const reopened = new Set<string>();
    const reopenContinuation = () => {
      if (settled || !shellActive || !pendingContinuation || openingContinuation)
        return;
      const url = pendingContinuation;
      pendingContinuation = undefined;
      openingContinuation = true;
      void oauthBrowser
        .open(url)
        .catch(finish)
        .finally(() => {
          openingContinuation = false;
          reopenContinuation();
        });
    };
    onCancel(finish);
    const stopUrl = appEvents.onUrlOpen((url) => {
      if (settled) return;
      const continuation = isAndroid
        ? browserAuthContinuation(url, window.location.origin, flowId)
        : null;
      if (continuation) {
        if (reopened.has(continuation)) return;
        reopened.add(continuation);
        clearDismissal();
        pendingContinuation = continuation;
        // MainActivity must resume and clear the old browser controller before
        // Browser.open can create a replacement controller with the same cookies.
        void appEvents.getState().then(({ isActive }) => {
          if (isActive) shellActive = true;
          reopenContinuation();
        }, finish);
        return;
      }
      const parsed = parseOAuthCallback(url);
      if (
        !parsed ||
        parsed.searchParams.get("flow") !== flowId ||
        !/^[A-Za-z0-9_-]{43}$/.test(parsed.searchParams.get("code") ?? "")
      )
        return;
      callback = parsed;
      finish();
    });
    const stopFinished = oauthBrowser.onFinished(scheduleDismissal);
    const stopState = isAndroid
      ? appEvents.onStateChange((isActive) => {
          shellActive = isActive;
          if (isActive) {
            reopenContinuation();
            scheduleDismissal();
          }
        })
      : () => undefined;
    stopListening = () => {
      settled = true;
      clearDismissal();
      stopUrl();
      stopFinished();
      stopState();
    };
    void oauthBrowser.open(target.toString()).catch(finish);
  });
  return { result, stop: () => stopListening() };
};

/** Only this registered callback belongs to an outstanding native sign-in. */
const parseOAuthCallback = (url: string): URL | null => {
  try {
    const parsed = new URL(url);
    const expected = new URL(OAUTH_REDIRECT);
    return parsed.protocol === expected.protocol &&
      parsed.hostname === expected.hostname &&
      (parsed.pathname === "" || parsed.pathname === "/") &&
      !parsed.username &&
      !parsed.password &&
      !parsed.port
      ? parsed
      : null;
  } catch {
    return null;
  }
};

/**
 * A dismissed sheet is not a failure worth showing an error for; the native plugin marks
 * it, and Clerk's own errors carry a usable message.
 */
const toResult = (error: unknown): NativeAuthResult => {
  if (error instanceof Error && error.message === "cancelled") {
    return { status: "cancelled" };
  }
  const clerkError = (
    error as { errors?: { longMessage?: string; message?: string }[] } | null
  )?.errors?.[0];
  if (clerkError) {
    return {
      status: "error",
      message: clerkError.longMessage ?? clerkError.message ?? "Sign-in failed",
    };
  }
  return {
    status: "error",
    message: error instanceof Error ? error.message : "Sign-in failed",
  };
};
