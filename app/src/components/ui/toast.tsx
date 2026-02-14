import type * as React from "react";
import { cn } from "@/libs/shadui";

export interface ToastActionProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible label for screen readers */
  altText?: string;
  ref?: React.Ref<HTMLButtonElement>;
}

/**
 * Minimal drop-in replacement for the old Radix based `<ToastAction>`.
 * It purposely keeps the same signature so that the rest of the codebase
 * doesn't need to change after switching to *sonner*.
 */
export const ToastAction = ({
  ref,
  className,
  altText,
  children,
  ...props
}: ToastActionProps) => (
  <button
    ref={ref}
    className={cn(
      "ml-auto inline-flex h-8 shrink-0 items-center justify-center rounded-md border bg-transparent px-3 font-medium text-sm transition-colors hover:bg-secondary focus:outline-none focus:ring-1 focus:ring-ring disabled:pointer-events-none disabled:opacity-50",
      className,
    )}
    aria-label={altText}
    {...props}
  >
    {children ?? altText}
  </button>
);
ToastAction.displayName = "ToastAction";

export type ToastActionElement = React.ReactElement<typeof ToastAction>;
