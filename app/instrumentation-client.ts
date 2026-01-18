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
    "ClerkJS: Token refresh failed",
    "Converting circular structure to JSON",
    "Uncaught NetworkError: Failed to execute 'importScripts' on 'WorkerGlobalScope'",
    "CanvasRenderingContext2D.setTransform",
    "Java bridge method invocation error",
    "Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node.",
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
    "Can't find variable: __firefox__", // Firefox error
    "Failed to load chunk", // New deployment
    "Invalid call to runtime.sendMessage()", // Browser extension error, not from our app
    "zoid destroyed", // PayPal SDK cleanup errors - occur when users navigate away while PayPal buttons are initializing
    "Target window is closed", // PayPal SDK postrobot error - occurs when user closes popup before transaction completes
    "postrobot_method", // PayPal SDK cross-window communication error - occurs when popup is closed
    "Can not send postrobot", // PayPal SDK postrobot error - alternate format
    "Cannot set properties of undefined (setting 'iframeReady')", // Usercentrics (uc.js) consent management error - third-party script timing issue
    "Failed to fetch", // Network errors during navigation - occurs when user navigates away while fetch is in-flight (common on mobile)
    /^Load failed/, // iOS Safari network error - occurs when device goes to sleep, network changes, or CDN requests fail (may include domain suffix)
    "Clerk: Failed to load Clerk", // Clerk script load failure - typically on very old browsers (Android 5.x, Chrome 95) that don't support modern JS
    "failed to load script", // Clerk's underlying script loading error (cause of the above) - network issues on mobile devices
    "Illegal invocation", // Third-party script error (Facebook in-app browser or Cookiebot)
    "Can't find variable: EmptyRanges", // Browser extension error (CodeMirror-based extensions)
    "postMessage is not a function", // Clerk internal error - occurs in clerk.browser.js with Web Workers
    "module factory is not available", // Turbopack runtime error - occurs when browser caches stale JS chunks after deployment
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
function isPayPalCleanupError(err: unknown): boolean {
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
}

/**
 * Check if an error is a Clerk script loading error that should be suppressed.
 * These occur when the Clerk JS script fails to load on mobile devices due to
 * network issues, ad blockers, or browser restrictions.
 */
function isClerkScriptLoadError(err: unknown): boolean {
  const errorMessage = err?.toString() ?? "";
  return (
    errorMessage.includes("failed to load script") ||
    errorMessage.includes("failed_to_load_clerk_js") ||
    errorMessage.includes("Failed to load Clerk")
  );
}

/**
 * Check if an error is a localStorage access error caused by browser privacy settings.
 * These are SecurityErrors thrown when cookies/storage are blocked.
 */
function isLocalStorageAccessError(err: unknown): boolean {
  const msg = err?.toString() ?? "";
  return (
    msg.includes("localStorage") &&
    msg.includes("Access is denied") &&
    msg.includes("SecurityError")
  );
}

/**
 * Check if an error is a network fetch error that should be suppressed.
 * These occur on iOS Safari when the device goes to sleep, network changes,
 * or the request is aborted during navigation. The "Load failed" message may
 * include a domain suffix like "(uploadthing.b-cdn.net)" for CDN requests.
 */
function isNetworkFetchError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message ?? "";
  return msg.startsWith("Load failed") || msg === "Failed to fetch";
}

/**
 * Check if an error is a Clerk storage access error that should be filtered.
 * These occur when browser privacy settings block Clerk from accessing localStorage.
 */
function isClerkStorageError(event: Sentry.ErrorEvent): boolean {
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
}

/**
 * Check if an error is a TRPC error that should be handled by react-query's error handlers.
 * These are filtered out here to avoid duplicate error reporting.
 */
function isTRPCError(err: unknown): boolean {
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
}

/**
 * Check if an error is from Google Translate scripts that should be filtered.
 * When users access the site through Google Translate (translate.goog proxy),
 * Google's scripts sometimes fail when manipulating DOM elements.
 */
function isGoogleTranslateError(event: Sentry.ErrorEvent): boolean {
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
}

/**
 * Check if an error is a PayPal SDK cleanup error that should be filtered.
 * These occur when users navigate away while PayPal buttons are initializing,
 * or when users close the PayPal popup before the transaction completes.
 */
function isPayPalSdkError(event: Sentry.ErrorEvent): boolean {
  const message = event.exception?.values?.[0]?.value ?? "";
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

  return false;
}

/**
 * Check if an error is from an injected third-party script like Facebook or Cookiebot.
 * These often cause "Illegal invocation" errors in document.createEvent or similar.
 */
function isThirdPartyInjectedError(event: Sentry.ErrorEvent): boolean {
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

  return isInjectedScript && message.includes("Illegal invocation");
}

/**
 * Check if an error is from Effect-TS (used by SpacetimeDB SDK).
 * Effect-TS creates frozen error objects for fiber interruption, and Sentry
 * throws when trying to modify the `stack` property of these frozen objects.
 */
function isEffectInterruptError(event: Sentry.ErrorEvent): boolean {
  const message = event.exception?.values?.[0]?.value ?? "";
  return (
    message.includes("MicroCause.Interrupt") ||
    (message.includes("Cannot assign to read only property") &&
      message.includes("stack"))
  );
}

/**
 * Check if an error is a DataCloneError from third-party scripts.
 * These occur when scripts like Google Analytics (gtag) or mediafilter inject
 * code that tries to postMessage with DOM elements that cannot be cloned.
 * Common in Facebook's in-app browser.
 */
function isDataCloneError(event: Sentry.ErrorEvent): boolean {
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
}

/**
 * Check if an error is a Replicate API gateway error that should be filtered.
 * These occur when Replicate's API returns 502/503/504 errors during image generation.
 * These are transient third-party infrastructure issues we cannot fix.
 *
 * UX note: These errors are still displayed to users via the global tRPC error handler
 * in Provider.tsx which shows a toast notification. This filter only suppresses Sentry logging.
 */
const isReplicateApiError = (event: Sentry.ErrorEvent): boolean => {
  const message = event.exception?.values?.[0]?.value ?? "";

  // Match TRPCClientError wrapping Replicate API gateway errors (502, 503, 504)
  // Use regex to properly match the domain (not just substring) to avoid false positives
  // from URLs like "evil-api.replicate.com.attacker.com"
  const isReplicateDomain =
    /(?:^|[/:])api\.replicate\.com(?:[/:$?]|$)/.test(message);

  return (
    isReplicateDomain &&
    (message.includes("502 Bad Gateway") ||
      message.includes("503 Service") ||
      message.includes("504 Gateway"))
  );
};

function ensureBrowserErrorHandler() {
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
}

// Ensure handlers are registered immediately after Sentry.init
ensureBrowserErrorHandler();

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
