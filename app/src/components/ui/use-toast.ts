import type React from "react";
import { toast as sonnerToast } from "sonner";

// ---------------------------------------------------------------------------
// Types ---------------------------------------------------------------------
// ---------------------------------------------------------------------------

export type ToastVariant = "default" | "destructive";

export interface ToastOptions {
  /** Used as the main headline of the toast */
  title?: React.ReactNode;
  /** Additional details rendered under the title */
  description?: React.ReactNode;
  /** Visual intent: "destructive" renders sonner's error style */
  variant?: ToastVariant;
  /** Optional action element or configuration passed straight to sonner */
  action?: React.ReactNode;
  /** Display duration in milliseconds; omitted values use the toaster default. */
  duration?: number;
  /** Toasts sharing an id replace each other instead of stacking. */
  id?: string | number;
}

// ---------------------------------------------------------------------------
// Wrapper -------------------------------------------------------------------
// ---------------------------------------------------------------------------

/** Object-style toast adapter over `sonner`. */
export const toast = (options: ToastOptions) => {
  const { title, description, variant = "default", action, ...rest } = options;

  const message = title ?? "";
  const sonnerOpts = { description, action, ...rest };

  if (variant === "destructive") {
    return sonnerToast.error(message, sonnerOpts);
  }
  return sonnerToast(message, sonnerOpts);
};

// ---------------------------------------------------------------------------
// Re-exports -----------------------------------------------------------------
// ---------------------------------------------------------------------------

toast.dismiss = sonnerToast.dismiss;
