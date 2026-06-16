"use client";

import { ListOrdered, Timer, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ACTIVITY_QUEUE_TICK_INTERVAL_MINUTES } from "@/drizzle/constants";
import Countdown from "@/layout/Countdown";
import { cn } from "@/libs/shadui";
import { capitalizeFirstLetter } from "@/utils/sanitize";
import type { ActivityQueueEntry, ActivityQueueStatus } from "@/validators/queue";

interface ActivityQueuePanelProps {
  queue: ActivityQueueStatus | undefined;
  timeDiff: number;
  onCancel: (queueId: string) => void;
  isCancelling?: boolean;
  onActiveFinish?: () => void;
  onStopActive?: () => void;
  isStoppingActive?: boolean;
  stopButtonId?: string;
  formatEntryLabel?: (entry: ActivityQueueEntry) => string;
}

export const ActivityQueuePanel: React.FC<ActivityQueuePanelProps> = (props) => {
  const {
    queue,
    timeDiff,
    onCancel,
    isCancelling,
    onActiveFinish,
    onStopActive,
    isStoppingActive,
    stopButtonId,
    formatEntryLabel,
  } = props;

  if (!queue) return null;

  const usedPipeline = (queue.active ? 1 : 0) + queue.usedQueued;
  const emptyQueueSlots = Math.max(0, queue.maxQueued - queue.usedQueued);

  const defaultEntryLabel = (entry: ActivityQueueEntry) => {
    if (entry.jutsuName) {
      const level = entry.targetLevel !== null ? ` → Lv. ${entry.targetLevel}` : "";
      return `${entry.jutsuName}${level}`;
    }
    if (entry.itemName) {
      return `${entry.quantity}x ${entry.itemName}`;
    }
    if (entry.stat) {
      return capitalizeFirstLetter(
        entry.stat.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase()),
      );
    }
    return "Queued item";
  };

  return (
    <Card className="mb-4 border-dashed">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <ListOrdered className="h-4 w-4" />
            Queue
          </CardTitle>
          <Badge variant="secondary">
            {usedPipeline} / {queue.maxPipeline} slots
          </Badge>
        </div>
        <p className="text-muted-foreground text-xs">
          {queue.maxQueued} queue slot{queue.maxQueued === 1 ? "" : "s"} available (Fed
          supporters get extra slots). Queued items may take up to{" "}
          {ACTIVITY_QUEUE_TICK_INTERVAL_MINUTES} minute
          {ACTIVITY_QUEUE_TICK_INTERVAL_MINUTES === 1 ? "" : "s"} to start once a slot
          opens.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {queue.active ? (
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
            <div className="mb-1 font-semibold text-primary text-xs uppercase tracking-wide">
              Active
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{queue.active.label}</span>
              {queue.active.finishAt && (
                <span className="flex items-center gap-1 font-mono text-sm">
                  <Timer className="h-3.5 w-3.5" />
                  <Countdown
                    targetDate={queue.active.finishAt}
                    timeDiff={timeDiff}
                    onFinish={onActiveFinish}
                  />
                </span>
              )}
            </div>
            {queue.active.targetLevel !== undefined && (
              <p className="mt-1 text-muted-foreground text-xs">
                Training to level {queue.active.targetLevel}
              </p>
            )}
            {onStopActive && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2"
                id={stopButtonId}
                disabled={isStoppingActive}
                onClick={onStopActive}
              >
                Stop & claim
              </Button>
            )}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed p-3 text-center text-muted-foreground text-sm">
            No active training
          </div>
        )}

        {queue.queued.length > 0 && (
          <div className="space-y-2">
            <div className="font-semibold text-muted-foreground text-xs uppercase tracking-wide">
              Waiting
            </div>
            {[...queue.queued]
              .sort((a, b) => a.position - b.position)
              .map((entry, index) => {
                const entryLabel =
                  formatEntryLabel?.(entry) ?? defaultEntryLabel(entry);
                return (
                  <div
                    key={entry.id}
                    className="flex items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <span className="mr-2 text-muted-foreground text-xs">
                        #{index + 1}
                      </span>
                      <span className="font-medium text-sm">{entryLabel}</span>
                      {entry.moneyPaid > 0 && (
                        <span className="ml-2 text-muted-foreground text-xs">
                          {entry.moneyPaid.toLocaleString()} ryo
                        </span>
                      )}
                    </div>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 shrink-0"
                              aria-label={`Cancel ${entryLabel}`}
                              disabled={!entry.canCancel || isCancelling}
                              onClick={() => onCancel(entry.id)}
                            >
                              <XCircle
                                className={cn(
                                  "h-4 w-4",
                                  entry.canCancel
                                    ? "text-destructive"
                                    : "text-muted-foreground",
                                )}
                              />
                            </Button>
                          </span>
                        </TooltipTrigger>
                        {!entry.canCancel && (
                          <TooltipContent>
                            Cancel the highest level training for this jutsu first
                          </TooltipContent>
                        )}
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                );
              })}
          </div>
        )}

        {emptyQueueSlots > 0 &&
          Array.from({ length: emptyQueueSlots }).map((_, i) => (
            <div
              key={`empty-${i}`}
              className="rounded-md border border-dashed px-3 py-2 text-center text-muted-foreground text-xs"
            >
              Empty queue slot
            </div>
          ))}
      </CardContent>
    </Card>
  );
};

export default ActivityQueuePanel;
