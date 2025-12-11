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
    "GME Provider is disconnected or locked", // timeout error
    "Connection closed", // timeout error
    "The play method is not allowed by the user agent or the platform in the current context, possibly because the user denied permission.", // audio permission denied
    "TypeError: undefined is not an object (evaluating 'this.updateVisibleFocusableElements.bind')", // Cookiebot error: https://github.com/getsentry/sentry-javascript/issues/16850
    "Failed to read a named property 'Element' from 'Window': Blocked a frame with origin \"https://www.theninja-rpg.com\"", // Sentry iframe error?
    "Cannot read properties of undefined (reading 'bind')", // Cookiebot error on resize
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
    "Failed to execute 'send' on 'WebSocket': Still in CONNECTING state.", // WebSocket error
    "Failed to read the 'localStorage' property from 'Window': Access is denied for this document.", // LocalStorage error
    "Can't find variable: __firefox__", // Firefox error
    "Failed to load chunk", // New deployment
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
  replaysOnErrorSampleRate: 1.0,

  // Setting this option to true will print useful information to the console while you're setting up Sentry.
  debug: false,
});

// Register a single browser-side global error handler for Promise rejections and uncaught errors.
declare global {
  interface Window {
    __TNR_GLOBAL_REJECTION_HANDLER__?: boolean;
  }
}

function ensureBrowserErrorHandler() {
  if (typeof window === "undefined") return;
  if (window.__TNR_GLOBAL_REJECTION_HANDLER__) return;
  window.__TNR_GLOBAL_REJECTION_HANDLER__ = true;

  // Capture unhandled promise rejections
  window.addEventListener("unhandledrejection", (event) => {
    if (event.reason instanceof Error) {
      Sentry.captureException(event.reason);
    } else {
      // Safely serialize the rejection reason without circular references or read-only properties
      let reasonStr: string;
      try {
        reasonStr = JSON.stringify(event.reason);
      } catch (stringifyError) {
        // If JSON.stringify fails (e.g., circular references), use a fallback
        reasonStr = String(event.reason);
      }
      // Create a completely new Error object without any reference to the original reason
      Sentry.captureException(new Error(`UnhandledRejection: ${reasonStr}`));
    }
  });
}

// Ensure handlers are registered immediately after Sentry.init
ensureBrowserErrorHandler();

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
