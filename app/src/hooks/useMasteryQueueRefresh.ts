import { useMemo } from "react";
import { useRefreshAt } from "@/hooks/useRefreshAt";
import { masteryTrainingEndsAt } from "@/libs/train";
import type { UserWithRelations } from "@/routers/profile";

/** Finish mastery and elemental sessions on every page, including while asleep. */
export const useMasteryQueueRefresh = (
  user:
    | (Parameters<typeof masteryTrainingEndsAt>[0] &
        Pick<NonNullable<UserWithRelations>, "status">)
    | undefined,
  onRefresh: () => void,
  timeDiff: number,
  enabled = true,
) => {
  const finishesAt = user ? masteryTrainingEndsAt(user)?.getTime() : null;
  const elementalFinishesAt = user
    ? masteryTrainingEndsAt(user, "ELEMENT")?.getTime()
    : null;
  // Preserve the pending refresh through unrelated profile renders, including
  // useRefreshAt's grace period just after the server deadline.
  const deadlines = useMemo(
    () => [finishesAt, elementalFinishesAt],
    [finishesAt, elementalFinishesAt],
  );
  useRefreshAt(
    deadlines,
    onRefresh,
    timeDiff,
    enabled && !!user && ["AWAKE", "ASLEEP"].includes(user.status),
  );
};
