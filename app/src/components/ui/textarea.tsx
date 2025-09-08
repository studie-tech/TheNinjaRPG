import * as React from "react";

import { cn } from "src/libs/shadui";

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  isDirty?: boolean;
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, isDirty, value, ...props }, ref) => {
    const isControlled = value !== undefined;
    return (
      <textarea
        className={cn(
          "flex min-h-[60px] w-full rounded-md border border-input bg-white text-black px-3 py-2 shadow-xs placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
          className,
          isDirty ? "border-orange-300" : "border-input",
        )}
        ref={ref}
        {...(isControlled ? { value } : {})}
        {...props}
      />
    );
  },
);
Textarea.displayName = "Textarea";

export { Textarea };
