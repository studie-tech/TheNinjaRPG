import { Progress } from "@/components/ui/progress";

/** How much Energy the player has, out of what they can hold or are waiting for. */
export const EnergyMeter = ({
  id,
  available,
  total,
  label,
}: {
  id?: string;
  available: number;
  total: number;
  /** Accessible name of the bar. */
  label: string;
}) => (
  <div id={id} className="space-y-1">
    <div className="flex justify-between text-muted-foreground text-xs">
      <span>Energy available</span>
      <span className="tabular-nums">
        {Math.floor(available).toLocaleString()} / {total.toLocaleString()}
      </span>
    </div>
    <Progress
      aria-label={label}
      value={Math.min(100, (available / total) * 100)}
      indicatorClassName="bg-violet-500"
      className="h-1.5 bg-violet-500/15"
    />
  </div>
);
