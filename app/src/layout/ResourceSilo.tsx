"use client";

import { Button } from "@/components/ui/button";
import {
  RESOURCE_SILO_LOSS_POINTS,
  RESOURCE_SILO_POINTS_REQUIRED,
  RESOURCE_SILO_WIN_POINTS,
} from "@/drizzle/constants";
import { useResourceSilo } from "@/hooks/useResourceSilos";
import ContentBox from "@/layout/ContentBox";
import Countdown from "@/layout/Countdown";
import Loader from "@/layout/Loader";
import { canAttemptAwakeAction } from "@/libs/actionReadiness";
import { useRequiredUserData } from "@/utils/UserContext";

/** The existing War-Torn shrine hosts weekend progress and the once-per-spawn claim. */
export const ResourceSilo = () => {
  const { status, claim } = useResourceSilo();
  const { data: user, timeDiff } = useRequiredUserData();
  const data = status.data;
  const message = claim.error?.message ?? claim.data?.message;
  return (
    <ContentBox title="Resource Silo" subtitle="War-Torn Sector · Friday–Sunday UTC">
      <p className="mb-3 text-sm">
        A silo opens every three hours for one hour. Earn {RESOURCE_SILO_WIN_POINTS}{" "}
        points for a PvP win and {RESOURCE_SILO_LOSS_POINTS} for a loss or flee in this
        sector. Draws give no points. Points reset each spawn.
      </p>
      {status.isPending && <Loader explanation="Loading resource silo" />}
      {status.isError && (
        <p role="alert">
          Could not load the silo.{" "}
          <Button onClick={() => void status.refetch()}>Retry</Button>
        </p>
      )}
      {data && (
        <div className="space-y-3">
          {data.window.active ? (
            <>
              <p className="font-semibold">
                Silo open · Closes in{" "}
                <Countdown
                  targetDate={new Date(data.window.end.getTime() + timeDiff)}
                />
              </p>
              <p className="text-xl">
                {data.points} / {RESOURCE_SILO_POINTS_REQUIRED} points
              </p>
              <p className="text-sm">
                One claim per spawn. Reward chances are rolled independently, so several
                rewards or no rewards may drop.
              </p>
              {!data.configured && <p>No rewards are configured for this silo.</p>}
              <Button
                disabled={
                  claim.isPending ||
                  data.claimed ||
                  data.points < RESOURCE_SILO_POINTS_REQUIRED ||
                  !data.configured ||
                  !canAttemptAwakeAction(user)
                }
                onClick={() => claim.mutate()}
              >
                {claim.isPending
                  ? "Unlocking…"
                  : data.claimed
                    ? "Claimed this spawn"
                    : "Unlock Resource Silo"}
              </Button>
            </>
          ) : (
            <p>Next silo opens {data.window.next.toUTCString()}.</p>
          )}
        </div>
      )}
      {message && (
        <p
          role={claim.error || claim.data?.success === false ? "alert" : "status"}
          className="mt-3 rounded border p-3"
        >
          {message}
        </p>
      )}
    </ContentBox>
  );
};
