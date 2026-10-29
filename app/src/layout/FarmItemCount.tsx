import { cn } from "@/libs/shadui";

type FarmItemCountProps = {
  count: number;
  /** Spoken after the number, e.g. "owned" or "in storage". */
  label?: string;
  className?: string;
};

/** How many of an item the player has, as a compact badge beside the item. */
export function FarmItemCount({
  count,
  label = "owned",
  className,
}: FarmItemCountProps) {
  return (
    <span
      className={cn(
        "inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-md border bg-muted px-1.5 font-semibold text-xs tabular-nums",
        className,
      )}
      title={`${count.toLocaleString()} ${label}`}
    >
      <span aria-hidden>{count.toLocaleString()}</span>
      <span className="sr-only">
        {count.toLocaleString()} {label}
      </span>
    </span>
  );
}
