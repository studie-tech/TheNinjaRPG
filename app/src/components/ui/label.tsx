import * as LabelPrimitive from "@radix-ui/react-label";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "@/libs/shadui";

const labelVariants = cva(
  "font-medium text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
);

const Label = ({
  ref,
  className,
  ...props
}: React.ComponentPropsWithRef<typeof LabelPrimitive.Root> &
  VariantProps<typeof labelVariants>) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn(labelVariants(), className)}
    {...props}
  />
);
Label.displayName = LabelPrimitive.Root.displayName;

export { Label };
