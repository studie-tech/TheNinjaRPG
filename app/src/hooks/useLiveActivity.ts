"use client";

import { useCallback, useEffect, useRef } from "react";
import { api } from "@/app/_trpc/client";
import { hospitalRecoveryAt } from "@/libs/hospital";
import { liveActivity } from "@/libs/native";
import type { UserWithRelations } from "@/routers/profile";

/**
 * Puts the hospital countdown on the Lock Screen and in the Dynamic Island.
 *
 * Hospital first because it is the one players check most and the only state with a known
 * finish time: training runs until the player stops it, and raids need a schedule the
 * server does not publish yet. The plugin handles all three kinds, so the others plug in
 * here when they have an end time to show.
 *
 * The activity is started on the device and driven from the server afterwards, which is
 * what keeps it counting down while the app is closed.
 */
export const useLiveActivity = (
  userData: UserWithRelations | undefined,
  timeDiff: number,
) => {
  const { mutate: registerActivity } = api.push.registerActivity.useMutation();
  const { mutate: endActivity } = api.push.endActivity.useMutation();

  // ActivityKit ids, so an activity is only ended once and only started once per stay.
  const activeId = useRef<string | null>(null);
  const isStarting = useRef(false);
  // Read inside the start callback rather than captured, because `userData` changes on
  // every profile refresh and the effect re-runs with it.
  const shouldBeRunning = useRef(false);
  const endsAtRef = useRef<Date | null>(null);

  // The plugin subscribes to pushTokenUpdates before `start` resolves, so a token can
  // arrive while `activeId` is still null. Held here and claimed once the id is known,
  // rather than dropped — a discarded token means the server can never update that
  // activity, and Apple will not reissue one just because we missed it.
  const pendingToken = useRef<{ activityId: string; pushToken: string } | null>(null);

  const submitToken = useCallback(
    (activityId: string, pushToken: string) => {
      const endsAt = endsAtRef.current;
      if (!endsAt) return;
      registerActivity({ activityId, kind: "hospital", pushToken, endsAt });
    },
    [registerActivity],
  );

  // Apple reissues the token, so this stays subscribed rather than reading it once.
  useEffect(() => {
    if (!liveActivity.isSupported()) return;
    return liveActivity.onToken(({ activityId, pushToken }) => {
      if (activityId === activeId.current) {
        submitToken(activityId, pushToken);
        return;
      }
      pendingToken.current = { activityId, pushToken };
    });
  }, [submitToken]);

  const isHospitalised = userData?.status === "HOSPITALIZED";
  // Signed out counts as "stop", not "no opinion": leaving the countdown up would show
  // the previous player's recovery on the Lock Screen of a signed-out phone.
  const shouldRun = isHospitalised && !!userData;
  shouldBeRunning.current = shouldRun;

  useEffect(() => {
    if (!liveActivity.isSupported()) return;

    if (!shouldRun) {
      const current = activeId.current;
      if (current) {
        activeId.current = null;
        endsAtRef.current = null;
        void liveActivity.end(current);
        // Only worth telling the server while there is still a session to tell it with.
        if (userData) endActivity({ kind: "hospital" });
      }
      return;
    }

    // Already showing one; the server pushes the updates from here.
    if (activeId.current || isStarting.current || !userData) return;

    const endsAt = hospitalRecoveryAt(userData, timeDiff);
    // A countdown that has already finished would show as stale the moment it appeared.
    if (endsAt.getTime() <= Date.now()) return;

    isStarting.current = true;
    endsAtRef.current = endsAt;
    void liveActivity
      .start("hospital", {
        title: "Recovering",
        subtitle: userData.village?.name
          ? `${userData.village.name} hospital`
          : undefined,
        endsAt,
      })
      .then((started) => {
        // Checked through the ref rather than a cleanup flag: this effect re-runs on
        // every profile refresh, so treating each cleanup as a cancellation would end
        // the activity that had just started in the middle of a normal hospital stay.
        if (!shouldBeRunning.current) {
          if (started) void liveActivity.end(started.activityId);
          endsAtRef.current = null;
          return;
        }
        activeId.current = started?.activityId ?? null;
        if (!started) {
          endsAtRef.current = null;
          return;
        }
        // Claim a token that arrived before the id was known.
        const held = pendingToken.current;
        if (held?.activityId === started.activityId) {
          pendingToken.current = null;
          submitToken(held.activityId, held.pushToken);
        }
      })
      .finally(() => {
        isStarting.current = false;
      });
  }, [endActivity, shouldRun, timeDiff, userData]);
};
