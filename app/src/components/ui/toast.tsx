import { Slot } from "@radix-ui/react-slot";
import type * as React from "react";
import { cn } from "@/libs/shadui";

export interface ToastActionProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible label for screen readers */
  altText?: string;
  /** Apply action styling to a child link while preserving its navigation semantics. */
  asChild?: boolean;
  ref?: React.Ref<HTMLButtonElement>;
}

/** Render a styled toast action as a button or a supplied child control. */
export const ToastAction = ({
  ref,
  className,
  altText,
  asChild = false,
  children,
  ...props
}: ToastActionProps) => {
  const Component = asChild ? Slot : "button";
  return (
    <Component
      ref={ref}
      className={cn(
        "hover:bg-secondary focus:ring-ring ml-auto inline-flex h-8 shrink-0 items-center justify-center rounded-md border bg-transparent px-3 text-sm font-medium transition-colors focus:ring-1 focus:outline-none disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      aria-label={altText}
      {...props}
    >
      {children ?? altText}
    </Component>
  );
};
ToastAction.displayName = "ToastAction";

export type ToastActionElement = React.ReactElement<typeof ToastAction>;
