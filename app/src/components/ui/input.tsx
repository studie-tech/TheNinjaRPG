import type * as React from "react";

import { cn } from "@/libs/shadui";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  isDirty?: boolean;
  ref?: React.Ref<HTMLInputElement>;
}

const Input = ({ className, type, isDirty, ref, ...props }: InputProps) => {
  return (
    <input
      type={type}
      className={cn(
        "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-foreground text-sm shadow-xs transition-colors file:border-0 file:bg-transparent file:font-medium file:text-sm file:text-foreground placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        className,
        isDirty ? "border-orange-300" : "border-input",
      )}
      ref={ref}
      {...props}
    />
  );
};
Input.displayName = "Input";

export { Input };
