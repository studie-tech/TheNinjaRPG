/**
 * Native Sign in with Apple.
 *
 * Guideline 4.8 requires an equivalent login option wherever a third-party social login is
 * offered, and the system sheet is the only version Apple accepts on iOS. The
 * `tnr-apple-auth` plugin runs `ASAuthorizationAppleIDProvider` and returns the identity
 * token; `useAppleSignIn` exchanges it for a Clerk session with the `oauth_token_apple`
 * strategy, so nothing downstream of the session changes.
 */

import { hasPlugin, invoke, isNative } from "./bridge";

const PLUGIN = "TNRAppleAuth";

export interface AppleCredential {
  /** JWT to hand to Clerk. */
  identityToken: string;
  /** Stable Apple user identifier. */
  user: string;
  /** Only present on the very first authorisation, and only if the player shared it. */
  email?: string;
  givenName?: string;
  familyName?: string;
}

export const isSupported = (): boolean => isNative() && hasPlugin(PLUGIN);

/**
 * Present the system sheet. Rejects if the player cancels, so callers should treat a
 * rejection as a dismissal rather than an error worth reporting.
 */
export const authorize = async (): Promise<AppleCredential> =>
  invoke<AppleCredential>(PLUGIN, "authorize");
