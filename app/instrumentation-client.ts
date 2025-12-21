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
    "Cannot set properties of null (setting 'innerHTML')", // Cookiebot error in sortBannerButtons when dialog not initialized
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
    "Cannot set properties of undefined (setting 'iframeReady')", // Usercentrics (uc.js) consent management error - third-party script timing issue
    "Failed to fetch", // Network errors during navigation - occurs when user navigates away while fetch is in-flight (common on mobile)
  ],

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
    errorMessage.includes("paypal_js_sdk")
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
