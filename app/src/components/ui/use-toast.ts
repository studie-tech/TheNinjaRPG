import type React from "react";
import { toast as sonnerToast } from "sonner";

// ---------------------------------------------------------------------------
// Types ---------------------------------------------------------------------
// ---------------------------------------------------------------------------

export type ToastVariant = "default" | "destructive";
export type ToastActionElement = React.ReactElement;

export interface ToastOptions {
  /** Used as the main headline of the toast */
  title?: React.ReactNode;
  /** Additional details rendered under the title */
  description?: React.ReactNode;
  /** Visual intent – maps to sonner's `success` / `error` helpers */
  variant?: ToastVariant;
  /** Optional action element or configuration passed straight to sonner */
  action?: React.ReactNode;
  /** Allow callers to pass any extra sonner props directly */
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Wrapper -------------------------------------------------------------------
// ---------------------------------------------------------------------------

/**
 * A thin wrapper that translates our historic toast signature to `sonner`.
 * The rest of the codebase can continue to call `toast({ ... })` exactly as
 * before without knowing about the underlying implementation change.
 */
export const toast = (options: ToastOptions) => {
  const { title, description, variant = "default", action, ...rest } = options;

  const message = title ?? "";
  const sonnerOpts = { description, action, ...rest } as Parameters<
    typeof sonnerToast
  >[1];

  if (variant === "destructive") {
    return sonnerToast.error(message, sonnerOpts);
  }
  return sonnerToast(message, sonnerOpts);
};

// ---------------------------------------------------------------------------
// Re-exports -----------------------------------------------------------------
// ---------------------------------------------------------------------------

toast.dismiss = sonnerToast.dismiss;
toast.success = sonnerToast.success;
toast.error = sonnerToast.error;
toast.info = sonnerToast.info;
toast.warning = sonnerToast.warning;
toast.loading = sonnerToast.loading;
toast.promise = sonnerToast.promise;

/**
 * The old implementation exposed a `useToast` hook. We still provide a stub so
 * that any imports keep working, even though the internals have changed.
 */
export const useToast = () => ({ toast });

export { toast as default };
