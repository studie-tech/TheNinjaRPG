// This file configures the initialization of Sentry on the client.
// The config you add here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: "https://c35c54f99b73b4a3b8a7e60936bc2967@o4507797256601600.ingest.de.sentry.io/4507797262958672",

  // Replay may only be enabled for the client-side
  integrations: [
    Sentry.replayIntegration({ maskAllText: false, blockAllMedia: false }),
  ],

  // Adjust this value in production, or use tracesSampler for greater control
  tracesSampleRate: 0.001,

  // Which errors to ignore from frontend
  ignoreErrors: [
    "window.ethereum",
    "Cannot redefine property: walletRouter", // Cryptocurrency wallet extension error - occurs when wallet extensions (MetaMask, Coinbase Wallet, etc.) conflict or reinitialize
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
    /undefined is not an object \(evaluating 'window\.__firefox__\..*'\)/, // iOS browser extension error (Brave/Firefox) - extensions inject __firefox__ object that may be undefined
    "Failed to load chunk", // New deployment
    "Invalid call to runtime.sendMessage()", // Browser extension error, not from our app
    "zoid destroyed", // PayPal SDK cleanup errors - occur when users navigate away while PayPal buttons are initializing
    "Target window is closed", // PayPal SDK postrobot error - occurs when user closes popup before transaction completes
    "postrobot_method", // PayPal SDK cross-window communication error - occurs when popup is closed
    "Can not send postrobot", // PayPal SDK postrobot error - alternate format
    "Cannot set properties of undefined (setting 'iframeReady')", // Usercentrics (uc.js) consent management error - third-party script timing issue
    "Failed to fetch", // Network errors during navigation - occurs when user navigates away while fetch is in-flight (common on mobile)
    "network error", // Chrome/Android network error - occurs when fetch fails due to network issues on mobile devices
    /^Load failed/, // iOS Safari network error - occurs when device goes to sleep, network changes, or CDN requests fail (may include domain suffix)
    "Clerk: Failed to load Clerk", // Clerk script load failure - typically on very old browsers (Android 5.x, Chrome 95) that don't support modern JS
    "failed to load script", // Clerk's underlying script loading error (cause of the above) - network issues on mobile devices
    "Illegal invocation", // Third-party script error (Facebook in-app browser or Cookiebot)
    "Can't find variable: EmptyRanges", // Browser extension error (CodeMirror-based extensions)
    "Can't find variable: DarkReader", // DarkReader browser extension error - dark mode extension may fail to initialize
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
    "Jsloader error", // Google Maps JS API loader error - occurs when the @googlemaps/js-api-loader script fails to load (network issues, ad blockers, or Google CDN outages). Users see map not loading but the rest of the app works normally.
  ],

  // Filter out third-party errors that slip through ignoreErrors
  beforeSend(event) {
    if (isPayPalSdkError(event)) {
      return null; // Drop the event
    }
    if (isGoogleTranslateError(event)) {
      return null; // Drop Google Translate script errors
    }
    if (isClerkStorageError(event)) {
      return null; // Drop Clerk storage access errors
    }
    if (isThirdPartyInjectedError(event)) {
      return null; // Drop errors from injected scripts (e.g. Facebook/Cookiebot)
    }
    if (isEffectInterruptError(event)) {
      return null; // Drop Effect-TS fiber interruption errors (SpacetimeDB SDK)
    }
    if (isDataCloneError(event)) {
      return null; // Drop DataCloneError from third-party scripts (gtag, mediafilter)
    }
    if (isReplicateApiError(event)) {
      return null; // Drop Replicate API gateway errors (502/503/504)
    }
    if (isNetworkLoadError(event)) {
      return null; // Drop iOS Safari network errors (Load failed, Failed to fetch)
    }
    if (isHtmlResponseError(event)) {
      return null; // Drop HTML response parsing errors (CDN/proxy outages)
    }
    if (isInjectedJsonParseError(event)) {
      return null; // Drop JSON parsing errors from anonymous/injected code (browser extensions)
    }
    if (isClerkSyntaxError(event)) {
      return null; // Drop Clerk script parsing errors (network truncation)
    }
    if (isWalletExtensionError(event)) {
      return null; // Drop cryptocurrency wallet extension errors (MetaMask, etc.)
    }
    if (isThirdPartyStackOverflowError(event)) {
      return null; // Drop third-party stack overflow errors (tracking scripts)
    }
    if (isServerActionSsoCallbackError(event)) {
      return null; // Drop server action errors on SSO callback page (transient network issues)
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
      return null; // Drop Google Maps API loader errors (network/CDN failures)
    }
    return event;
  },

  // Only enable Sentry in production
  environment: process.env.NODE_ENV,

  // Only on production URLs
  // allowUrls: [/https?:\/\/(www\.)?theninja-rpg\.com.*/],

  /**
   * @function ReplaySessions/Errors
   * @description Captures Replay for 0% of all session, and 100% session with an Error
   */
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,

  // Setting this option to true will print useful information to the console while you're setting up Sentry.
  debug: false,
});

// Register a single browser-side global error handler for Promise rejections and uncaught errors.
declare global {
  interface Window {
    __TNR_GLOBAL_REJECTION_HANDLER__?: boolean;
  }
}

/**
 * Check if an error is a PayPal cleanup error that should be suppressed.
 * These occur when users navigate away while PayPal buttons are initializing.
 */
const isPayPalCleanupError = (err: unknown): boolean => {
  const errorMessage = err?.toString() ?? "";
  return (
    errorMessage.includes("zoid destroyed") ||
    errorMessage.includes("popup close") ||
    errorMessage.includes("Window closed") ||
    errorMessage.includes("Component closed") ||
    errorMessage.includes("Target window is closed") ||
    errorMessage.includes("postrobot_method") ||
    errorMessage.includes("paypal_js_sdk")
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
 * Check if an error is a network fetch error that should be suppressed.
 * These occur on iOS Safari when the device goes to sleep, network changes,
 * or the request is aborted during navigation. The "Load failed" message may
 * include a domain suffix like "(uploadthing.b-cdn.net)" for CDN requests.
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
 * THENINJARPG-278: Also filters stack overflow errors from PayPal SDK's zoid library,
 * which can occur during component cleanup when the internal promise handlers
 * (dispatch/resolve/reject) enter infinite recursion.
 */
const isPayPalSdkError = (event: Sentry.ErrorEvent): boolean => {
  const message = event.exception?.values?.[0]?.value ?? "";
  const errorType = event.exception?.values?.[0]?.type ?? "";
  const stackFrames = event.exception?.values?.[0]?.stacktrace?.frames ?? [];

  // Check message for PayPal-related error patterns
  const paypalErrorPatterns = [
    "zoid destroyed",
    "popup close",
    "Window closed",
    "Component closed",
    "Target window is closed",
    "postrobot_method",
    "paypal_js_sdk",
    "Can not send postrobot",
  ];

  if (paypalErrorPatterns.some((pattern) => message.includes(pattern))) {
    return true;
  }

  // Check if the error originates from PayPal SDK (sdk/js in stack trace)
  const isFromPayPalSdk = stackFrames.some(
    (frame) =>
      frame.filename?.includes("sdk/js") ||
      frame.filename?.includes("paypal") ||
      frame.abs_path?.includes("sdk/js") ||
      frame.abs_path?.includes("paypal"),
  );

  if (isFromPayPalSdk && message.includes("closed")) {
    return true;
  }

  // THENINJARPG-278: Filter PayPal SDK stack overflow errors
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
 * Check if an error is from an injected third-party script like Facebook or Cookiebot.
 * These often cause "Illegal invocation" errors in document.createEvent or similar.
 */
const isThirdPartyInjectedError = (event: Sentry.ErrorEvent): boolean => {
  const message = event.exception?.values?.[0]?.value ?? "";
  const stackFrames = event.exception?.values?.[0]?.stacktrace?.frames ?? [];

  const isInjectedScript = stackFrames.some(
    (frame) =>
      frame.filename?.includes("inject_content.js") ||
      frame.filename?.includes("uc.js") ||
      frame.filename?.includes("cc.js") ||
      frame.abs_path?.includes("inject_content.js") ||
      frame.abs_path?.includes("uc.js") ||
      frame.abs_path?.includes("cc.js"),
  );

  // Filter Illegal invocation errors from any injected script
  if (isInjectedScript && message.includes("Illegal invocation")) {
    return true;
  }

  // Filter Cookiebot-specific errors (cc.js) when manipulating DOM elements
  // THENINJARPG-23Y: sortBannerButtons tries to set innerHTML on null element
  const isCookiebotScript = stackFrames.some(
    (frame) =>
      frame.filename?.includes("cc.js") || frame.abs_path?.includes("cc.js"),
  );

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
 */
const isDataCloneError = (event: Sentry.ErrorEvent): boolean => {
  const message = event.exception?.values?.[0]?.value ?? "";
  const stackFrames = event.exception?.values?.[0]?.stacktrace?.frames ?? [];

  const isDataCloneMessage =
    message.includes("DataCloneError") ||
    (message.includes("postMessage") && message.includes("could not be cloned"));

  if (!isDataCloneMessage) return false;

  // Check if the error originates from third-party scripts
  return stackFrames.some(
    (frame) =>
      frame.filename?.includes("gtag/js") ||
      frame.filename?.includes("mediafilter") ||
      frame.abs_path?.includes("gtag/js") ||
      frame.abs_path?.includes("mediafilter"),
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
 *
 * THENINJARPG-2D1: Added safety filter error filtering for Replicate's content moderation.
 */
const isReplicateApiError = (event: Sentry.ErrorEvent): boolean => {
  const message = event.exception?.values?.[0]?.value ?? "";

  // Match TRPCClientError wrapping Replicate API gateway errors (502, 503, 504)
  // Use regex to properly match the domain (not just substring) to avoid false positives
  // from URLs like "evil-api.replicate.com.attacker.com"
  const isReplicateDomain =
    /(?:^|[/:])api\.replicate\.com(?:[/:$?]|$)/.test(message);

  const isGatewayError =
    isReplicateDomain &&
    (message.includes("502 Bad Gateway") ||
      message.includes("503 Service") ||
      message.includes("504 Gateway"));

  // Match Replicate safety filter errors (E005) - these occur when content moderation
  // flags the input or output as sensitive. This is expected user behavior, not a bug.
  // Error format: "Prediction failed: The input or output was flagged as sensitive. Please try again with different inputs. (E005)"
  const isSafetyFilterError =
    message.includes("Prediction failed") &&
    message.includes("flagged as sensitive") &&
    message.includes("E005");

  return isGatewayError || isSafetyFilterError;
};

/**
 * Check if an error is an iOS Safari "Load failed" network error.
 * These occur on Mobile Safari when network requests fail due to:
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
 * This filter serves as a backup to the ignoreErrors regex pattern, catching
 * errors that may slip through due to timing in Sentry's global handler.
 */
const isNetworkLoadError = (event: Sentry.ErrorEvent): boolean => {
  const message = event.exception?.values?.[0]?.value ?? "";
  const errorType = event.exception?.values?.[0]?.type ?? "";
  const hasStackTrace =
    (event.exception?.values?.[0]?.stacktrace?.frames?.length ?? 0) > 0;

  // Check for "Load failed" pattern (may have domain suffix like "(uploadthing.b-cdn.net)")
  const isLoadFailed = message.startsWith("Load failed");

  // Also check for "Failed to fetch" as a related network error
  const isFailedToFetch = message === "Failed to fetch";

  // Check for Chrome/Android "network error" message
  const isNetworkError = message === "network error";

  // These errors typically have no stack trace and are TypeError
  const isNetworkErrorShape =
    !hasStackTrace && (errorType === "TypeError" || errorType === "");

  return (isLoadFailed || isFailedToFetch || isNetworkError) && isNetworkErrorShape;
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
 * THENINJARPG-2D7: Filter these errors from Sentry as they are transient infrastructure issues.
 */
const isHtmlResponseError = (event: Sentry.ErrorEvent): boolean => {
  const message = event.exception?.values?.[0]?.value ?? "";
  const errorType = event.exception?.values?.[0]?.type ?? "";

  // Check for HTML DOCTYPE in JSON parsing error (CDN/proxy returning HTML error page)
  const isHtmlParsingError =
    message.includes('"<!DOCTYPE "') && message.includes("is not valid JSON");

  // This error comes from tRPC client as TRPCClientError or SyntaxError
  const isTrpcOrSyntaxError =
    errorType === "TRPCClientError" || errorType === "SyntaxError";

  return isHtmlParsingError && isTrpcOrSyntaxError;
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
 *
 * THENINJARPG-2CX: Filter these errors from Sentry.
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
 * Check if an error is from a cryptocurrency wallet browser extension.
 * These occur when users have MetaMask or similar wallet extensions installed,
 * and the extension's injected script encounters an error independently of our app.
 *
 * UX note: These errors are not actionable - they originate from third-party
 * browser extensions we don't control. Users don't see these errors as they
 * occur in the extension's isolated context. The application has no Web3/
 * cryptocurrency functionality.
 */
const isWalletExtensionError = (event: Sentry.ErrorEvent): boolean => {
  const message = event.exception?.values?.[0]?.value ?? "";
  const stackFrames = event.exception?.values?.[0]?.stacktrace?.frames ?? [];

  // Check for wallet-specific error patterns
  const isWalletErrorMessage =
    message.includes("Failed to connect to MetaMask") ||
    message.includes("No extension found with id:");

  if (isWalletErrorMessage) {
    return true;
  }

  // Check if error originates from wallet extension's injected script
  // - inpage.js is the common name for wallet extension content scripts
  // - app:///scripts/ is the URL scheme for browser extension injected scripts
  const isFromWalletScript = stackFrames.some(
    (frame) =>
      frame.filename?.includes("inpage.js") ||
      frame.filename?.startsWith("app:///scripts/") ||
      frame.abs_path?.includes("inpage.js") ||
      frame.abs_path?.startsWith("app:///scripts/"),
  );

  return isFromWalletScript;
};

/**
 * Check if an error is a Next.js server action reducer error on the SSO callback page.
 * These occur when network issues (transient CDN errors, mobile network changes) cause
 * server action responses to fail during the SSO authentication flow on UC Browser and mobile devices.
 *
 * UX note: Users experience a temporary error during SSO callback, but can retry or
 * manually navigate to complete authentication. This is a transient infrastructure issue
 * that doesn't indicate a bug in our code.
 *
 * THENINJARPG-1NM: Filter server action errors specifically on the SSO callback URL.
 */
const isServerActionSsoCallbackError = (event: Sentry.ErrorEvent): boolean => {
  const message = event.exception?.values?.[0]?.value ?? "";
  const url = event.request?.url ?? "";

  // Must be the specific Next.js server action error message
  if (!message.includes("An unexpected response was received from the server")) {
    return false;
  }

  // Must be on the SSO callback URL path
  // Matches: https://www.theninja-rpg.com/signup/sso-callback or similar paths
  const isSsoCallbackUrl =
    url.includes("/signup/sso-callback") || url.includes("/signin/sso-callback");

  return isSsoCallbackUrl;
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
 * THENINJARPG-1XW: Filter stack overflow errors from third-party tracking scripts.
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
 * THENINJARPG-2FP: Filter iOS WebKit bridge errors from third-party scripts.
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
 * - Users can retry by clicking the "Start Game" button again
 * - The SpacetimeDB client has waitForWebSocketReady() checks for critical operations
 *
 * We cannot fix this in the SpacetimeDB SDK itself as it's a third-party library.
 * The error originates from the SDK's websocket_decompress_adapter.ts send() method.
 *
 * THENINJARPG-2CN: Filter SpacetimeDB WebSocket timing errors from Sentry.
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
  const stackFrames = event.exception?.values?.[0]?.stacktrace?.frames ?? [];

  // Check if error originates from a userscript
  // Userscripts use the app:/// URL scheme with /userscripts/ path
  const isFromUserscript = stackFrames.some(
    (frame) =>
      frame.filename?.includes("app:///userscripts/") ||
      frame.abs_path?.includes("app:///userscripts/") ||
      // Some userscript managers use different URL patterns but standard .user.js extension
      frame.filename?.endsWith(".user.js") ||
      frame.abs_path?.endsWith(".user.js"),
  );

  if (!isFromUserscript) {
    return false;
  }

  // Additional safety check: If the error stack includes both userscript frames AND
  // our application code frames (from /_next/), this might indicate the userscript
  // is breaking our functionality. In that case, we want to see the error.
  const hasAppCodeFrames = stackFrames.some(
    (frame) =>
      (frame.filename?.includes("/_next/") || frame.abs_path?.includes("/_next/")) &&
      !frame.filename?.includes("app:///userscripts/") &&
      !frame.abs_path?.includes("app:///userscripts/"),
  );

  // Only filter if the error is purely from the userscript (no app code in stack)
  // If there's app code mixed in, let it through - might be a real issue
  return !hasAppCodeFrames;
};

/**
 * Check if an error is from the Google Maps JS API loader (@googlemaps/js-api-loader).
 * These errors occur when the Google Maps script fails to load due to network issues,
 * ad blockers, or Google CDN outages. The loader retries internally and then rejects
 * with a non-Error object that Sentry captures.
 *
 * UX note: Users see the map area fail to load, but the rest of the application
 * continues to work normally. The map component shows appropriate fallback UI.
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

const ensureBrowserErrorHandler = () => {
  if (typeof window === "undefined") return;
  if (window.__TNR_GLOBAL_REJECTION_HANDLER__) return;
  window.__TNR_GLOBAL_REJECTION_HANDLER__ = true;

  // Capture unhandled promise rejections
  window.addEventListener("unhandledrejection", (event) => {
    // Skip PayPal cleanup errors - these are expected when users navigate away
    if (isPayPalCleanupError(event.reason)) {
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

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
