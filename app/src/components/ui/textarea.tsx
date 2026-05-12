import type * as React from "react";

import { cn } from "@/libs/shadui";

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  isDirty?: boolean;
  ref?: React.Ref<HTMLTextAreaElement>;
}

const Textarea = ({ className, isDirty, value, ref, ...props }: TextareaProps) => {
  const isControlled = value !== undefined;
  return (
    <textarea
      className={cn(
        "flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-foreground shadow-xs placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        className,
        isDirty ? "border-orange-300" : "border-input",
      )}
      ref={ref}
      {...(isControlled ? { value } : {})}
      {...props}
    />
  );
};
Textarea.displayName = "Textarea";

export { Textarea };
