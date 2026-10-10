"use client";

import { CircleHelp, ListOrdered, Trash2, XCircle } from "lucide-react";
import type React from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import ContentBox from "@/layout/ContentBox";
import Countdown from "@/layout/Countdown";
import { getDaysHoursMinutesSeconds } from "@/utils/time";

export interface TimedQueueJob {
  id: string;
  title: string;
  detail?: string;
  startsAt: Date;
  finishesAt: Date;
}

interface TimedQueueProps {
  title: string;
  subtitle: string;
  /** Total jobs allowed, including the active one */
  capacity: number;
  help: string;
  active?:
    | (Omit<TimedQueueJob, "id" | "startsAt"> & {
        onStop?: () => void;
        stopLabel?: string;
        stopControl?: React.ReactNode;
      })
    | null;
  waiting: TimedQueueJob[];
  onCancel?: (id: string) => void;
  /** Cancelling a waiting job, e.g. "Cancel and refund" */
  cancelLabel: string;
  isPending?: boolean;
  /** Server clock offset, as passed to Countdown */
  timeDiff?: number;
  emptyText: string;
  onActiveFinish?: () => void;
  children?: React.ReactNode;
  initialBreak?: boolean;
}

/**
 * The active job and the jobs waiting behind it for one timed activity, with the
 * player's capacity. Shared by mastery training, jutsu training and crafting.
 */
export const TimedQueue: React.FC<TimedQueueProps> = (props) => {
  const { active, waiting, capacity, timeDiff, isPending } = props;
  const used = (active ? 1 : 0) + waiting.length;
  return (
    <ContentBox
      title={props.title}
      subtitle={props.subtitle}
      initialBreak={props.initialBreak ?? true}
      topRightContent={
        <div className="ml-2 flex items-center gap-2 text-xs">
          <span className="whitespace-nowrap">
            {used} / {capacity} slots
          </span>
          <Popover>
            <PopoverTrigger aria-label={`About the ${props.title}`} className="p-1">
              <CircleHelp className="h-4 w-4" />
            </PopoverTrigger>
            <PopoverContent className="max-w-72 text-sm">{props.help}</PopoverContent>
          </Popover>
        </div>
      }
    >
      <div className="space-y-3">
        {active || waiting.length > 0 ? (
          <ol className="divide-y divide-orange-900/20 rounded border border-orange-900/30">
            {active && (
              <li className="flex items-center gap-2 bg-orange-900/5 px-3 py-2 text-sm">
                <span className="w-14 font-semibold text-xs">Active</span>
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{active.title}</span>
                  {active.detail && (
                    <span className="text-muted-foreground"> · {active.detail}</span>
                  )}
                  <span className="block text-muted-foreground text-xs">
                    Ends in{" "}
                    <Countdown
                      targetDate={active.finishesAt}
                      timeDiff={timeDiff}
                      onEndShow="now"
                      onFinish={props.onActiveFinish}
                    />
                  </span>
                </span>
                {active.stopControl}
                {active.onStop && (
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={active.stopLabel ?? "Stop"}
                    title={active.stopLabel}
                    disabled={isPending}
                    onClick={active.onStop}
                  >
                    <XCircle className="h-4 w-4 text-red-600" />
                  </Button>
                )}
              </li>
            )}
            {waiting.map((job, index) => (
              <li key={job.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                <span className="w-14 text-muted-foreground text-xs">
                  {index === 0 ? "Next" : `${index + 1}.`}
                </span>
                <span className="min-w-0 flex-1">
                  <span>{job.title}</span>
                  {job.detail && (
                    <span className="text-muted-foreground"> · {job.detail}</span>
                  )}
                  <span className="block text-muted-foreground text-xs">
                    Starts in{" "}
                    <Countdown
                      targetDate={job.startsAt}
                      timeDiff={timeDiff}
                      onEndShow="now"
                    />{" "}
                    · takes{" "}
                    {formatDuration(job.finishesAt.getTime() - job.startsAt.getTime())}
                  </span>
                </span>
                {props.onCancel && (
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`${props.cancelLabel}: ${job.title}`}
                    title={props.cancelLabel}
                    disabled={isPending}
                    onClick={() => props.onCancel?.(job.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </li>
            ))}
          </ol>
        ) : (
          <div className="rounded border border-orange-900/30 border-dashed p-4 text-center text-muted-foreground text-sm">
            <ListOrdered className="mx-auto mb-2 h-5 w-5" />
            {props.emptyText}
          </div>
        )}
        {props.children}
      </div>
    </ContentBox>
  );
};

/** A job length such as "1h 30m", "15m" or "45s". */
const formatDuration = (ms: number) => {
  const [days, hours, minutes, seconds] = getDaysHoursMinutesSeconds(Math.max(0, ms));
  const parts = [
    days ? `${days}d` : "",
    hours ? `${hours}h` : "",
    minutes ? `${minutes}m` : "",
    !days && !hours && seconds ? `${seconds}s` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" ") : "0s";
};
