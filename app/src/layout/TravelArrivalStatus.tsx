import { Loader2, MapPin } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import Countdown from "@/layout/Countdown";

/** Keep the destination and arrival feedback readable over the travel map. */
export const TravelArrivalStatus = ({
  sector,
  destinationName,
  finishAt,
  timeDiff,
  isBusy,
  isArrivalRejected,
  onArrive,
  onRetrySync,
  isSyncing = false,
}: {
  sector: number;
  destinationName?: string;
  finishAt: Date;
  timeDiff: number;
  isBusy: boolean;
  isArrivalRejected: boolean;
  onArrive: () => void;
  onRetrySync?: () => void;
  isSyncing?: boolean;
}) => (
  <div className="pointer-events-none absolute inset-x-3 top-3 z-20 flex justify-center">
    <div
      id="tutorial-travel-arrival"
      className="bg-background/95 text-foreground pointer-events-auto flex w-full max-w-md flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border px-4 py-3 shadow-lg backdrop-blur-sm"
    >
      <div className="flex min-w-0 flex-1 items-center gap-3" role="status">
        <MapPin className="text-primary h-5 w-5 shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-muted-foreground text-xs">Traveling to</p>
          <p className="text-sm font-semibold">
            {destinationName ?? `Sector ${sector}`}
          </p>
          {destinationName && (
            <p className="text-muted-foreground text-xs">Sector {sector}</p>
          )}
        </div>
      </div>
      <div className="shrink-0 text-right text-sm tabular-nums">
        <Countdown
          targetDate={finishAt}
          timeDiff={timeDiff}
          format={(ms) => `${Math.ceil(ms / 1000)}s remaining`}
          onEndShow={
            <ArrivalAction
              deadline={finishAt.getTime() + timeDiff}
              isBusy={isBusy}
              isArrivalRejected={isArrivalRejected}
              onArrive={onArrive}
            />
          }
        />
      </div>
      {isArrivalRejected && (
        <p role="alert" className="text-destructive w-full text-xs">
          Could not complete your arrival. Please try again.
        </p>
      )}
      {onRetrySync && (
        <div className="flex w-full flex-wrap items-center gap-2">
          <p role="alert" className="text-muted-foreground flex-1 text-xs">
            Your trip has started. Reconnect to confirm your location.
          </p>
          <Button size="sm" disabled={isSyncing} onClick={onRetrySync}>
            {isSyncing ? "Reconnecting…" : "Retry connection"}
          </Button>
        </div>
      )}
    </div>
  </div>
);

/** Wait for admission before completing even when the timer expires during its request. */
const ArrivalAction = ({
  deadline,
  isBusy,
  isArrivalRejected,
  onArrive,
}: {
  deadline: number;
  isBusy: boolean;
  isArrivalRejected: boolean;
  onArrive: () => void;
}) => {
  const hasRequestedArrival = useRef(false);
  useEffect(() => {
    if (
      Date.now() < deadline ||
      isBusy ||
      isArrivalRejected ||
      hasRequestedArrival.current
    )
      return;
    hasRequestedArrival.current = true;
    onArrive();
  }, [deadline, isBusy, isArrivalRejected, onArrive]);

  return isArrivalRejected ? (
    <Button
      size="sm"
      disabled={isBusy}
      onClick={() => {
        hasRequestedArrival.current = true;
        onArrive();
      }}
    >
      Retry arrival
    </Button>
  ) : (
    <span role="status" className="flex items-center gap-2">
      <Loader2
        className="h-4 w-4 animate-spin motion-reduce:animate-none"
        aria-hidden="true"
      />
      Arriving…
    </span>
  );
};
