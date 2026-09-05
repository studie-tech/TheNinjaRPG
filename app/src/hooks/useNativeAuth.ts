"use client";

import { useClerk } from "@clerk/nextjs";
import type { SignInResource } from "@clerk/shared/types";
import { useCallback, useState } from "react";
import { appEvents, appleAuth, isNative, oauthBrowser } from "@/libs/native";

/** Where the provider sends the player back to. Registered in both native projects. */
const OAUTH_REDIRECT = "tnr://oauth-callback";

export type NativeAuthResult =
  | { status: "complete" }
  | { status: "cancelled" }
  | { status: "error"; message: string };

/**
 * Sign-in paths that only exist inside the native shell.
 *
 * Two different problems, two different answers:
 *
 * Apple requires the system sheet on iOS, and guideline 4.8 requires an equivalent login
 * option wherever social login is offered. `appleAuth` returns an identity token, which
 * Clerk exchanges for a session through its `oauth_token_apple` strategy.
 *
 * Google rejects OAuth from embedded user agents with `disallowed_useragent`, and the shell
 * is a WebView, so the redirect flow Clerk normally runs in-page cannot work. RFC 8252 says
 * the same for every provider: use the system browser. `signIn.create` hands back the
 * authorization URL instead of navigating, the system browser takes it from there, and the
 * `tnr://` deep link brings the result back.
 *
 * These use Clerk's resource API rather than the `useSignIn` signal hook because
 * `oauth_token_apple` is only accepted there, and because the OAuth URL has to be obtained
 * without navigating the page.
 */
export const useNativeAuth = () => {
  const clerk = useClerk();
  const [isPending, setIsPending] = useState(false);

  const isReady = isNative() && Boolean(clerk.client?.signIn);

  /**
   * Clerk keeps sign-in and sign-up separate, so a first-time player's sign-in comes back
   * "transferable" rather than complete. Transferring is what turns the same OAuth result
   * into an account.
   */
  const completeOrTransfer = useCallback(
    async (result: SignInResource): Promise<NativeAuthResult> => {
      if (result.createdSessionId) {
        await clerk.setActive({ session: result.createdSessionId });
        return { status: "complete" };
      }
      if (result.firstFactorVerification.status === "transferable") {
        const signUp = clerk.client?.signUp;
        if (!signUp) return { status: "error", message: "Sign-up is unavailable" };
        const created = await signUp.create({ transfer: true });
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
      return { status: "error", message: "Sign-in did not complete" };
    },
    [clerk],
  );

  const signInWithApple = useCallback(async (): Promise<NativeAuthResult> => {
    const signIn = clerk.client?.signIn;
    if (!isNative() || !signIn) {
      return { status: "error", message: "Authentication is still loading" };
    }
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
      setIsPending(false);
    }
  }, [clerk, completeOrTransfer]);

  const signInWithProvider = useCallback(
    async (provider: oauthBrowser.ExternalOAuthProvider): Promise<NativeAuthResult> => {
      const signIn = clerk.client?.signIn;
      if (!isNative() || !signIn) {
        return { status: "error", message: "Authentication is still loading" };
      }
      setIsPending(true);
      let stopListening: () => void = () => undefined;
      try {
        const started = await signIn.create({
          strategy: `oauth_${provider}`,
          redirectUrl: OAUTH_REDIRECT,
          actionCompleteRedirectUrl: OAUTH_REDIRECT,
        });
        const target = started.firstFactorVerification.externalVerificationRedirectURL;
        if (!target) {
          return { status: "error", message: "The provider returned no sign-in URL" };
        }

        // Subscribe before opening: on a fast provider the deep link can arrive before the
        // browser sheet has finished animating in. Dismissal is raced against the redirect
        // so a genuine cancellation cannot leave the sign-in pending forever with the
        // buttons disabled — but the two are not mutually exclusive. A successful return
        // closes the sheet as well, and nothing orders the two events, so the dismissal
        // alone says nothing about which happened; that is settled below.
        const outcome = await new Promise<"redirected" | "dismissed">((resolve) => {
          const stopUrl = appEvents.onUrlOpen((url) => {
            if (url.startsWith(OAUTH_REDIRECT)) resolve("redirected");
          });
          const stopFinished = oauthBrowser.onFinished(() => resolve("dismissed"));
          stopListening = () => {
            stopUrl();
            stopFinished();
          };
          void oauthBrowser.open(target.toString()).catch(() => resolve("dismissed"));
        });

        if (outcome === "dismissed") {
          // The sheet closing is not proof the player backed out: the redirect closes it
          // too, and if that event lands first this branch runs on a sign-in Clerk has
          // already advanced. Ask Clerk what happened rather than inferring it from the
          // dismissal, or a completed sign-in is reported as a cancellation and the player
          // is left signed out with a session they cannot see.
          const settled = await signIn.reload().catch(() => null);
          if (
            settled?.createdSessionId ||
            settled?.firstFactorVerification.status === "transferable"
          ) {
            return await completeOrTransfer(settled);
          }
          return { status: "cancelled" };
        }
        await oauthBrowser.close();

        // The sign-in was advanced by the browser, not by this page, so the local copy is
        // stale until it is refetched.
        const reloaded = await signIn.reload();
        return await completeOrTransfer(reloaded);
      } catch (error) {
        return toResult(error);
      } finally {
        stopListening();
        setIsPending(false);
      }
    },
    [clerk, completeOrTransfer],
  );

  return { isReady, isPending, signInWithApple, signInWithProvider };
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
