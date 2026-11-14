import { RotateCcw } from "lucide-react";
import type React from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/libs/shadui";

/**
 * A failed query's message with a way to try again, announced as an alert. For a query
 * that failed outright or lost its refresh; keep Alert banners and messages that carry
 * more than the failure itself at the call site.
 */
export const QueryError: React.FC<QueryErrorProps> = ({
  message,
  onRetry,
  isRetrying,
  layout = "inline",
  retryLabel = "Try again",
  retryVariant,
  className,
  messageClassName,
}) => {
  if (layout === "panel") {
    return (
      <div
        role="alert"
        className={cn(
          "flex items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm",
          className,
        )}
      >
        <span>{message}</span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={isRetrying}
          onClick={onRetry}
        >
          <RotateCcw className="mr-1 h-4 w-4" /> {retryLabel}
        </Button>
      </div>
    );
  }
  const retry = (
    <Button
      type="button"
      variant={retryVariant}
      disabled={isRetrying}
      onClick={onRetry}
    >
      {retryLabel}
    </Button>
  );
  if (layout === "stacked") {
    return (
      <div role="alert" className={className}>
        <p className={messageClassName}>{message}</p>
        {retry}
      </div>
    );
  }
  return (
    <div role="alert" className={className}>
      {message} {retry}
    </div>
  );
};

interface QueryErrorProps {
  message: React.ReactNode;
  onRetry: () => void;
  /** Disables the retry control, typically while the query refetches. */
  isRetrying?: boolean;
  /**
   * `inline` runs the control on from the message, `stacked` puts it below the message and
   * `panel` is a bordered row that stands on its own between other cards.
   */
  layout?: "inline" | "stacked" | "panel";
  retryLabel?: string;
  retryVariant?: ButtonProps["variant"];
  /** Classes for the alert wrapper. */
  className?: string;
  /** Classes for the message of a `stacked` error. */
  messageClassName?: string;
}
