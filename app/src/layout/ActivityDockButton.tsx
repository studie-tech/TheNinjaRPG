"use client";

import { useAtomValue, useSetAtom } from "jotai";
import { ListChecks } from "lucide-react";
import { activityDockRequestAtom, activityDockStateAtom } from "@/libs/activityDock";
import { cn } from "@/libs/shadui";

/** Open the mounted Activity panel from a layout's navigation surface. */
export function ActivityDockButton({
  className,
  iconClassName,
  mobile = false,
}: {
  className?: string;
  iconClassName?: string;
  mobile?: boolean;
}) {
  const activity = useAtomValue(activityDockStateAtom);
  const requestActivity = useSetAtom(activityDockRequestAtom);
  return (
    <button
      type="button"
      data-mobile-activity-trigger={mobile ? "" : undefined}
      data-desktop-activity-trigger={mobile ? undefined : ""}
      aria-label="Activity"
      aria-expanded={activity.open}
      aria-controls={activity.panelId ?? undefined}
      disabled={!activity.panelId}
      title="Tutorial & quests"
      className={cn(
        "focus-visible:outline-ring rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50",
        className,
      )}
      onClick={() =>
        requestActivity((current) => ({
          sequence: current.sequence + 1,
          userId: activity.userId,
          open: !activity.open,
        }))
      }
    >
      <ListChecks className={cn("size-5", iconClassName)} aria-hidden />
      {!mobile && <span>Activity</span>}
    </button>
  );
}
