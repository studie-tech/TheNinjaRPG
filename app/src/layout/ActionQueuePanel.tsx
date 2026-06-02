"use client";

import { ListOrdered, XCircle } from "lucide-react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import type { ActionQueueType } from "@/drizzle/constants";
import { cn } from "@/libs/shadui";
import { showMutationToast } from "@/libs/toast";

interface ActionQueuePanelProps {
  queueTypes?: ActionQueueType[];
  className?: string;
}

export function ActionQueuePanel({ queueTypes, className }: ActionQueuePanelProps) {
  const utils = api.useUtils();
  const { data: queue } = api.actionQueue.get.useQuery(undefined, {
    staleTime: 5000,
  });

  const { mutate: removeEntry, isPending: isRemoving } =
    api.actionQueue.remove.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await utils.actionQueue.get.invalidate();
          await utils.item.getUserItems.invalidate();
          if (data.data?.money !== undefined) {
            await utils.profile.getUser.invalidate();
          }
        }
      },
    });

  const entries = (queue?.entries ?? []).filter(
    (entry) => !queueTypes || queueTypes.includes(entry.queueType),
  );

  if (!queue || entries.length === 0) {
    if (!queue) return null;
    return (
      <div
        className={cn(
          "mt-4 rounded-md border border-dashed p-3 text-sm text-muted-foreground",
          className,
        )}
      >
        <div className="flex items-center gap-2 font-medium text-foreground">
          <ListOrdered className="h-4 w-4" />
          Action Queue ({queue.slotsUsed}/{queue.slotLimit})
        </div>
        <p className="mt-1">
          No queued actions. Queue slots fill when you line up training or crafting
          while busy.
        </p>
      </div>
    );
  }

  return (
    <div className={cn("mt-4 rounded-md border p-3", className)}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-medium">
          <ListOrdered className="h-4 w-4" />
          Action Queue ({queue.slotsUsed}/{queue.slotLimit})
        </div>
      </div>
      <ul className="space-y-2">
        {entries.map((entry) => (
          <li
            key={entry.id}
            className="flex items-start justify-between gap-2 rounded bg-muted/50 px-2 py-1.5 text-sm"
          >
            <div>
              <p className="font-medium">{entry.label}</p>
              <p className="text-muted-foreground text-xs">
                {[entry.durationLabel, entry.costLabel].filter(Boolean).join(" · ")}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              disabled={isRemoving}
              onClick={() => removeEntry({ id: entry.id })}
              aria-label="Remove from queue"
            >
              <XCircle className="h-4 w-4 text-red-500" />
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function useActionQueue() {
  return api.actionQueue.get.useQuery(undefined, { staleTime: 5000 });
}
