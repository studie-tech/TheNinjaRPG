// This file configures the initialization of Sentry on the client.
// The config you add here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { initBotId } from "botid/client/core";
import { BOTID_PROTECTED_ROUTES } from "@/libs/botid";
import {
  createPublicBrowserRouteProvider,
  publicBfcacheRouteIntegration,
} from "@/libs/browserRouteTelemetry";
import { stripQueryMetricUserAttributes } from "@/libs/queryTelemetry";
import { SENTRY_BASE_OPTIONS } from "@/libs/sentryOptions";
import {
  isNetworkError as isNetworkErrorPattern,
  isHtmlResponseError as isHtmlResponseErrorPattern,
  isFirefoxJsonError as isFirefoxJsonErrorPattern,
  isProxyError as isProxyErrorPattern,
  isSafariJsonError as isSafariJsonErrorPattern,
  type StackFrame,
  isCookiebotStack,
  isExtensionExecutorEvent,
  isGoogleTagStack,
  isInjectedContentPath,
  isInjectedWalletRejection,
  isMediaFilterPath,
  isPayPalCleanupError,
  isPayPalSdkStack,
  PAYPAL_CLEANUP_PATTERNS,
} from "@/utils/error";

Sentry.init({
  ...SENTRY_BASE_OPTIONS,

  // Session Replay is not registered: the rrweb recorder would cost download, parse and
  // init time on every page load. To enable it, use
  // Sentry.lazyLoadIntegration("replayIntegration") so the recorder is fetched only for
  // sampled sessions.

  beforeSendMetric: stripQueryMetricUserAttributes,
  // Resolve the public URL rather than the internal app/[shell] rewrite. The SDK
  // also uses this provider for target navigations and delayed Web Vital reports.
  routeProvider: createPublicBrowserRouteProvider(() => window.location.href),
  integrations: [publicBfcacheRouteIntegration()],

  // Errors to ignore from the frontend. The SDK matches each string as a substring (and
  // each regex) against the main exception's value and its "type: value" form before
  // beforeSend runs, so an event matched here is dropped whatever its stack, and the
  // scoped checks in beforeSend never see it.
  ignoreErrors: [
    "window.ethereum",
    "Cannot redefine property: walletRouter", // Cryptocurrency wallet extension error - occurs when wallet extensions (MetaMask, Coinbase Wallet, etc.) conflict or reinitialize
    "Cannot redefine property: ScatterJS", // ScatterJS wallet extension error - occurs when Scatter crypto wallet extension conflicts with other web3 providers or attempts to reinitialize. UX: No user-visible impact - error occurs in isolated extension context during wallet initialization. Application continues normally.
    "setExternalProvider is not a function", // Scatter/TronLink wallet extension error - occurs when extension's injected.bundle.js calls missing ethereum.setExternalProvider() method. UX: No user-visible impact - error is isolated to extension's initialization code, application functionality unaffected.
    "ClerkJS: Token refresh failed",
    "Converting circular structure to JSON",
    "Uncaught NetworkError: Failed to execute 'importScripts' on 'WorkerGlobalScope'",
    "CanvasRenderingContext2D.setTransform",
    "Java bridge method invocation error",
    "Java object is gone", // Android WebView JavaScript-Java bridge error - occurs when password managers/autofill services scan for forms and the native component is garbage collected
    "Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node.",
    "The object can not be found here.", // Safari's version of the above removeChild error (DOMException code 8) - DOM modified externally during React reconciliation
    "Failed to execute 'insertBefore' on 'Node': The node before which the new node is to be inserted is not a child of this node.", // DOM modified externally (browser extensions, third-party scripts)
    "GME Provider is disconnected or locked", // timeout error
    "Connection closed", // timeout error
    "The play method is not allowed by the user agent or the platform in the current context, possibly because the user denied permission.", // audio permission denied
    "TypeError: undefined is not an object (evaluating 'this.updateVisibleFocusableElements.bind')", // Cookiebot error: https://github.com/getsentry/sentry-javascript/issues/16850
    "Failed to read a named property 'Element' from 'Window': Blocked a frame with origin \"https://www.theninja-rpg.com\"", // Sentry iframe error?
    "Cannot read properties of undefined (reading 'bind')", // Cookiebot error on resize
    "Cannot read properties of null (reading 'parentNode')", // Cookiebot error in calcFadeState when clicking "More Details"
    "null is not an object (evaluating 'element.parentNode')", // Cookiebot error in calcFadeState (Safari format)
    "UnrecognizedActionError", // New deployment
    "undefined is not an object (evaluating 'e[a].call')", // Somethign internal never seen by user.
    "Hydration Error", // Based on sentry inspection not seen by user
    "Hydration failed - the server rendered HTML didn't match the client.", // Based on sentry inspection not seen by user
    "Hydration failed because the server rendered HTML didn't match the client", // Based on sentry inspection not seen by user
    "https://reactjs.org/docs/error-decoder.html?invariant=418", // There was an error while hydrating...
    "https://reactjs.org/docs/error-decoder.html?invariant=419", // There was an error while hydrating...
    "https://reactjs.org/docs/error-decoder.html?invariant=422", // There was an error while hydrating...
    "https://reactjs.org/docs/error-decoder.html?invariant=423", // There was an error while hydrating...
    "https://reactjs.org/docs/error-decoder.html?invariant=425", // There was an error while hydrating...
    "Can't find variable: __firefox__", // Firefox/iOS browser extension error
    /window\.__firefox__/, // Firefox/Brave browser extension errors (e.g., YouTube quality extensions)
    "Failed to load chunk", // New deployment
    "Invalid call to runtime.sendMessage()", // Browser extension error, not from our app
    "zoid destroyed", // PayPal SDK cleanup errors - occur when users navigate away while PayPal buttons are initializing
    "Target window is closed", // PayPal SDK postrobot error - occurs when user closes popup before transaction completes
    "postrobot_method", // PayPal SDK cross-window communication error - occurs when popup is closed
    "Can not send postrobot", // PayPal SDK postrobot error - alternate format
    "Bootstrap Error for", // PayPal SDK zoid bootstrap errors - occur when PayPal's internal component initialization encounters duplicate listener registration
    "Cannot set properties of undefined (setting 'iframeReady')", // Usercentrics (uc.js) consent management error - third-party script timing issue
    "Cannot set properties of undefined (setting 'windowOnloadTriggered')", // Usercentrics (uc.js) consent management error - race condition in signalWindowLoad on older Chrome Mobile WebView
    /^Load failed/, // iOS Safari network error - occurs when device goes to sleep, network changes, or CDN requests fail (may include domain suffix)
    "Clerk: Failed to load Clerk", // Clerk script load failure - typically on very old browsers (Android 5.x, Chrome 95) that don't support modern JS
    "failed to load script", // Clerk's underlying script loading error (cause of the above) - network issues on mobile devices
    "Can't find variable: EmptyRanges", // Browser extension error (CodeMirror-based extensions)
    "Can't find variable: DarkReader", // DarkReader browser extension error - dark mode extension may fail to initialize
    "xbrowser is not defined", // Browser extension/password manager autofill error - occurs when third-party autofill scripts (browser extensions, Android WebView bridge) reference undefined xbrowser variable
    "swbrowser.inNightMode is not a function", // Browser extension/Android WebView night mode error - occurs when third-party night mode extensions (Android browser forks) attempt to call swbrowser.inNightMode() but the method is undefined or the object is incomplete during page load. Similar to xbrowser errors. No UX handling needed - error occurs in isolated extension context, application continues normally.
    "swbrowser is not defined", // Same night-mode injection when the helper object was never created. The page keeps rendering; nothing in the game calls swbrowser.
    "postMessage is not a function", // Clerk internal error - occurs in clerk.browser.js with Web Workers
    "module factory is not available", // Turbopack runtime error - occurs when browser caches stale JS chunks after deployment
    "Cannot assign to read only property 'then' of object", // Turbopack Promise assignment error - occurs when browser extensions freeze Promise objects or stale caches cause conflicts
    "Failed to connect to MetaMask", // MetaMask extension error - occurs when extension is disabled/uninstalled but inpage.js still runs
    "No extension found with id:", // Browser extension not found error - occurs when any extension (MetaMask, etc.) is disabled after page load
    "ResizeObserver loop limit exceeded", // Benign browser warning from ResizeObserver specification - occurs when Radix UI components (Popover, Select) trigger layout changes during positioning
    "ResizeObserver loop completed with undelivered notifications", // Alternative format of the same benign ResizeObserver warning (used by some browsers)
    "undefined is not an object (evaluating 'window.webkit.messageHandlers')", // iOS WebKit bridge error - third-party scripts attempting to use iOS native bridge APIs that aren't available in web browser context
    "TransformStream is not defined", // Older browser compatibility error (Firefox Mobile <102, some Android browsers) - AI chat feature uses @ai-sdk/react which requires TransformStream for SSE parsing. Users see fallback UX (chat unavailable).
    /No ack for postMessage .* in \d+ms/, // Third-party SDK postMessage timeout - occurs when Clerk or similar services fail to receive acknowledgment for cross-origin frame communication
    "Jsloader error", // Google JS API loader error. The app loads no Google API loader of its own, so the failing loader belongs to a third-party script and no game screen waits on it.
    "Attempt to use history.pushState() more than 100 times per 10 seconds", // Browser security limit on history API - occurs when third-party analytics scripts (Speed Insights, GTM, i18n pixel) exceed rate limit during rapid navigation. Users can navigate normally; only analytics logging is rate-limited.
    "window.setDgResult is not a function", // Third-party bot detection/anti-fraud script error (likely DataDome) - occurs when bot detection services attempt to call undefined callback function on mobile WebView with strict security policies. Users continue signup flow normally; error is isolated to third-party script context.
    /SyntaxError.*Unexpected EOF/, // Truncated script downloads (network issues on mobile). Drops every SyntaxError whose message contains "Unexpected EOF", wherever it was raised; isNextJsChunkSyntaxError handles the other truncation messages from our chunks.
    "JSON.parse: unexpected character at line 1 column 1 of the JSON data", // Firefox JSON parsing error - occurs when tRPC receives non-JSON responses (network issues, CDN outages). Equivalent to Chrome's '"Offline" is not valid JSON' or '"<!DOCTYPE "... is not valid JSON'. Handled by tRPC retry logic in Provider.tsx.
    "Error in input stream", // Firefox stream error - occurs when Firefox's fetch implementation encounters errors reading response streams during Next.js RSC (React Server Components) navigation/prefetch. Common causes: network interruption mid-stream, corrupted CDN response, incomplete RSC payload, browser abort during navigation. This is Firefox's equivalent to Chrome's "Failed to fetch" or Safari's "Load failed". UX: Handled gracefully by Next.js internal retry logic and Firefox's fetch error recovery (marked as handled:yes in Sentry). Users see normal navigation; failed streams fall back to fresh server requests. Detection: handled=yes, no stack trace (browser-level error before JS execution), Firefox browser tag, RSC navigation with _rsc query param.
    "failed to decode cache", // Next.js RSC (React Server Components) cache decoding error - occurs when browser cache contains stale, corrupted, or incomplete RSC payload data from prefetch requests. Common causes: browser cache inconsistency after deployments, network issues during RSC payload download, memory pressure during cleanup, Firefox-specific cache validation. UX: Handled gracefully by Next.js internal retry logic - failed cache reads fall back to fresh server requests. Users may experience slightly slower navigation but no visible error. Detection: minimal stack trace, global error handler mechanism, recent RSC prefetch breadcrumbs (_rsc query param).
    /NS_ERROR_/, // Firefox internal error codes (NS_ERROR_FAILURE, NS_ERROR_NOT_AVAILABLE, etc.), mostly from third-party scripts (ads/pixel.js, tracking pixels, browser extensions). Drops every event whose main exception is an NS_ERROR, including ones raised in our own frames. UX: No user-visible impact for the third-party sources - errors occur in isolated third-party script contexts.
    "Should not already be working.", // React internal scheduler error - occurs when React's concurrent rendering scheduler detects re-entrant scheduling during complex navigation patterns. Not actionable at application level. UX: No user-visible impact - React's error recovery handles scheduler assertions gracefully.
    "feature named `pageObserver` was not found", // DuckDuckGo browser internal error - occurs when DuckDuckGo's privacy/tracker blocking features attempt to register a page observer during Next.js RSC navigation but the feature registration fails. Browser-specific to DuckDuckGo 26.3 on Mac. UX: No user-visible impact - Next.js navigation completes successfully via fallback mechanisms. Detection: no stack trace (browser-internal error), DuckDuckGo browser tag, handled=no, RSC navigation with _rsc query param.
  ],

  // Filter out third-party errors that slip through ignoreErrors
  beforeSend(event, hint) {
    if (isPayPalSdkError(event, hint)) {
      return null; // Drop the event
    }
    if (isGoogleTranslateError(event)) {
      return null; // Drop Google Translate script errors
    }
    if (isClerkStorageError(event)) {
      return null; // Drop Clerk storage access errors
    }
    if (isThirdPartyInjectedError(event, hint)) {
      return null; // Drop errors from injected scripts (e.g. Facebook/Cookiebot)
    }
    if (isExtensionExecutorError(event)) {
      // Drop errors whose whole stack is a browser extension's executors/<n>.js bundle.
      // UX: nothing of ours runs in that stack, so there is no app behaviour to fix and
      // nothing the player can act on.
      return null;
    }
    if (isEffectInterruptError(event)) {
      return null; // Drop Effect-TS fiber interruption errors (SpacetimeDB SDK)
    }
    if (isDataCloneError(event, hint)) {
      return null; // Drop DataCloneError from third-party scripts (gtag, mediafilter)
    }
    if (isReplicateApiError(event)) {
      return null; // Drop Replicate API gateway errors (502/503/504)
    }
    if (isGenericFetchFailure(event)) {
      return null; // Drop "Failed to fetch" / "network error" failures that did not come from Clerk
    }
    if (isNetworkLoadError(event)) {
      return null; // Drop stackless network errors that ignoreErrors does not match
    }
    if (isHtmlResponseError(event)) {
      return null; // Drop HTML response parsing errors (CDN/proxy outages)
    }
    if (isProxyError(event)) {
      return null; // Drop proxy error response parsing errors (truncated proxy error messages)
    }
    if (isInjectedJsonParseError(event)) {
      return null; // Drop JSON parsing errors from anonymous/injected code (browser extensions)
    }
    if (isFirefoxJsonParseError(event)) {
      return null; // Drop Firefox JSON parsing errors (network/CDN issues)
    }
    if (isSafariJsonParseError(event)) {
      return null; // Drop Safari JSON parsing errors (network/CDN issues)
    }
    if (isClerkSyntaxError(event)) {
      return null; // Drop Clerk script parsing errors (network truncation)
    }
    if (isNextJsChunkSyntaxError(event)) {
      return null; // Drop Next.js chunk parsing errors (network truncation)
    }
    if (isWalletExtensionError(event)) {
      return null; // Drop cryptocurrency wallet extension errors (MetaMask, etc.)
    }
    if (isThirdPartyStackOverflowError(event)) {
      return null; // Drop third-party stack overflow errors (tracking scripts)
    }
    if (isServerActionError(event)) {
      return null; // Drop server action errors during auth transitions and rate limiting (SSO callback, sign-out, 429)
    }
    if (isWebKitMessageHandlersError(event)) {
      return null; // Drop iOS WebKit bridge errors from third-party scripts
    }
    if (isSpacetimeDBWebSocketConnectingError(event)) {
      return null; // Drop SpacetimeDB WebSocket timing errors (transient)
    }
    if (isUserscriptError(event)) {
      return null; // Drop userscript errors from browser extensions
    }
    if (isGoogleApiLoaderError(event)) {
      return null; // Drop third-party Google API loader errors
    }
    if (isHistoryPushStateRateLimitError(event)) {
      return null; // Drop history.pushState rate limit errors from third-party scripts
    }
    if (isChunkLoadConsoleError(event)) {
      return null; // Drop chunk load console errors
    }
    if (isThirdPartyPixelJsonParseError(event)) {
      return null; // Drop third-party tracking pixel JSON parsing errors
    }
    if (isClipboardPermissionError(event)) {
      return null; // Drop clipboard permission errors (handled with user feedback)
    }
    if (isFirefoxNSError(event)) {
      return null; // Drop Firefox NS_ERROR from third-party scripts
    }
    if (isResponseBodyAlreadyReadError(event)) {
      return null; // Drop Response body already read errors
    }
    if (isReactSchedulerError(event)) {
      return null; // Drop React scheduler internal errors
    }
    if (isFirefoxInputStreamError(event)) {
      return null; // Drop Firefox input stream errors
    }
    if (isClerkSignOutError(event)) {
      return null; // Drop Clerk sign-out race condition errors
    }
    if (isClerkSessionTouchNetworkError(event)) {
      return null; // Drop failed Clerk session heartbeats (no user-visible impact)
    }
    if (isNavigationAbortError(event)) {
      return null; // Drop requests the browser aborted when the user navigated away
    }
    if (isInvalidOriginError(event)) {
      return null; // Drop scoped invalid origin errors from third-party scripts
    }
    if (isRateLimitJsonParseError(event)) {
      return null; // Drop rate limit (429) JSON parsing errors - handled gracefully in UI
    }
    return event;
  },

  // NODE_ENV is "production" for every Vercel build, so VERCEL_ENV is what separates
  // production from preview deployments.
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,

  // Only on production URLs
  // Leave this off while a pull zone serves the bundle: app frames then come from
  // the zone's hostname, and an allowlist of the site would drop every client error.
  // allowUrls: [/https?:\/\/(www\.)?theninja-rpg\.com.*/],
});

// Register a single browser-side global error handler for Promise rejections and uncaught errors.
declare global {
  interface Window {
    __TNR_GLOBAL_REJECTION_HANDLER__?: boolean;
  }
}

/**
 * Cross-window SDK noise that stays out of Sentry. The checkout page does not treat these
 * as cleanup and still shows its error toast for them.
 */
const PAYPAL_CROSS_WINDOW_PATTERNS = ["postrobot_method", "paypal_js_sdk"];

/** Check if a rejection is PayPal cleanup or cross-window noise that should be suppressed. */
const isPayPalRejection = (err: unknown): boolean => {
  const errorMessage = err?.toString() ?? "";
  return (
    isPayPalCleanupError(err) ||
    PAYPAL_CROSS_WINDOW_PATTERNS.some((pattern) => errorMessage.includes(pattern))
  );
};

/**
 * Check if an error is a Clerk script loading error that should be suppressed.
 * These occur when the Clerk JS script fails to load on mobile devices due to
 * network issues, ad blockers, or browser restrictions.
 */
const isClerkScriptLoadError = (err: unknown): boolean => {
  const errorMessage = err?.toString() ?? "";
  return (
    errorMessage.includes("failed to load script") ||
    errorMessage.includes("failed_to_load_clerk_js") ||
    errorMessage.includes("Failed to load Clerk")
  );
};

/**
 * Check if an error is a localStorage access error caused by browser privacy settings.
 * These are SecurityErrors thrown when cookies/storage are blocked.
 */
const isLocalStorageAccessError = (err: unknown): boolean => {
  const msg = err?.toString() ?? "";
  return (
    msg.includes("localStorage") &&
    msg.includes("Access is denied") &&
    msg.includes("SecurityError")
  );
};

/**
 * Helper to extract stack frames from Sentry error event.
 * Converts Sentry's stack frame format to our simplified StackFrame type
 * used by the shared error pattern matchers.
 */
const extractStackFramesFromSentryEvent = (
  event: Sentry.ErrorEvent,
): Array<StackFrame> => {
  const sentryFrames = event.exception?.values?.[0]?.stacktrace?.frames ?? [];
  return sentryFrames.map((frame) => ({
    filename: frame.filename ?? frame.abs_path,
  }));
};

/**
 * Check if an error is a network fetch error that should be suppressed.
 * These occur on iOS Safari when the device goes to sleep, network changes,
 * or the request is aborted during navigation. The "Load failed" message may
 * include a domain suffix like "(uploadthing.b-cdn.net)" for CDN requests.
 *
 * Used by the unhandledrejection handler, which receives raw errors without Sentry
 * stack frames; beforeSend uses isNetworkLoadError.
 */
const isNetworkFetchError = (err: unknown): boolean => {
  if (!(err instanceof Error)) return false;
  const msg = err.message ?? "";
  return msg.startsWith("Load failed") || msg === "Failed to fetch" || msg === "network error";
};

/**
 * Check if an error is a Clerk storage access error that should be filtered.
 * These occur when browser privacy settings block Clerk from accessing localStorage.
 */
const isClerkStorageError = (event: Sentry.ErrorEvent): boolean => {
  const message = event.exception?.values?.[0]?.value ?? "";
  const stackFrames = event.exception?.values?.[0]?.stacktrace?.frames ?? [];

  const isStorageError =
    message.includes("localStorage") &&
    (message.includes("Access is denied") || message.includes("SecurityError"));

  if (!isStorageError) return false;

  // Check if the error originates from Clerk
  return stackFrames.some(
    (frame) =>
      frame.filename?.includes("@clerk/clerk-js") ||
      frame.abs_path?.includes("@clerk/clerk-js"),
  );
};

/**
 * Check if an error is a TRPC error that should be handled by react-query's error handlers.
 * These are filtered out here to avoid duplicate error reporting.
 */
const isTRPCError = (err: unknown): boolean => {
  // Check if it's an object with TRPC error shape
  if (typeof err === "object" && err !== null) {
    const hasCode = "code" in err;
    const hasData = "data" in err;
    const hasMessage = "message" in err;
    const hasName = "name" in err;
    const hasStack = "stack" in err;

    // TRPC errors typically have this shape: { code, data, message, name, stack }
    if ((hasCode || hasData) && hasMessage && hasName && hasStack) {
      // Check for specific TRPC error messages that we handle elsewhere
      const errMessage =
        (err as { message?: string }).message?.toString().toLowerCase() ?? "";
      if (
        errMessage.includes("unauthorized") ||
        errMessage.includes("load failed") ||
        errMessage.includes("fetch") ||
        errMessage.includes("too many requests")
      ) {
        return true; // These are handled by react-query's onError
      }
    }
  }
  return false;
};

/**
 * Check if an error is from Google Translate scripts that should be filtered.
 * When users access the site through Google Translate (translate.goog proxy),
 * Google's scripts sometimes fail when manipulating DOM elements.
 */
const isGoogleTranslateError = (event: Sentry.ErrorEvent): boolean => {
  const stackFrames = event.exception?.values?.[0]?.stacktrace?.frames ?? [];

  // Check if the error originates from Google Translate scripts
  return stackFrames.some(
    (frame) =>
      frame.filename?.includes("translate.goog") ||
      frame.filename?.includes("translate_http") ||
      frame.filename?.includes("el_main") ||
      frame.filename?.includes("el_conf") ||
      frame.abs_path?.includes("translate.goog") ||
      frame.abs_path?.includes("translate_http"),
  );
};

/**
 * Check if an error is a PayPal SDK cleanup error that should be filtered.
 * These occur when users navigate away while PayPal buttons are initializing,
 * or when users close the PayPal popup before the transaction completes.
 *
 * Also filters stack overflow errors from PayPal SDK's zoid library,
 * which can occur during component cleanup when the internal promise handlers
 * (dispatch/resolve/reject) enter infinite recursion.
 *
 * Also filters bootstrap errors from PayPal SDK's zoid library, which can occur
 * during component initialization when the SDK attempts to register duplicate
 * cross-domain message listeners (race condition in component lifecycle).
 * Example: "Request listener already exists for zoid_allow_delegate_paypal_buttons".
 * UX note: PayPal buttons render and work correctly despite these errors. The errors
 * are logged to PayPal's internal analytics and are not actionable by us.
 */
const isPayPalSdkError = (
  event: Sentry.ErrorEvent,
  hint: Sentry.EventHint,
): boolean => {
  const message = event.exception?.values?.[0]?.value ?? "";
  const errorType = event.exception?.values?.[0]?.type ?? "";

  // Check message for PayPal-related error patterns
  const paypalErrorPatterns = [
    ...PAYPAL_CLEANUP_PATTERNS,
    ...PAYPAL_CROSS_WINDOW_PATTERNS,
    "Can not send postrobot",
    "Bootstrap Error", // PayPal SDK zoid bootstrap/initialization errors
  ];

  if (paypalErrorPatterns.some((pattern) => message.includes(pattern))) {
    return true;
  }

  // Check if the error originates from the PayPal SDK
  const isFromPayPalSdk = isPayPalSdkStack(
    (hint.originalException as Error | null | undefined)?.stack,
  );

  if (isFromPayPalSdk && message.includes("closed")) {
    return true;
  }

  // Filter PayPal SDK stack overflow errors
  // These occur when zoid's internal promise handlers (dispatch/resolve) enter infinite
  // recursion during component cleanup. This is an internal SDK bug we cannot fix.
  // UX note: Users don't see this error - it occurs during navigation/cleanup.
  const isStackOverflow =
    errorType === "RangeError" && message.includes("Maximum call stack size exceeded");

  if (isStackOverflow && isFromPayPalSdk) {
    return true;
  }

  return false;
};

/**
 * Check if every frame of an error comes from a browser extension's executors bundle.
 */
const isExtensionExecutorError = (event: Sentry.ErrorEvent): boolean =>
  isExtensionExecutorEvent(
    (event.exception?.values ?? []).map((value) =>
      (value.stacktrace?.frames ?? []).map(
        (frame) => frame.abs_path ?? frame.filename,
      ),
    ),
  );

/**
 * Check if an error is from an injected third-party script like Facebook or Cookiebot.
 * These often cause "Illegal invocation" errors in document.createEvent or similar.
 *
 * UX: no game screen or loading state waits on these scripts. A failed inject_content.js
 * stays inside its own callback, and without a Cookiebot answer the consent readers in
 * `libs/cookieConsent.ts` treat optional categories as declined, so tracking stays off and
 * embeds show their click-to-load placeholder.
 */
const isThirdPartyInjectedError = (
  event: Sentry.ErrorEvent,
  hint: Sentry.EventHint,
): boolean => {
  const message = event.exception?.values?.[0]?.value ?? "";
  const stackFrames = event.exception?.values?.[0]?.stacktrace?.frames ?? [];

  const isCookiebotScript = isCookiebotStack(
    (hint.originalException as Error | null | undefined)?.stack,
  );
  const isInjectedScript =
    isCookiebotScript ||
    stackFrames.some(
      (frame) =>
        isInjectedContentPath(frame.filename) || isInjectedContentPath(frame.abs_path),
    );

  // Filter Illegal invocation errors from any injected script
  if (isInjectedScript && message.includes("Illegal invocation")) {
    return true;
  }

  // Filter Cookiebot-specific errors when manipulating DOM elements
  // sortBannerButtons tries to set innerHTML on null element
  if (isCookiebotScript && message.includes("Cannot set properties of null")) {
    return true;
  }

  return false;
};

/**
 * Check if an error is from Effect-TS (used by SpacetimeDB SDK).
 * Effect-TS creates frozen error objects for fiber interruption, and Sentry
 * throws when trying to modify the `stack` property of these frozen objects.
 */
const isEffectInterruptError = (event: Sentry.ErrorEvent): boolean => {
  const message = event.exception?.values?.[0]?.value ?? "";
  return (
    message.includes("MicroCause.Interrupt") ||
    (message.includes("Cannot assign to read only property") &&
      message.includes("stack"))
  );
};

/**
 * Check if an error is a DataCloneError from third-party scripts.
 * These occur when scripts like Google Analytics (gtag) or mediafilter inject
 * code that tries to postMessage with DOM elements that cannot be cloned.
 * Common in Facebook's in-app browser.
 *
 * UX: only that script's message is lost. The game never reads it, so no screen, loading
 * state or player action depends on it.
 */
const isDataCloneError = (
  event: Sentry.ErrorEvent,
  hint: Sentry.EventHint,
): boolean => {
  const message = event.exception?.values?.[0]?.value ?? "";
  const stackFrames = event.exception?.values?.[0]?.stacktrace?.frames ?? [];

  const isDataCloneMessage =
    message.includes("DataCloneError") ||
    (message.includes("postMessage") && message.includes("could not be cloned"));

  if (!isDataCloneMessage) return false;

  // Check if the error originates from third-party scripts
  return (
    isGoogleTagStack((hint.originalException as Error | null | undefined)?.stack) ||
    stackFrames.some(
      (frame) =>
        isMediaFilterPath(frame.filename) || isMediaFilterPath(frame.abs_path),
    )
  );
};

/**
 * Check if an error is a Replicate API error that should be filtered.
 * This includes:
 * - Gateway errors (502/503/504) - transient infrastructure issues
 * - Safety filter errors (E005) - expected when users try to generate sensitive content
 *
 * UX note: These errors are still displayed to users via the global tRPC error handler
 * in Provider.tsx which shows a toast notification. This filter only suppresses Sentry logging.
 */
const isReplicateApiError = (event: Sentry.ErrorEvent): boolean => {
  const message = event.exception?.values?.[0]?.value ?? "";

  const isReplicateDomain =
    /(?:^|[/:])api\.replicate\.com(?:[/:$?]|$)/.test(message);

  const gatewayErrorCodes = ["502 Bad Gateway", "503 Service", "504 Gateway"];
  const isGatewayError =
    isReplicateDomain &&
    gatewayErrorCodes.some((code) => message.includes(code));

  const safetyFilterPatterns = [
    "Prediction failed",
    "flagged as sensitive",
    "E005",
  ];
  const isSafetyFilterError = safetyFilterPatterns.every((pattern) =>
    message.includes(pattern),
  );

  return isGatewayError || isSafetyFilterError;
};

/**
 * Check if an error is a stackless network error ("Load failed", "NetworkError", etc.).
 * These occur when network requests fail due to:
 * - Device going to sleep during a fetch request
 * - Network connectivity changes (WiFi to cellular)
 * - CDN/network requests failing transiently
 * - User navigating away while a fetch is in progress
 *
 * UX note: These errors are handled gracefully:
 * - tRPC retry logic (Provider.tsx) automatically retries up to 3 times
 * - Silent ignore in tRPC onError prevents alarming toast notifications
 * - Users only see errors if the request fails after all retries for other reasons
 *
 * The /^Load failed/ ignoreErrors entry and isGenericFetchFailure drop their messages
 * whatever their stack, so the shape check here applies only to the other wordings (for
 * example Firefox's "NetworkError when attempting to fetch resource.").
 *
 * Uses shared error patterns from @/utils/error to ensure consistency with retry logic.
 */
const isNetworkLoadError = (event: Sentry.ErrorEvent): boolean => {
  const message = event.exception?.values?.[0]?.value ?? "";
  const errorType = event.exception?.values?.[0]?.type ?? "";
  const hasStackTrace =
    (event.exception?.values?.[0]?.stacktrace?.frames?.length ?? 0) > 0;

  // Use shared pattern matcher from @/utils/error
  const stackFrames = extractStackFramesFromSentryEvent(event);
  const matchesPattern = isNetworkErrorPattern(message, stackFrames);

  // These errors typically have no stack trace and are TypeError
  const isNetworkErrorShape =
    !hasStackTrace && (errorType === "TypeError" || errorType === "");

  return matchesPattern && isNetworkErrorShape;
};

/** Network failure wordings Chrome and Android WebView put in a failed fetch's TypeError. */
const GENERIC_FETCH_FAILURE_MESSAGES = ["Failed to fetch", "network error"];

/**
 * Check if an error is a Chrome/Android fetch failure that did not come from Clerk.
 * These occur when the user navigates away while a fetch is in flight or the device
 * loses connectivity. Like an ignoreErrors entry, the wording matches anywhere in the
 * message, so errors that wrap the browser's TypeError drop too.
 *
 * UX note: tRPC retries failed queries up to 3 times (Provider.tsx); a query that still
 * fails shows a "Could not load the latest data" toast, and a mutation shows "Could not
 * confirm whether this action completed", so the user always gets recovery feedback.
 *
 * Clerk failures keep reporting: a failed token refresh or sign-in request signs the
 * user out or blocks sign-in, with no tRPC retry or toast behind it.
 */
const isGenericFetchFailure = (event: Sentry.ErrorEvent): boolean => {
  // ignoreErrors matching reads the last exception, which is the one that was thrown
  const messages = [event.message, event.exception?.values?.at(-1)?.value];
  const isFetchFailure = messages.some((message) =>
    GENERIC_FETCH_FAILURE_MESSAGES.some((wording) => message?.includes(wording)),
  );
  return isFetchFailure && !isClerkOriginError(event);
};

/**
 * Check if an error came from Clerk: a ClerkJS network error naming a Clerk request
 * URL, or a stack frame in the clerk-js bundle.
 */
const isClerkOriginError = (event: Sentry.ErrorEvent): boolean =>
  (event.exception?.values ?? []).some(
    (exception) =>
      isClerkHostUrl(CLERK_NETWORK_ERROR_URL.exec(exception.value ?? "")?.[1]) ||
      (exception.stacktrace?.frames ?? []).some(
        (frame) => isClerkScriptUrl(frame.filename) || isClerkScriptUrl(frame.abs_path),
      ),
  );

/** The request URL Clerk quotes in its network errors. */
const CLERK_NETWORK_ERROR_URL = /^ClerkJS: Network error at "([^"]+)"/;

/**
 * The path clerk-js and its lazy chunks load from. Frame normalization replaces every
 * frame's origin with app://, so a frame keeps only this path, never the Clerk host.
 */
const CLERK_SCRIPT_PATH = /^\/npm\/@clerk\/clerk-js@[^/]+\/dist\/[^/]+\.js$/;

/** Check if a stack frame URL is a clerk-js script. */
const isClerkScriptUrl = (value: string | undefined): boolean => {
  if (!value) return false;
  try {
    return CLERK_SCRIPT_PATH.test(new URL(value).pathname);
  } catch {
    return false; // Not a URL, so not a loaded script
  }
};

/**
 * Anchored so a lookalike host (clerk.attacker.com) never matches. Covers our Clerk
 * custom domains (the CSP in next.config.mjs allows the clerk.www.* forms, and
 * production reports clerk.theninja-rpg.com) plus Clerk's own domains used by preview
 * deployments.
 */
const CLERK_HOST =
  /^(clerk\.(www\.)?theninja-rpg\.(com|ai)|([a-z0-9-]+\.)+clerk\.(com|accounts\.dev))$/;

/** Check if a URL is served from a Clerk host. */
const isClerkHostUrl = (value: string | undefined): boolean => {
  if (!value) return false;
  try {
    return CLERK_HOST.test(new URL(value).hostname);
  } catch {
    return false; // Not an absolute URL, so not a Clerk request
  }
};

/**
 * Check if an error is an HTML response parsing error from tRPC.
 * These occur when a CDN or reverse proxy returns an HTML error page (502/503/504)
 * instead of JSON, causing the tRPC client to fail parsing the response.
 *
 * UX note: These errors are handled gracefully:
 * - tRPC retry logic (Provider.tsx) automatically retries up to 3 times
 * - Silent ignore in tRPC onError prevents alarming toast notifications
 * - Users only see errors if the request fails after all retries
 *
 * Uses shared error patterns from @/utils/error to ensure consistency with retry logic.
 */
const isHtmlResponseError = (event: Sentry.ErrorEvent): boolean => {
  const message = event.exception?.values?.[0]?.value ?? "";
  const errorType = event.exception?.values?.[0]?.type ?? "";

  // Use shared pattern matcher from @/utils/error
  const stackFrames = extractStackFramesFromSentryEvent(event);
  const matchesPattern = isHtmlResponseErrorPattern(message, stackFrames);

  // This error comes from tRPC client as TRPCClientError or SyntaxError
  const isTrpcOrSyntaxError =
    errorType === "TRPCClientError" || errorType === "SyntaxError";

  return matchesPattern && isTrpcOrSyntaxError;
};

/**
 * Check if an error is a proxy error response parsing error from tRPC.
 * These occur when a proxy or reverse proxy returns a truncated error message
 * like "An error o..." instead of proper JSON, causing tRPC client parsing failure.
 *
 * UX note: These errors are handled gracefully:
 * - tRPC retry logic (Provider.tsx) automatically retries up to 3 times
 * - Silent ignore in tRPC onError prevents alarming toast notifications
 * - Users only see errors if the request fails after all retries
 *
 * Uses shared error patterns from @/utils/error to ensure consistency with retry logic.
 */
const isProxyError = (event: Sentry.ErrorEvent): boolean => {
  const message = event.exception?.values?.[0]?.value ?? "";
  const errorType = event.exception?.values?.[0]?.type ?? "";

  // Use shared pattern matcher from @/utils/error
  const stackFrames = extractStackFramesFromSentryEvent(event);
  const matchesPattern = isProxyErrorPattern(message, stackFrames);

  // This error comes from tRPC client as TRPCClientError or SyntaxError
  const isTrpcOrSyntaxError =
    errorType === "TRPCClientError" || errorType === "SyntaxError";

  return matchesPattern && isTrpcOrSyntaxError;
};

/**
 * Check if an error is a JSON parsing error from anonymous/injected code.
 * These occur when third-party scripts (browser extensions, password managers, injected
 * code) try to parse "undefined" as JSON. The error originates from anonymous code
 * with no identifiable source files in the stack trace.
 *
 * UX note: These errors are not actionable and don't affect users - they originate
 * from third-party code we don't control. Users never see these errors as they
 * occur in isolated third-party contexts.
 */
const isInjectedJsonParseError = (event: Sentry.ErrorEvent): boolean => {
  const message = event.exception?.values?.[0]?.value ?? "";
  const errorType = event.exception?.values?.[0]?.type ?? "";
  const stackFrames = event.exception?.values?.[0]?.stacktrace?.frames ?? [];

  // Must be a SyntaxError with the specific "undefined" is not valid JSON message
  if (errorType !== "SyntaxError") return false;
  if (!message.includes('"undefined" is not valid JSON')) return false;

  // Check if stack trace indicates anonymous/injected code
  // - Empty stack trace (no frames at all)
  // - Frames with no filename or <anonymous> filename
  // - Frames from known injected script patterns
  if (stackFrames.length === 0) return true;

  const isFromAnonymousOrInjectedCode = stackFrames.every((frame) => {
    const filename = frame.filename ?? "";
    const absPath = frame.abs_path ?? "";

    // No identifiable source file
    if (!filename && !absPath) return true;

    // Anonymous script markers
    if (filename === "<anonymous>" || absPath === "<anonymous>") return true;

    // Common injected script patterns
    if (
      filename.includes("inject") ||
      filename.includes("extension") ||
      absPath.includes("inject") ||
      absPath.includes("extension")
    ) {
      return true;
    }

    return false;
  });

  return isFromAnonymousOrInjectedCode;
};

/**
 * Check if an error is a Firefox JSON parsing error from tRPC.
 * Firefox uses a generic error message format when JSON parsing fails, unlike
 * Chrome/Safari which include the problematic content in the error message.
 *
 * When tRPC receives non-JSON responses (plain text "Offline", HTML error pages,
 * empty responses) due to network issues or CDN outages, Firefox throws:
 * "JSON.parse: unexpected character at line 1 column 1 of the JSON data"
 *
 * UX note: These errors are handled gracefully:
 * - tRPC retry logic (Provider.tsx) automatically retries up to 3 times
 * - Silent ignore in tRPC onError prevents alarming toast notifications
 * - Users only see errors if the request fails after all retries for other reasons
 *
 * Uses shared error patterns from @/utils/error to ensure consistency with retry logic.
 */
const isFirefoxJsonParseError = (event: Sentry.ErrorEvent): boolean => {
  const message = event.exception?.values?.[0]?.value ?? "";
  const errorType = event.exception?.values?.[0]?.type ?? "";

  // Use shared pattern matcher from @/utils/error
  const stackFrames = extractStackFramesFromSentryEvent(event);
  const matchesPattern = isFirefoxJsonErrorPattern(message, stackFrames);

  // Verify it's a tRPC error type
  const isTrpcError = errorType === "TRPCClientError";

  return matchesPattern && isTrpcError;
};

/**
 * Check if an error is a Safari JSON parsing error that should be filtered.
 *
 * Safari-specific JSON.parse error when receiving non-JSON responses (HTML error pages,
 * plain text, truncated responses). This occurs when:
 * - Server returns 403/500 with HTML error page instead of JSON
 * - CDN/WAF returns error page before reaching application
 * - Network issues cause truncated/corrupted responses
 * - Rate limiting returns plain text error message
 *
 * UX: Handled gracefully by tRPC retry logic in Provider.tsx. Users see toast notification
 * for API errors. tRPC automatically retries transient errors (per isRetryableError).
 */
const isSafariJsonParseError = (event: Sentry.ErrorEvent): boolean => {
  const message = event.exception?.values?.[0]?.value ?? "";
  const errorType = event.exception?.values?.[0]?.type ?? "";

  // Use shared pattern matcher from @/utils/error
  const stackFrames = extractStackFramesFromSentryEvent(event);
  const matchesPattern = isSafariJsonErrorPattern(message, stackFrames);

  // Verify it's a tRPC error type
  const isTrpcError = errorType === "TRPCClientError" || errorType === "SyntaxError";

  return matchesPattern && isTrpcError;
};

/**
 * Check if an error is a Clerk script parsing error that should be filtered.
 * These occur when the Clerk SDK script is truncated during download due to network
 * issues (mobile network changes, device sleep, interrupted connection).
 *
 * UX note: When Clerk fails to load, users see a loading state for authentication.
 * Clerk's SDK has built-in retry mechanisms, and users can refresh to reload the script.
 *
 * Filter SyntaxError from Clerk scripts as they are transient network issues.
 */
const isClerkSyntaxError = (event: Sentry.ErrorEvent): boolean => {
  const errorType = event.exception?.values?.[0]?.type ?? "";
  const stackFrames = event.exception?.values?.[0]?.stacktrace?.frames ?? [];

  // Only filter SyntaxError exceptions
  if (errorType !== "SyntaxError") return false;

  // Check if the error originates from Clerk
  return stackFrames.some(
    (frame) =>
      frame.filename?.includes("@clerk/clerk-js") ||
      frame.filename?.includes("clerk.browser") ||
      frame.abs_path?.includes("@clerk/clerk-js") ||
      frame.abs_path?.includes("clerk.browser"),
  );
};

/**
 * Check if an error is a request aborted by the browser during navigation.
 *
 * When a user navigates (or closes a tab) while requests are still in flight,
 * the browser rejects them. Firefox words this "AbortError: The operation was
 * aborted."; Chrome and Safari produce "Failed to fetch" / "Load failed", which
 * are already filtered above. This is the Firefox equivalent of those entries.
 *
 * UX note: no user-visible impact. The requests belong to a page the user has
 * left; react-query refetches whatever the destination page needs.
 *
 * Deliberately narrow - only filters when there is NO stack trace at all, which
 * is the signature of a browser-level DOMException. Every place this codebase
 * aborts on purpose (fetchWithTimeout) surfaces the error to its caller with a
 * real stack, so those keep reporting.
 */
const isNavigationAbortError = (event: Sentry.ErrorEvent): boolean => {
  const exception = event.exception?.values?.[0];
  const message = exception?.value ?? "";
  const errorType = exception?.type ?? "";
  const stackFrames = exception?.stacktrace?.frames ?? [];
  const mechanism = exception?.mechanism?.type ?? "";

  if (errorType !== "AbortError") return false;
  if (!message.trim().startsWith("The operation was aborted")) return false;

  // A browser-level abort carries no frames; anything with a stack is ours to fix
  if (stackFrames.length > 0) return false;

  return mechanism.includes("onunhandledrejection");
};

/**
 * Check if an error is a failed Clerk session "touch" request.
 *
 * Clerk periodically POSTs to /v1/client/sessions/<id>/touch to refresh the
 * session's last-active timestamp. On flaky mobile networks (device sleep, WiFi
 * to cellular handoff, tunnels) this background request fails and Clerk rejects
 * the promise, which our global handler reports.
 *
 * UX note: no user-visible impact. Touch is a heartbeat that only updates
 * "last active at"; it does not mint or refresh the session token, so a failed
 * touch never signs the user out or blocks a request. Clerk simply retries on
 * its next poll. This check is scoped to the touch endpoint because failures on
 * token or sign-in endpoints affect the user.
 *
 * Detection pattern:
 * - Message begins with "ClerkJS: Network error at"
 * - The quoted URL is a Clerk host and a /v1/client/sessions/<id>/touch path
 * - The underlying cause is a network-level TypeError, whose wording differs per
 *   browser ("Load failed" on Safari, "NetworkError when attempting to fetch
 *   resource." on Firefox, "Failed to fetch" on Chrome)
 */
const isClerkSessionTouchNetworkError = (event: Sentry.ErrorEvent): boolean => {
  const message = event.exception?.values?.[0]?.value ?? "";

  if (!message.startsWith("ClerkJS: Network error at")) return false;

  // Extract the quoted request URL so the host and path can be validated
  // properly rather than substring-matched (a spoofed path could otherwise pass)
  const quotedUrl = CLERK_NETWORK_ERROR_URL.exec(message)?.[1];
  if (!quotedUrl || !isClerkHostUrl(quotedUrl)) return false;
  const isSessionTouchEndpoint = /^\/v1\/client\/sessions\/[^/]+\/touch$/.test(
    new URL(quotedUrl).pathname,
  );
  if (!isSessionTouchEndpoint) return false;

  // Only transient network failures; anything else from this endpoint is worth seeing
  const networkCauses = [
    "Load failed",
    "Failed to fetch",
    "NetworkError when attempting to fetch resource.",
    "network error",
    "The network connection was lost.",
  ];
  return networkCauses.some((cause) => message.includes(cause));
};

/**
 * Check if an error is a Clerk sign-out race condition error that should be filtered.
 * These occur when Clerk attempts to sign out a user whose session has already been
 * invalidated server-side. This is a transient race condition in Clerk's sign-out flow:
 *
 * 1. Server-side session invalidation completes first
 * 2. Client-side sign-out request arrives after session cleared
 * 3. Server responds with 401 Unauthorized
 * 4. Clerk throws "You are signed out" error instead of treating it as success
 *
 * UX note: Users successfully sign out despite this error. The error occurs during
 * the sign-out transition period when the session is being invalidated. Navigation
 * continues normally and users reach the signed-out state as expected.
 *
 * Detection pattern:
 * - Error value: "You are signed out"
 * - Stack trace: Originates from @clerk/clerk-js signOut method
 * - Breadcrumbs: POST request to /v1/client/sessions with 401 status code
 * - Mechanism: unhandledrejection (not caught by Clerk SDK)
 *
 * This is Clerk's equivalent to other filtered Clerk errors:
 * - "ClerkJS: Token refresh failed" (ignoreErrors)
 * - Clerk storage access errors (isClerkStorageError)
 * - Clerk script load errors (isClerkScriptLoadError)
 */
const isClerkSignOutError = (event: Sentry.ErrorEvent): boolean => {
  const message = event.exception?.values?.[0]?.value ?? "";
  const stackFrames = event.exception?.values?.[0]?.stacktrace?.frames ?? [];
  const breadcrumbs = event.breadcrumbs ?? [];

  // Must be the specific "You are signed out" error message
  if (message !== "You are signed out") {
    return false;
  }

  // Verify it originates from Clerk's sign-out flow
  const isFromClerkSignOut = stackFrames.some(
    (frame) =>
      frame.filename?.includes("@clerk/clerk-js") ||
      frame.filename?.includes("clerk.browser") ||
      frame.abs_path?.includes("@clerk/clerk-js") ||
      frame.abs_path?.includes("clerk.browser"),
  );

  if (!isFromClerkSignOut) {
    return false;
  }

  // Additional validation: Check for 401 response to Clerk sessions endpoint
  // This confirms the error occurred during sign-out request (not other Clerk operations)
  const hasSignOut401 = breadcrumbs.some((breadcrumb) => {
    if (breadcrumb.category !== "fetch") return false;
    const data = breadcrumb.data ?? {};
    const url = data.url ?? "";

    // Check for Clerk sessions endpoint with 401 status
    return (
      url.includes("clerk") &&
      url.includes("/v1/client/sessions") &&
      hasStatusCode(data, 401)
    );
  });

  // Filter if both conditions met: Clerk stack + sessions 401 breadcrumb
  // The breadcrumb check provides defense-in-depth to avoid false positives
  return isFromClerkSignOut && hasSignOut401;
};


/** Whether a stack frame runs our code, validating URL hostnames to prevent spoofing. */
const isOwnAppFrame = (frame: { filename?: string; abs_path?: string }): boolean => {
  const filename = frame.filename ?? "";
  const absPath = frame.abs_path ?? "";
  if (filename.includes("/_next/") || filename.includes("/app/") || filename.includes("/src/")) {
    return true;
  }
  try {
    return [filename, absPath].some((path) => {
      if (!path.startsWith("http")) return false;
      const { hostname } = new URL(path);
      return hostname === "theninja-rpg.com" || hostname.endsWith(".theninja-rpg.com");
    });
  } catch {
    return false;
  }
};

/** Whether fetch breadcrumb data reports this status, stored as a number or a string. */
const hasStatusCode = (data: Record<string, unknown> | undefined, status: number) =>
  data?.status_code === status || data?.status_code === String(status);

/**
 * Check if an error is a scoped "invalid origin" error that should be filtered.
 * These errors occur when third-party scripts (analytics, tracking, browser privacy features)
 * make cross-origin requests that are blocked by browser security policies.
 *
 * UX: No user-visible impact. Page navigation and tRPC queries complete successfully.
 * Error occurs in background processes isolated from application code.
 *
 * Only filters when:
 * - Error message contains "invalid origin" (case-insensitive)
 * - Stack frames show third-party script origins OR no meaningful stack trace
 * - NOT from our application code (/_next/, /app/, theninja-rpg.com)
 */
const isInvalidOriginError = (event: Sentry.ErrorEvent): boolean => {
  const message = event.exception?.values?.[0]?.value ?? "";
  const stackFrames = event.exception?.values?.[0]?.stacktrace?.frames ?? [];

  // Must contain "invalid origin" in the error message
  if (!message.toLowerCase().includes("invalid origin")) {
    return false;
  }

  // Only filter if no app frames are present: a third-party origin, or no stack at all
  // (a browser-level error)
  return !stackFrames.some(isOwnAppFrame);
};

/**
 * Check if an error is a rate limit (429) JSON parsing error that should be filtered.
 * When rate limiting returns 429 with empty/malformed body, tRPC client throws JSON parse error.
 * UX: User sees "You are acting too fast" toast via Provider.tsx handleTrpcError.
 * Detection: Check breadcrumbs for 429 status (most reliable signal) and JSON parse error message.
 */
const isRateLimitJsonParseError = (event: Sentry.ErrorEvent): boolean => {
  const exception = event.exception?.values?.[0];

  // Check if it's a TRPCClientError with JSON parsing error message
  const hasJsonParseError =
    exception?.value &&
    (exception.value.includes("Failed to execute 'json' on 'Response'") ||
     exception.value.includes("Unexpected end of JSON input") ||
     exception.value.includes("JSON.parse")) &&
    exception.type === "TRPCClientError";

  if (!hasJsonParseError) {
    return false;
  }

  // Check breadcrumbs for 429 status code
  const has429Status = event.breadcrumbs?.some(
    (b) => b.category === "fetch" && hasStatusCode(b.data, 429)
  );

  return Boolean(has429Status);
};

/**
 * Check if an error is a Next.js chunk parsing error that should be filtered.
 * These occur when Next.js JavaScript chunks are truncated during download due to network
 * issues (mobile network changes, device sleep, interrupted connection, CDN timeouts).
 *
 * UX note: When chunks fail to load, Next.js shows a loading state or error boundary.
 * Users can refresh the page to reload the chunk with a stable connection. This is
 * expected behavior on mobile devices with unstable networks.
 *
 * Common patterns:
 * - SyntaxError with "Unexpected EOF" or "Unexpected end of input"
 * - Stack trace points to /_next/static/chunks/ files with no line number
 * - Mechanism: auto.browser.global_handlers.onerror (parse-time error)
 * - Typically occurs on mobile devices (iOS Safari, Chrome Mobile)
 */
const isNextJsChunkSyntaxError = (event: Sentry.ErrorEvent): boolean => {
  const errorType = event.exception?.values?.[0]?.type ?? "";
  const message = event.exception?.values?.[0]?.value ?? "";
  const stackFrames = event.exception?.values?.[0]?.stacktrace?.frames ?? [];

  // Only filter SyntaxError exceptions
  if (errorType !== "SyntaxError") return false;

  // Check for truncation-related messages
  const isTruncationMessage =
    message.includes("Unexpected EOF") ||
    message.includes("Unexpected end of input") ||
    message.includes("Unexpected end of JSON input");

  if (!isTruncationMessage) return false;

  // Check if the error originates from Next.js chunks
  // Next.js chunks are in /_next/static/chunks/ directory
  // Stack trace is typically minimal (single frame with no line number)
  const isFromNextJsChunk = stackFrames.some(
    (frame) =>
      frame.filename?.includes("/_next/static/chunks/") ||
      frame.abs_path?.includes("/_next/static/chunks/") ||
      frame.filename?.includes("app:///_next/") ||
      frame.abs_path?.includes("app:///_next/")
  );

  if (!isFromNextJsChunk) return false;

  // Additional validation: Truncation errors typically have no meaningful stack trace
  // (no line number or function name because parser can't construct execution context)
  const hasMinimalStackTrace =
    stackFrames.length === 0 ||
    stackFrames.every(
      (frame) =>
        frame.function === "?" ||
        frame.function === "<unknown>" ||
        frame.lineno === undefined
    );

  return hasMinimalStackTrace;
};

/**
 * Check if an error is from a cryptocurrency wallet browser extension.
 * These occur when users have MetaMask, TronLink, or similar wallet extensions
 * installed, and the extension's injected script encounters an error independently
 * of our app.
 *
 * UX note: These errors are not actionable - they originate from third-party
 * browser extensions we don't control. Users don't see these errors as they
 * occur in the extension's isolated context. The application has no Web3/
 * cryptocurrency functionality.
 *
 * Examples of filtered errors:
 * - TronLink proxy trap error when setting tronlinkParams property
 */
const isWalletExtensionError = (event: Sentry.ErrorEvent): boolean => {
  const message = event.exception?.values?.[0]?.value ?? "";
  const stackFrames = event.exception?.values?.[0]?.stacktrace?.frames ?? [];

  // Plain-object rejections ({ code: 4001, message }) are rewrapped by the global
  // handler, and Sentry also stores the original object on extra.__serialized__.
  // UX: no wallet UI exists, so the homepage stays usable.
  if (
    isInjectedWalletRejection({ message }) ||
    isInjectedWalletRejection(event.extra?.__serialized__)
  ) {
    return true;
  }

  // Check if error originates from wallet extension's injected script
  // - inpage.js is the common name for wallet extension content scripts (MetaMask, etc.)
  // - app:///scripts/ is the URL scheme for browser extension injected scripts
  // - app:///injected is used by TronLink, ScatterJS, and other wallet extensions to inject SDK
  const isFromWalletScript = stackFrames.some(
    (frame) =>
      frame.filename?.includes("inpage.js") ||
      frame.filename?.startsWith("app:///scripts/") ||
      frame.filename?.includes("app:///injected") ||
      frame.abs_path?.includes("inpage.js") ||
      frame.abs_path?.startsWith("app:///scripts/") ||
      frame.abs_path?.includes("app:///injected"),
  );

  // Without wallet frames, "Cannot redefine property" counts only for wallet-specific
  // property names, to avoid hiding real app-side TypeErrors
  const isWalletPropertyError =
    message.includes("Cannot redefine property") &&
    (message.includes("ethereum") ||
      message.includes("tronWeb") ||
      message.includes("tronLink") ||
      message.includes("scatter") ||
      message.includes("walletRouter"));

  // Anything a wallet's injected script raises is dropped, whatever its message
  return isFromWalletScript || isWalletPropertyError;
};

/**
 * Check if an error is a Next.js server action error that should be filtered from Sentry.
 *
 * These errors occur when Next.js server actions or background revalidations receive unexpected
 * HTTP responses. The error message "An unexpected response was received from the server" is
 * generic and thrown by Next.js's fetchServerAction when it receives non-2xx responses it
 * doesn't know how to handle.
 *
 * Scenarios where this occurs:
 * 1. SSO callback flow (403 from transient CDN errors, mobile network changes)
 * 2. Sign-out flow (403 race condition where requests hit server after session invalidation)
 * 3. Rate limiting (429 when user triggers too many requests, affecting background revalidations)
 *
 * UX note for all scenarios:
 * - SSO: Users experience a temporary error during SSO callback, but can retry or
 *   manually navigate to complete authentication. This is a transient infrastructure issue.
 * - Sign-out: Users successfully sign out despite the error. The error occurs when pending
 *   requests or revalidations receive 403 after the session is invalidated. This is expected
 *   behavior during the sign-out transition and does not affect functionality.
 * - Rate limiting: Users already see appropriate toast messages from the tRPC error handler
 *   (the TOO_MANY_REQUESTS branch of handleTrpcError in _trpc/Provider.tsx). The Next.js server action
 *   error is redundant and adds Sentry noise without providing actionable information.
 *
 * Detection pattern:
 * - Error message: "An unexpected response was received from the server"
 * - SSO callback: URL contains /signup/sso-callback or /signin/sso-callback
 * - Sign-out: Breadcrumbs show sign-out button click + POST request with 403 status
 * - Rate limiting: Most recent fetch breadcrumb is a POST request with 429 status
 */
const isServerActionError = (event: Sentry.ErrorEvent): boolean => {
  const message = event.exception?.values?.[0]?.value ?? "";
  const url = event.request?.url ?? "";
  const breadcrumbs = event.breadcrumbs ?? [];

  // Must be the specific Next.js server action error message
  if (!message.includes("An unexpected response was received from the server")) {
    return false;
  }

  // Check if on SSO callback URL path
  const isSsoCallbackUrl =
    url.includes("/signup/sso-callback") || url.includes("/signin/sso-callback");

  // Check if error occurred during sign-out flow
  // Require BOTH sign-out click AND 403 POST for defense in depth
  const hasSignOutClick = breadcrumbs.some((breadcrumb) => {
    if (breadcrumb.category !== "ui.click") return false;
    const msg = breadcrumb.message ?? "";
    // Match Clerk's sign-out button or generic sign-out patterns
    return (
      msg.includes("signOut") ||
      msg.includes("sign-out") ||
      msg.includes("cl-userButtonPopoverActionButton__signOut")
    );
  });

  const has403Post = breadcrumbs.some((breadcrumb) => {
    if (breadcrumb.category !== "fetch") return false;
    const data = breadcrumb.data ?? {};
    // Check for POST request with 403 status code
    return (
      data.method === "POST" &&
      hasStatusCode(data, 403)
    );
  });

  // Check if error occurred during rate limiting
  // Only filter if there's a recent 429 POST (likely the direct cause of this error)
  // Find the last fetch breadcrumb to see if it was a rate-limited request
  const fetchBreadcrumbs = breadcrumbs.filter((b) => b.category === "fetch");
  const lastFetch = fetchBreadcrumbs[fetchBreadcrumbs.length - 1];
  const has429Post = lastFetch ? (() => {
    const data = lastFetch.data ?? {};
    // Check for POST request with 429 status code (rate limiting)
    return (
      data.method === "POST" &&
      hasStatusCode(data, 429)
    );
  })() : false;

  // Filter if: (SSO callback URL) OR (sign-out click + 403 POST) OR (recent 429 POST)
  const isSignOutRaceCondition = hasSignOutClick && has403Post;

  return isSsoCallbackUrl || isSignOutRaceCondition || has429Post;
};

/**
 * Check if an error is a "Maximum call stack size exceeded" RangeError from third-party scripts.
 * These occur when third-party tracking scripts (TikTok Pixel, Google Analytics, Facebook Pixel, etc.)
 * cause infinite recursion due to buggy event handlers or circular observer patterns.
 *
 * UX note: These errors are not visible to users and do not affect application functionality.
 * They occur in isolated third-party script contexts and are caught by the global error handler.
 * Since we have no control over third-party script code, filtering is the appropriate action.
 *
 */
const isThirdPartyStackOverflowError = (event: Sentry.ErrorEvent): boolean => {
  const message = event.exception?.values?.[0]?.value ?? "";
  const errorType = event.exception?.values?.[0]?.type ?? "";
  const stackFrames = event.exception?.values?.[0]?.stacktrace?.frames ?? [];

  // Must be a RangeError with "Maximum call stack size exceeded" message
  if (errorType !== "RangeError") return false;
  if (!message.includes("Maximum call stack size exceeded")) return false;

  // Third-party cross-origin scripts produce errors with no useful stack trace
  // (empty frames or only anonymous frames due to CORS restrictions)
  if (stackFrames.length === 0) return true;

  // Check if all frames are anonymous/unidentifiable (third-party pattern)
  const hasNoMeaningfulStackTrace = stackFrames.every((frame) => {
    const filename = frame.filename ?? "";
    const absPath = frame.abs_path ?? "";
    const func = frame.function ?? "";

    // No identifiable source file
    if (!filename && !absPath) return true;

    // Anonymous script markers
    if (filename === "<anonymous>" || absPath === "<anonymous>") return true;

    // Cross-origin scripts whose source URL could not be resolved are reported
    // with the literal strings "undefined"/"null" as the path. Such a frame can
    // never point at our own code, so it carries no diagnostic value.
    const isUnresolvedPath = (path: string) => path === "undefined" || path === "null";
    if (isUnresolvedPath(filename) && (!absPath || isUnresolvedPath(absPath))) {
      return true;
    }

    // Check for the "undefined:? in ?" pattern (function is "?" with no filename)
    if (func === "?" && !filename && !absPath) return true;

    return false;
  });

  return hasNoMeaningfulStackTrace;
};

/**
 * Check if an error is an iOS WebKit messageHandlers error.
 * These occur when third-party scripts attempt to access the iOS WKWebView
 * JavaScript-to-native bridge API on devices where it's not available.
 *
 * UX note: These errors are not visible to users and do not affect application
 * functionality. They occur in third-party script contexts (analytics, tracking,
 * consent management, Sentry SDK) that probe for native app features.
 *
 */
const isWebKitMessageHandlersError = (event: Sentry.ErrorEvent): boolean => {
  const message = event.exception?.values?.[0]?.value ?? "";

  // Check for webkit.messageHandlers access errors (various browser error formats)
  return (
    message.includes("window.webkit.messageHandlers") ||
    message.includes("webkit.messageHandlers")
  );
};

/**
 * Check if an error is a SpacetimeDB WebSocket "Still in CONNECTING state" error.
 * These occur when the SpacetimeDB SDK tries to send a message on a WebSocket that
 * hasn't fully transitioned to the OPEN state yet. This is a race condition in the
 * SDK's internal connection handling that can occur on slower networks or mobile devices.
 *
 * UX note: These errors are transient and handled gracefully:
 * - The useTowerDefense hook shows a "Connecting..." state during connection
 * - Connection errors trigger a mode change back to "lobby" with an error message
 * - Users can retry with the "Start New Run" or "Resume" button
 *
 * We cannot fix this in the SpacetimeDB SDK itself as it's a third-party library.
 * The error originates from the SDK's websocket_decompress_adapter.ts send() method.
 *
 */
const isSpacetimeDBWebSocketConnectingError = (event: Sentry.ErrorEvent): boolean => {
  const message = event.exception?.values?.[0]?.value ?? "";
  const errorType = event.exception?.values?.[0]?.type ?? "";
  const stackFrames = event.exception?.values?.[0]?.stacktrace?.frames ?? [];

  // Must be an InvalidStateError with the specific WebSocket CONNECTING message
  if (errorType !== "InvalidStateError" && errorType !== "DOMException") return false;
  if (!message.includes("Still in CONNECTING state")) return false;

  // Additional check: verify it's from SpacetimeDB SDK (websocket_decompress_adapter or db_connection_impl)
  const isFromSpacetimeDB = stackFrames.some(
    (frame) =>
      frame.filename?.includes("spacetimedb") ||
      frame.filename?.includes("websocket_decompress_adapter") ||
      frame.filename?.includes("db_connection_impl") ||
      frame.abs_path?.includes("spacetimedb") ||
      frame.abs_path?.includes("websocket_decompress_adapter") ||
      frame.abs_path?.includes("db_connection_impl"),
  );

  // If we can verify it's from SpacetimeDB, filter it
  // If stack trace is empty/anonymized (production builds), still filter based on message
  return isFromSpacetimeDB || stackFrames.length === 0;
};

/**
 * Check if an error is from a third-party userscript or browser extension.
 * Userscripts (Tampermonkey, Greasemonkey, Violentmonkey) are user-installed scripts
 * that modify web pages. They may break when our application's DOM structure or APIs change.
 *
 * This function checks ALL exception values in the event, as Sentry may group multiple
 * related errors into a single event. If any exception value matches userscript patterns,
 * the entire event is filtered.
 *
 * UX note: These errors do not affect application functionality for users without the
 * userscript installed. Users with broken userscripts may see the script fail silently,
 * but the core application continues to work. Users can disable or update their userscripts
 * if they notice issues with custom functionality they've added.
 *
 * Common patterns:
 * - app:///userscripts/[script-name].user.js (Tampermonkey/Greasemonkey URL scheme)
 * - *.user.js file extensions (standard userscript naming)
 * - Minified variable names like "d", "a", "e" in error messages from bundled scripts
 * - Errors referencing our pages but originating from injected code
 * - Filter errors from userscripts like "Jutsu-Hotkeys" that add keyboard shortcuts for
 *   jutsu actions. These scripts may have compatibility issues when page structure changes.
 */
const isUserscriptError = (event: Sentry.ErrorEvent): boolean => {
  const exceptionValues = event.exception?.values ?? [];
  const breadcrumbs = event.breadcrumbs ?? [];

  // DEFENSE-IN-DEPTH: Early check for userscript breadcrumbs combined with single-letter errors
  // This catches edge cases where multiple exception values have varying structures
  // (some with clear userscript frames, others with only page context pollution).
  // When a userscript console breadcrumb is present AND the error matches userscript patterns,
  // filter immediately without complex stack frame analysis.
  const hasUserscriptBreadcrumb = checkHasUserscriptBreadcrumb(breadcrumbs);

  if (hasUserscriptBreadcrumb) {
    const hasSingleLetterVarError = checkHasSingleLetterVarError(exceptionValues);

    if (hasSingleLetterVarError) {
      return true; // Filter immediately - strong evidence of userscript error
    }
  }

  // Check if ANY exception value is from a userscript
  return exceptionValues.some((exception) => {
    const message = exception.value ?? "";
    const stackFrames = exception.stacktrace?.frames ?? [];

    // Check if error originates from a userscript
    // Userscripts use the app:/// URL scheme with /userscripts/ path
    const isFromUserscript = hasUserscriptStackSignal(stackFrames);

    if (!isFromUserscript) {
      return false;
    }

    // Check for userscript-internal error patterns that should always be filtered:
    // 1. Single-letter variable errors (typical of minified userscripts) like "d is not defined"
    // 2. Userscript-specific function patterns like window["__f__..."]
    // Note: This uses a more permissive pattern than checkHasSingleLetterVarError because
    // we already know we're in userscript frames. It also matches dot notation (e.g., "d.")
    // which is common in minified userscript code accessing undefined objects.
    const isSingleLetterVarError = /(?:^|:\s*)[a-z](?:\s+is\s+not\s+(?:defined|a\s+function)|\.)/i.test(message);

    const hasUserscriptFunctionPattern = stackFrames.some((frame) => {
      const func = frame.function ?? "";
      return hasUserscriptFunctionName(func);
    });

    // If it's clearly a userscript-internal error, filter it regardless of mixed stack
    if (isSingleLetterVarError || hasUserscriptFunctionPattern) {
      return true;
    }

    // Additional safety check: Distinguish between userscript-only errors and userscripts breaking app functionality
    //
    // Case 1: Userscript-only error (should filter):
    // - Userscript has internal bug (e.g., "d is not defined" from minified code)
    // - Error bubbles up through page context causing anonymized frames like:
    //   app:///manual:? in At
    //   app:///manual:? in r<
    // - These are page context pollution, not actual application code involvement
    //
    // Case 2: Userscript breaking app (should NOT filter):
    // - Userscript modifies DOM or globals that break application code
    // - Stack trace includes meaningful Next.js frames like:
    //   /_next/static/chunks/app-pages-browser_src_layout_Loader_tsx.js:1:2345 in LoaderComponent
    // - Function names and line numbers indicate real application code execution
    //
    // Refined check to look for MEANINGFUL app code frames, not just page URLs
    //
    // Check if error stack includes MEANINGFUL application code (not just page context pollution)
    // Real app code has:
    // 1. /_next/ paths (Next.js compiled chunks)
    // 2. Meaningful function names (not just "?", "r<", "At", "_")
    // 3. Line numbers indicating actual code execution
    //
    // Page context pollution has:
    // 1. Page URLs like "app:///manual", "app:///occupation"
    // 2. Anonymized/minified function names ("?", "r<", "At", "_", etc.)
    // 3. Often missing line numbers
    const hasAppCodeFrames = hasMeaningfulAppCodeFrame(stackFrames);

    // Only filter if the error is purely from the userscript (no app code in stack)
    // If there's app code mixed in, let it through - might be a real issue
    return !hasAppCodeFrames;
  });
};

/**
 * Check if an error is from a Google JS API loader (maps.googleapis.com, jsapi_compiled).
 * The app loads no Google Maps or JS API loader of its own; these come from third-party
 * scripts whose loader fails on network issues, ad blockers or Google CDN outages.
 *
 * UX note: no game screen or loading state depends on these scripts.
 *
 * Common patterns:
 * - "Jsloader error" message (caught by ignoreErrors, but some slip through as
 *   non-Error promise rejections with different serialized formats)
 * - Stack frames from maps.googleapis.com or jsapi_compiled scripts
 * - Non-Error rejection objects containing script load failure details
 */
const isGoogleApiLoaderError = (event: Sentry.ErrorEvent): boolean => {
  const message =
    event.exception?.values?.[0]?.value ?? event.message ?? "";
  const stackFrames = event.exception?.values?.[0]?.stacktrace?.frames ?? [];

  if (message.includes("Jsloader error")) {
    return true;
  }

  const isFromGoogleMaps = stackFrames.some((frame) => {
    const filename = frame.filename ?? "";
    const absPath = frame.abs_path ?? "";

    // Check for jsapi_compiled (not a URL, just a script identifier)
    if (filename.includes("jsapi_compiled") || absPath.includes("jsapi_compiled")) {
      return true;
    }

    // Safely validate URLs using URL constructor to prevent spoofing
    for (const path of [filename, absPath]) {
      if (!path) continue;
      try {
        const url = new URL(path);
        if (url.hostname === "maps.googleapis.com") {
          return true;
        }
      } catch {
        // Not a valid URL, skip
      }
    }

    return false;
  });

  if (isFromGoogleMaps) {
    return true;
  }

  if (message.includes("__googleMapsScriptId")) {
    return true;
  }

  return false;
};

/**
 * Check if an error is a browser history.pushState() rate limit error.
 * These occur when multiple third-party analytics scripts (Vercel Speed Insights,
 * Google Tag Manager, i18n tracking pixel) collectively exceed the browser's
 * 100 calls per 10 seconds security limit during rapid user navigation.
 *
 * UX note: This error does not affect user experience:
 * - Users can still navigate normally - only third-party logging is rate-limited
 * - No user-visible error occurs - caught by Sentry's global handler
 * - This is a browser security feature preventing history manipulation attacks
 *
 * Stack trace patterns show errors originating from:
 * - app:///_vercel/speed-insights/script.js (Vercel Speed Insights)
 * - app:///gtag/js (Google Tag Manager/Analytics)
 * - app:///i18n/pixel/ (i18n tracking pixel)
 * - node_modules/next/ (Next.js App Router internal navigation)
 *
 */
const isHistoryPushStateRateLimitError = (event: Sentry.ErrorEvent): boolean => {
  // Check all exception values, not just the first one
  const exceptionValues = event.exception?.values ?? [];

  // The ignoreErrors entry drops every event whose main exception carries this message.
  // This check covers the other exception values, and only when no frame is ours.
  return exceptionValues.some((exception) => {
    const message = exception.value ?? "";
    if (!message.includes("Attempt to use history.pushState() more than 100 times per 10 seconds")) {
      return false;
    }

    // Check stack frames to ensure this isn't from our application code
    const frames = exception.stacktrace?.frames ?? [];
    const hasAppFrames = frames.some(isOwnAppFrame);

    // Only filter if no app frames are present (third-party origin)
    return !hasAppFrames;
  });
};

/**
 * Check if an error is a ChunkLoadError captured through console breadcrumbs.
 * These occur during deployments when browsers attempt to load chunks that no
 * longer exist due to cache invalidation. Next.js logs these to console.error()
 * for debugging but handles them internally (retry or error boundary).
 *
 * UX note: Users may briefly see a loading state during chunk load failure, but
 * Next.js automatically retries or reloads the page. This is expected behavior
 * during deployments. The error resolves when the user gets fresh HTML with
 * correct chunk references.
 *
 * Detection pattern:
 * - Error has no meaningful exception message (<unknown> or empty)
 * - Console breadcrumb contains "ChunkLoadError" or "Failed to load chunk"
 * - Minimal or no stack trace (console logs don't generate stack traces)
 *
 * Note: The "Failed to load chunk" ignoreErrors entry catches most ChunkLoadError exceptions.
 * This function provides defense-in-depth for the console breadcrumb variant
 * that bypasses ignoreErrors pattern matching.
 *
 */
const isChunkLoadConsoleError = (event: Sentry.ErrorEvent): boolean => {
  const message = event.exception?.values?.[0]?.value ?? "";
  const errorType = event.exception?.values?.[0]?.type ?? "";
  const stackFrames = event.exception?.values?.[0]?.stacktrace?.frames ?? [];
  const breadcrumbs = event.breadcrumbs ?? [];

  // Check if the error has no meaningful exception message
  const hasNoMeaningfulException =
    message === "" ||
    message === "<unknown>" ||
    errorType === "" ||
    errorType === "<unknown>";

  if (!hasNoMeaningfulException) {
    return false;
  }

  // Check if there's a console breadcrumb indicating a ChunkLoadError
  const hasChunkLoadBreadcrumb = breadcrumbs.some((breadcrumb) => {
    if (breadcrumb.category !== "console") return false;

    const breadcrumbMessage = breadcrumb.message ?? "";
    return (
      breadcrumbMessage.includes("ChunkLoadError") ||
      breadcrumbMessage.includes("Failed to load chunk")
    );
  });

  if (!hasChunkLoadBreadcrumb) {
    return false;
  }

  // Additional validation: Console-based errors have no stack trace
  const hasMinimalStackTrace = stackFrames.length === 0;

  return hasMinimalStackTrace;
};

/**
 * Check if an error is a third-party tracking pixel JSON parsing error.
 * These occur when tracking pixel scripts (Reddit Pixel, TikTok Pixel, Facebook Pixel, etc.)
 * attempt to parse HTTP responses as JSON but receive HTML error pages (502/503/504) from
 * the ad network's CDN instead.
 *
 * UX note: This error is not visible to users and does not affect application functionality.
 * It occurs in isolated third-party tracking script contexts when ad networks experience
 * transient CDN/API outages. Users never see these errors - the pixel scripts fail silently
 * and only analytics/tracking may be affected while core application continues normally.
 *
 * Detection pattern:
 * - SyntaxError with "<!doctype"/"<!DOCTYPE" in "is not valid JSON" message
 * - Originates from ads/pixel.js or similar tracking scripts
 * - XHR mechanism: auto.browser.browserapierrors.xhr.onreadystatechange
 * - Breadcrumbs may show pixel-config endpoint requests (Reddit, TikTok, Facebook, etc.)
 *
 * CORS handling: When third-party scripts are anonymized due to cross-origin restrictions,
 * we fall back to breadcrumb-based detection (XHR + pixel configuration endpoint).
 *
 */
const isThirdPartyPixelJsonParseError = (event: Sentry.ErrorEvent): boolean => {
  const message = event.exception?.values?.[0]?.value ?? "";
  const errorType = event.exception?.values?.[0]?.type ?? "";
  const stackFrames = event.exception?.values?.[0]?.stacktrace?.frames ?? [];
  const mechanism = event.exception?.values?.[0]?.mechanism?.type ?? "";
  const breadcrumbs = event.breadcrumbs ?? [];

  // Must be a SyntaxError with HTML DOCTYPE in JSON parsing error
  if (errorType !== "SyntaxError") return false;
  if (!message.includes("is not valid JSON")) return false;
  if (!(message.includes("<!doctype") || message.includes("<!DOCTYPE"))) return false;

  // Check if error originates from third-party pixel scripts
  // Reddit's pixel script may appear as:
  // - app:///ads/pixel.js (third-party script URL scheme)
  // - Anonymous frames due to cross-origin restrictions
  const isFromPixelScript = stackFrames.some((frame) => {
    const filename = frame.filename ?? "";
    const absPath = frame.abs_path ?? "";

    // Check for pixel script paths
    if (filename.includes("ads/pixel.js") || absPath.includes("ads/pixel.js")) {
      return true;
    }
    if (filename.includes("pixel.js") || absPath.includes("pixel.js")) {
      return true;
    }

    // Check for Reddit pixel domain with proper URL validation
    try {
      if (filename.startsWith("http")) {
        const url = new URL(filename);
        if (url.hostname === "pixel-config.reddit.com") return true;
      }
      if (absPath.startsWith("http")) {
        const url = new URL(absPath);
        if (url.hostname === "pixel-config.reddit.com") return true;
      }
    } catch {
      // If URL parsing fails, don't fall back to substring check as it's unsafe
      // Non-URL paths without valid hostnames are unlikely to be from reddit's pixel config
      // and substring matching could be spoofed (e.g., "malicious-pixel-config.reddit.com.evil.com")
    }

    return false;
  });

  if (isFromPixelScript) {
    return true;
  }

  // Fallback detection for CORS-anonymized stack traces:
  // If stack trace is empty/minimal AND we see XHR mechanism AND pixel config breadcrumbs,
  // this is likely a tracking pixel error that was anonymized due to cross-origin restrictions
  const isXhrMechanism = mechanism.includes("xhr");
  const hasPixelConfigBreadcrumb = breadcrumbs.some((breadcrumb) => {
    if (breadcrumb.category !== "xhr" && breadcrumb.category !== "fetch") return false;
    const url = breadcrumb.data?.url ?? "";

    // Check for path-based patterns first
    if (url.includes("/pixel/") || url.includes("/ads/")) {
      return true;
    }

    // For domain checks, use proper URL validation
    try {
      const urlObj = new URL(url);
      return urlObj.hostname === "pixel-config.reddit.com" || urlObj.hostname.endsWith(".reddit.com");
    } catch {
      // If URL parsing fails, check for relative paths that match pixel patterns
      // but don't use substring check as it's unsafe (could match anywhere in URL)
      return url.startsWith("/pixel/") || url.startsWith("/ads/");
    }
  });

  // Filter if XHR mechanism + pixel breadcrumb + HTML JSON parse error
  // (catches cases where stack trace is anonymized due to CORS)
  if (isXhrMechanism && hasPixelConfigBreadcrumb) {
    return true;
  }

  return false;
};

/**
 * Check if an error is a clipboard write permission error that should be filtered.
 * These occur when browsers deny clipboard write access due to permission settings,
 * security policies, or browser-specific restrictions (e.g., Huawei Browser).
 *
 * UX note: These errors are handled gracefully with toast notifications showing
 * "Could not copy to clipboard. Please copy the link/code manually." The user is
 * informed and can manually select and copy the text.
 *
 * Filter clipboard permission errors with graceful UX fallback.
 */
const isClipboardPermissionError = (event: Sentry.ErrorEvent): boolean => {
  const message = event.exception?.values?.[0]?.value ?? "";
  const errorType = event.exception?.values?.[0]?.type ?? "";

  return (
    (errorType === "NotAllowedError" || errorType === "DOMException") &&
    message.includes("Write permission denied")
  );
};

/**
 * Check if an error is a Firefox NS_ERROR from third-party scripts.
 *
 * NS_ERROR_* are Firefox-specific internal error codes (Netscape Error legacy, XPCOM)
 * that occur when third-party scripts encounter browser-level failures. Common sources:
 * - Advertising/tracking pixels (app:///ads/pixel.js, pixel-config.reddit.com)
 * - Browser extensions interfering with page scripts
 * - Ad blockers blocking third-party requests
 * - CDN timeouts or network issues for third-party resources
 *
 * Common NS_ERROR types from third-party scripts:
 * - NS_ERROR_FAILURE (0x80004005): Generic unspecified error
 * - NS_ERROR_NOT_AVAILABLE: Resource/service not available
 * - NS_ERROR_ABORT: Operation aborted
 *
 * UX note: These errors are not visible to users and do not affect application
 * functionality. They occur in isolated third-party script contexts that fail
 * independently of our application. The tRPC error handler in Provider.tsx handles
 * any application errors gracefully. Users without the particular third-party script
 * installed will never see these errors.
 *
 * Detection pattern:
 * - Error type starts with "NS_ERROR_"
 * - Stack trace from app:/// URL scheme (browser extension/injected script) OR
 *   known third-party script paths (ads/, pixel.js)
 * - Often has empty or minimal error messages
 * - Anonymous/minified function names in stack (cross-origin restrictions)
 *
 * The /NS_ERROR_/ ignoreErrors entry drops every event whose main exception is an
 * NS_ERROR, own frames or not, so this third-party scoping applies only to NS_ERRORs
 * among the event's other exception values.
 */
const isFirefoxNSError = (event: Sentry.ErrorEvent): boolean => {
  const exceptionValues = event.exception?.values ?? [];

  // Check if ANY exception value is an NS_ERROR from third-party scripts
  return exceptionValues.some((exception) => {
    const errorType = exception.type ?? "";
    const stackFrames = exception.stacktrace?.frames ?? [];

    // Must be an NS_ERROR type
    if (!errorType.startsWith("NS_ERROR_")) {
      return false;
    }

    // Verify it's from third-party scripts (not our application code)
    // Check for app:/// URL scheme (extensions/injected scripts)
    const isFromAppProtocol = stackFrames.some(
      (frame) =>
        frame.filename?.startsWith("app:///") ||
        frame.abs_path?.startsWith("app:///")
    );

    // Check for common third-party script patterns
    const isFromThirdPartyScript = stackFrames.some(
      (frame) =>
        frame.filename?.includes("ads/") ||
        frame.filename?.includes("pixel.js") ||
        frame.abs_path?.includes("ads/") ||
        frame.abs_path?.includes("pixel.js")
    );

    // Check if all our application code is absent from stack
    // (If our code is present, don't filter - could be actionable)
    const hasOurCode = stackFrames.some((frame) => {
      const filename = frame.filename ?? "";
      const absPath = frame.abs_path ?? "";

      // Check for Next.js paths
      if (filename.includes("/_next/") || absPath.includes("/_next/")) {
        return true;
      }

      // Check for our domain with proper URL validation
      try {
        if (filename.startsWith("http")) {
          const url = new URL(filename);
          if (url.hostname === "theninja-rpg.com" || url.hostname.endsWith(".theninja-rpg.com")) {
            return true;
          }
        }
        if (absPath.startsWith("http")) {
          const url = new URL(absPath);
          if (url.hostname === "theninja-rpg.com" || url.hostname.endsWith(".theninja-rpg.com")) {
            return true;
          }
        }
      } catch {
        // If URL parsing fails, don't fall back to substring check as it's unsafe
        // Substring matching could be spoofed (e.g., "malicious-theninja-rpg.com.evil.com")
      }

      return false;
    });

    // Filter if from third-party sources AND not from our code
    return (isFromAppProtocol || isFromThirdPartyScript) && !hasOurCode;
  });
};

/**
 * Shared utility to check if a function name matches userscript-specific patterns.
 *
 * Important: anonymous function placeholders like "?" are intentionally excluded.
 * Sentry commonly uses "?" for anonymous Firefox frames, and treating that as a
 * userscript signal can incorrectly classify legitimate application errors.
 */
const hasUserscriptFunctionName = (funcName: string): boolean => {
  // Minified function patterns like window["__f__mm6eqil6.gsn"]
  if (funcName.includes('window["__f__') || funcName.includes("window['__f__")) {
    return true;
  }

  // Only match < when it's part of typical userscript patterns
  // like "r<", "At<", or ends with "/<" (bundled script artifacts)
  // This avoids matching legitimate component names like "<MyComponent>"
  if (funcName.includes("<")) {
    return /^[a-zA-Z_]{1,3}</.test(funcName) || funcName.endsWith("/<");
  }

  return false;
};

type UserscriptStackFrame = {
  filename?: string;
  abs_path?: string;
  function?: string;
  lineno?: number;
};

const hasUserscriptStackSignal = (
  stackFrames: Array<UserscriptStackFrame>,
): boolean => {
  return stackFrames.some((frame) => {
    const filename = frame.filename ?? "";
    const absPath = frame.abs_path ?? "";
    const func = frame.function ?? "";

    return (
      filename.includes("app:///userscripts/") ||
      absPath.includes("app:///userscripts/") ||
      isUserscriptFilename(filename) ||
      isUserscriptFilename(absPath) ||
      hasUserscriptFunctionName(func)
    );
  });
};

/**
 * Match a Tampermonkey/Greasemonkey script path. Tampermonkey appends an
 * injection index to the source URL (e.g. "app:///%20TNR%20Builder.user.js#26"),
 * so the extension must be matched allowing a trailing fragment or query rather
 * than only at the very end of the string.
 */
const isUserscriptFilename = (path: string): boolean => {
  return /\.user\.js(?:[#?]|$)/.test(path);
};

const hasMeaningfulAppCodeFrame = (
  stackFrames: Array<UserscriptStackFrame>,
): boolean => {
  return stackFrames.some((frame) => {
    const filename = frame.filename ?? "";
    const absPath = frame.abs_path ?? "";
    const func = frame.function ?? "";

    if (filename.includes("app:///userscripts/") || absPath.includes("app:///userscripts/")) {
      return false;
    }

    const isPageContextPollution =
      (filename.startsWith("app:///") && !filename.includes("/_next/")) ||
      (absPath.startsWith("app:///") && !absPath.includes("/_next/"));
    if (isPageContextPollution) {
      return false;
    }

    const isNextJsCode = filename.includes("/_next/") || absPath.includes("/_next/");
    if (!isNextJsCode) {
      return false;
    }

    const isAnonymizedFunction = /^([a-z_]|[a-z]<|\?|[A-Z][a-z]?)$/i.test(func);
    if (isAnonymizedFunction) {
      return false;
    }

    return true;
  });
};

/** Check if breadcrumbs contain userscript console logs. */
const checkHasUserscriptBreadcrumb = (
  breadcrumbs: Array<Sentry.Breadcrumb>,
): boolean => {
  return breadcrumbs.some((breadcrumb) => {
    if (breadcrumb.category !== "console") return false;
    const msg = breadcrumb.message ?? "";
    return (
      msg.includes("[Persistent Keybinds]") ||
      msg.includes("[Jutsu-Hotkeys]") ||
      msg.includes("[Tampermonkey]") ||
      msg.includes("[Greasemonkey]") ||
      msg.includes("[Violentmonkey]") ||
      msg.toLowerCase().includes("userscript")
    );
  });
};

/**
 * Shared utility to check if a message contains single-letter variable error patterns.
 * These errors are typical of minified userscripts (e.g., "d is not defined").
 */
const isSingleLetterVarErrorMessage = (message: string): boolean => {
  // Handle error type prefixes like "ReferenceError: d is not defined"
  // Matches only "is not defined" or "is not a function" patterns
  return /(?:^|:\s*)[a-z]\s+is\s+not\s+(?:defined|a\s+function)/i.test(message);
};

/**
 * Check if exception values contain single-letter variable errors.
 * These errors are typical of minified userscripts (e.g., "d is not defined").
 */
const checkHasSingleLetterVarError = (
  exceptionValues: Array<{ value?: string }>,
): boolean => {
  return exceptionValues.some((exception) => {
    const message = exception.value ?? "";
    return isSingleLetterVarErrorMessage(message);
  });
};

/**
 * Check if a raw error object (not Sentry event) is from a userscript.
 * This is used in the global unhandledrejection handler to filter errors before Sentry sees them.
 *
 * UX note: Users who install userscripts via Tampermonkey/Greasemonkey accept that these
 * third-party scripts may break when the page structure changes. Filtering these errors
 * prevents noise in Sentry for issues we cannot fix.
 */
const isUserscriptRawError = (err: unknown): boolean => {
  if (!(err instanceof Error)) return false;

  const errorMessage = err.message ?? "";
  const errorStack = err.stack ?? "";

  // Check if error originates from a userscript
  // Userscripts use the app:/// URL scheme with /userscripts/ path
  const isFromUserscript =
    errorStack.includes("app:///userscripts/") ||
    errorStack.includes(".user.js");

  if (!isFromUserscript) {
    return false;
  }

  // Check for userscript-internal error patterns that should always be filtered:
  // 1. Single-letter variable errors (typical of minified userscripts) like "d is not defined"
  // 2. Userscript-specific function patterns (using shared utility)
  const isSingleLetterVarError = isSingleLetterVarErrorMessage(errorMessage);

  // Check if stack contains userscript function patterns
  // Note: For raw errors, we check the stack string directly since we don't have parsed frames
  const hasUserscriptPattern =
    errorStack.includes('window["__f__') ||
    errorStack.includes("window['__f__") ||
    // Match function name patterns at word boundaries: "at r<" or "at At<" or ends with "/<"
    // This avoids matching generic patterns like "Map<" that could appear anywhere
    /\bat\s+[a-zA-Z_]{1,3}</.test(errorStack) ||
    errorStack.includes("/< ");

  // Additional evidence: Check for userscript-specific console log patterns in the error context
  // Userscripts often log to console with identifiable prefixes like "[Persistent Keybinds]"
  const hasUserscriptLogPattern =
    errorStack.includes("[Persistent Keybinds]") ||
    errorStack.includes("[Jutsu-Hotkeys]") ||
    errorStack.includes("userscript");

  // If it's clearly a userscript-internal error, filter it
  if (isSingleLetterVarError || hasUserscriptPattern || hasUserscriptLogPattern) {
    return true;
  }

  // Additional safety check: If the error stack includes our /_next/ compiled code,
  // this might indicate the userscript is breaking our functionality
  const hasAppCodeInStack = errorStack.includes("/_next/");

  // Only filter if the error is purely from the userscript (no app code in stack)
  return !hasAppCodeInStack;
};

/**
 * Check if an error is a Response.json() body stream already read error.
 * These can occur when:
 * 1. Browser extensions intercept fetch requests and read body multiple times
 * 2. Code calls .json()/.text()/.blob() multiple times without cloning
 *
 * UX note: only events without meaningful frames are dropped, so the failed read
 * happened outside our code. A body read twice by our own code carries our frames and
 * keeps reporting.
 *
 * Common patterns:
 * - Minimal or anonymous stack traces (native browser API errors)
 * - TypeError from browser's fetch API
 * - Single or very low occurrence (timing-dependent race conditions)
 */
const isResponseBodyAlreadyReadError = (event: Sentry.ErrorEvent): boolean => {
  const message = event.exception?.values?.[0]?.value ?? "";
  const errorType = event.exception?.values?.[0]?.type ?? "";
  const stackFrames = event.exception?.values?.[0]?.stacktrace?.frames ?? [];

  // Must be a TypeError with the specific Response.json() message
  if (errorType !== "TypeError") return false;
  if (!message.includes("Failed to execute 'json' on 'Response'")) return false;
  if (!message.includes("body stream already read")) return false;

  // Additional validation: These errors typically have minimal stack traces
  // from native browser code or cross-origin contexts
  const hasMinimalStackTrace =
    stackFrames.length === 0 ||
    stackFrames.every(
      (frame) =>
        frame.function === "?" ||
        frame.function === "<anonymous>" ||
        frame.function === "<unknown>" ||
        !frame.filename ||
        frame.filename === "<anonymous>"
    );

  // Only filter if it has the minimal stack trace pattern; events with meaningful
  // frames pointing to our code stay reportable.
  return hasMinimalStackTrace;
};

/**
 * Check if an error is a React internal scheduler error.
 * These occur when React's concurrent rendering scheduler detects it's already
 * processing work when attempting to schedule new work. This is an internal
 * React assertion that can fire in rare edge cases during:
 * - Complex navigation patterns (same-page navigation, back button during async operations)
 * - Concurrent rendering transitions (React 19 with React Compiler)
 * - Third-party component interactions (Clerk's SignUp/SignIn components with routing="path")
 * - Browser-specific timing variations (Firefox, mobile browsers)
 *
 * Root cause: React's scheduler work loop enters a re-entrant state when:
 * 1. Scheduler starts work (sets isHostCallbackScheduled = true)
 * 2. During work, a navigation or state change triggers new scheduling
 * 3. Scheduler attempts to schedule again while already scheduled
 * 4. Internal assertion "Should not already be working." fires
 *
 * UX note: This error is not visible to users and does not affect functionality.
 * The error occurs in React's internal scheduler, not during actual rendering.
 * React's error recovery mechanisms handle these internal assertions gracefully.
 * Users continue their workflow without interruption.
 *
 * Detection pattern:
 * - Error message: "Should not already be working." (exact match with period)
 * - Error type: "Error" (generic)
 * - Stack trace: Only React/React DOM internal frames (scheduler.production.js, react-dom-client.production.js)
 * - No application code frames (pure React internal error)
 * - Minimal or no line numbers (minified production code)
 *
 * This error is not actionable at the application level:
 * - Originates deep in React's scheduler (we don't control this code)
 * - Transient timing-dependent edge case
 * - React team owns this code path (application code cannot prevent scheduler re-entrancy)
 */
const isReactSchedulerError = (event: Sentry.ErrorEvent): boolean => {
  const exceptionValues = event.exception?.values ?? [];

  // Check if ANY exception value matches the React scheduler error pattern
  return exceptionValues.some((exception) => {
    const message = exception?.value ?? "";
    const errorType = exception?.type ?? "";
    const stackFrames = exception?.stacktrace?.frames ?? [];

    // Must be the exact "Should not already be working." error message (with period)
    if (message !== "Should not already be working.") {
      return false;
    }

    // Typically a generic "Error" type (React throws this internally)
    if (errorType !== "Error" && errorType !== "") {
      return false;
    }

    // Verify it's from React internal code (scheduler or react-dom-client)
    // If stack trace is empty (production builds may strip stack traces), we still filter
    // based on the unique message, as it's React-specific
    if (stackFrames.length === 0) {
      return true; // Unique message + no stack = React internal error
    }

    // Check if ALL stack frames are from React scheduler or React DOM client
    // If ANY frame is from application code, don't filter (could indicate app triggering issue)
    const isFromReactInternals = stackFrames.every((frame) => {
      const filename = frame?.filename ?? "";
      const absPath = frame?.abs_path ?? "";

      // Must be from React/Next.js compiled code (not our application code)
      const isReactCode =
        filename.includes("scheduler.production.js") ||
        filename.includes("react-dom-client.production.js") ||
        filename.includes("scheduler.development.js") ||
        filename.includes("react-dom-client.development.js") ||
        absPath.includes("scheduler.production.js") ||
        absPath.includes("react-dom-client.production.js") ||
        absPath.includes("scheduler.development.js") ||
        absPath.includes("react-dom-client.development.js");

      // If we have frames, they should all be from React internals (no app code mixed in)
      // If a frame isn't identifiable as React code, be conservative and don't filter
      return isReactCode || filename === "" || absPath === "";
    });

    return isFromReactInternals;
  });
};

/**
 * Check if an error is a Firefox input stream error that should be filtered.
 *
 * Firefox throws "Error in input stream" when the browser's fetch implementation
 * encounters errors reading response streams. This typically occurs during:
 * - Network interruptions during fetch (mobile network changes, Wi-Fi handoff)
 * - Corrupted or incomplete responses from CDN/proxy
 * - Next.js RSC (React Server Components) payload stream failures
 * - Browser internal stream reader errors
 *
 * Key characteristics:
 * - Error message: "Error in input stream" (Firefox-specific)
 * - Error type: "TypeError" (browser-level type error)
 * - No stack trace or minimal browser-level frames (error before JS execution)
 * - Often marked as handled=yes (Firefox's fetch catches it internally)
 * - Common during navigation with _rsc query parameter (RSC prefetch)
 *
 * This is Firefox's equivalent to Chrome's "Failed to fetch" or Safari's "Load failed".
 *
 * UX Handling:
 * - Next.js RSC has built-in retry logic for failed prefetch/navigation requests
 * - Firefox's fetch implementation handles the error internally (handled=yes)
 * - Users experience normal navigation; failed streams fall back to fresh requests
 * - No user-visible error unless all retries fail (would see different error)
 *
 * Edge cases handled:
 * 1. Case-insensitive matching for Firefox version variations
 * 2. Stack trace validation to avoid filtering application bugs
 * 3. Only filters if error is browser-level (no application code in stack)
 * 4. Type validation to ensure it's a TypeError or generic Error
 */
const isFirefoxInputStreamError = (event: Sentry.ErrorEvent): boolean => {
  const message = (event.exception?.values?.[0]?.value ?? "").toLowerCase();
  const errorType = event.exception?.values?.[0]?.type ?? "";
  const stackFrames = event.exception?.values?.[0]?.stacktrace?.frames ?? [];

  // Must contain "error in input stream" (case-insensitive)
  if (!message.includes("error in input stream")) {
    return false;
  }

  // Typically "TypeError" but may be empty or "Error" for browser-level errors
  // Don't filter custom error types (could be application-level)
  const isValidErrorType =
    errorType === "TypeError" || errorType === "" || errorType === "Error";
  if (!isValidErrorType) {
    return false;
  }

  // If no stack trace, this is a browser-level error (safe to filter)
  if (stackFrames.length === 0) {
    return true;
  }

  // If stack trace exists, verify it contains NO application code
  // Only filter if all frames are from browser internals or Next.js/React
  const hasApplicationCode = stackFrames.some((frame) => {
    const filename = frame.filename ?? "";
    const absPath = frame.abs_path ?? "";
    const combinedPath = (filename + absPath).toLowerCase();

    // Check if frame is from application code
    return (
      combinedPath.includes("src/app/") ||
      combinedPath.includes("src/layout/") ||
      combinedPath.includes("src/libs/") ||
      combinedPath.includes("src/routers/") ||
      combinedPath.includes("src/server/") ||
      combinedPath.includes("src/utils/") ||
      combinedPath.includes("src/validators/")
    );
  });

  // Only filter if there's NO application code in the stack
  return !hasApplicationCode;
};



const ensureBrowserErrorHandler = () => {
  if (typeof window === "undefined") return;
  if (window.__TNR_GLOBAL_REJECTION_HANDLER__) return;
  window.__TNR_GLOBAL_REJECTION_HANDLER__ = true;

  // Capture unhandled promise rejections
  window.addEventListener("unhandledrejection", (event) => {
    // Skip PayPal cleanup errors - these are expected when users navigate away
    if (isPayPalRejection(event.reason)) {
      event.preventDefault();
      return;
    }

    // Skip Clerk script loading errors - these occur on mobile due to network issues
    if (isClerkScriptLoadError(event.reason)) {
      event.preventDefault();
      return;
    }

    // Skip localStorage access errors - these occur when browser privacy settings block storage
    if (isLocalStorageAccessError(event.reason)) {
      event.preventDefault();
      return;
    }

    // Skip network fetch errors - these occur on iOS Safari due to device sleep or network changes
    if (isNetworkFetchError(event.reason)) {
      event.preventDefault();
      return;
    }

    // Skip TRPC errors that are handled by react-query's error handlers
    // These might bubble up as unhandled rejections due to timing issues
    if (isTRPCError(event.reason)) {
      event.preventDefault();
      return;
    }

    // Skip userscript errors - these are from third-party browser extensions
    // Users who install userscripts accept that these may break when page structure changes
    if (isUserscriptRawError(event.reason)) {
      event.preventDefault();
      return;
    }

    // Skip wallet-extension rejections. The game has no Web3 UI, so a missing
    // wallet account does not change what the player can do on the page.
    if (isInjectedWalletRejection(event.reason)) {
      event.preventDefault();
      return;
    }

    if (event.reason instanceof Error) {
      Sentry.captureException(event.reason);
    } else {
      // Safely serialize the rejection reason without circular references or read-only properties
      let reasonStr: string;
      try {
        reasonStr = JSON.stringify(event.reason);
      } catch {
        // If JSON.stringify fails (e.g., circular references), use a fallback
        reasonStr = String(event.reason);
      }
      // Create a completely new Error object without any reference to the original reason
      if (reasonStr !== "{}") {
        Sentry.captureException(new Error(`UnhandledRejection: ${reasonStr}`));
      }
    }
  });
};

// Ensure handlers are registered immediately after Sentry.init
ensureBrowserErrorHandler();

// Vercel BotID: attaches the challenge headers to tRPC mutations, which the server checks
// in botIdMiddleware. It patches window.fetch, so it must run before the tRPC client is
// built during hydration.
initBotId({ protect: BOTID_PROTECTED_ROUTES });

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
