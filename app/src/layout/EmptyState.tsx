import type { LucideIcon } from "lucide-react";
import type React from "react";
import { cn } from "@/libs/shadui";

/**
 * A list or panel with nothing to show yet: what is missing, why, and what the player can
 * do about it. Keep loading and failure states out of it; they have Loader and QueryError.
 */
export const EmptyState: React.FC<EmptyStateProps> = ({
  icon: Icon,
  title,
  description,
  action,
  className,
}) => (
  <div
    className={cn(
      "flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-8 text-center",
      className,
    )}
  >
    {Icon && <Icon aria-hidden className="h-8 w-8 text-muted-foreground" />}
    <p className="font-semibold">{title}</p>
    {description && <div className="max-w-md text-muted-foreground">{description}</div>}
    {action && <div className="mt-2 flex flex-wrap justify-center gap-2">{action}</div>}
  </div>
);

interface EmptyStateProps {
  icon?: LucideIcon;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Controls that resolve the empty state, such as widening a filter or creating an entry. */
  action?: React.ReactNode;
  className?: string;
}
