import * as SwitchPrimitives from "@radix-ui/react-switch";
import type * as React from "react";

import { cn } from "@/libs/shadui";

export interface SwitchProps
  extends React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root> {
  isDirty?: boolean;
  /** Keep the compact track inside a full 48px button for touch input. */
  touchTarget?: boolean;
  ref?: React.Ref<React.ElementRef<typeof SwitchPrimitives.Root>>;
}

const Switch = ({ className, isDirty, touchTarget, ref, ...props }: SwitchProps) => (
  <SwitchPrimitives.Root
    className={cn(
      "peer focus-visible:ring-ring focus-visible:ring-offset-background inline-flex shrink-0 cursor-pointer items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden disabled:cursor-not-allowed disabled:opacity-50",
      touchTarget
        ? "group/switch relative size-[48px] justify-center rounded-none"
        : "data-[state=checked]:bg-primary data-[state=unchecked]:bg-muted-foreground h-5 w-9 border-2 border-transparent shadow-xs",
      className,
      !touchTarget && (isDirty ? "border border-orange-300" : "border-input"),
    )}
    {...props}
    ref={ref}
  >
    {touchTarget && (
      <span
        aria-hidden="true"
        className={cn(
          "group-data-[state=checked]/switch:bg-primary group-data-[state=unchecked]/switch:bg-muted-foreground pointer-events-none absolute h-5 w-9 rounded-full border-2 shadow-xs transition-colors",
          isDirty ? "border-orange-300" : "border-input",
        )}
      />
    )}
    <SwitchPrimitives.Thumb
      className={cn(
        "pointer-events-none block h-4 w-4 rounded-full bg-white shadow-lg ring-1 ring-black/10 transition-transform",
        touchTarget
          ? "relative data-[state=checked]:translate-x-2 data-[state=unchecked]:-translate-x-2"
          : "data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0",
      )}
    />
  </SwitchPrimitives.Root>
);
Switch.displayName = SwitchPrimitives.Root.displayName;

export { Switch };
