import type * as React from "react";
import { cn } from "@/libs/shadui";

export interface ToastActionProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible label for screen readers */
  altText?: string;
  ref?: React.Ref<HTMLButtonElement>;
}

/** Styled action button rendered inside a toast. */
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
