"use client";

import { useEffect, useRef } from "react";
import { api } from "@/app/_trpc/client";
import { calcHealFinish } from "@/libs/hospital";
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

  // Apple reissues the token, so this stays subscribed rather than reading it once.
  useEffect(() => {
    if (!liveActivity.isSupported()) return;
    return liveActivity.onToken(({ activityId, pushToken }) => {
      if (activityId !== activeId.current) return;
      const endsAt = endsAtRef.current;
      if (!endsAt) return;
      registerActivity({ activityId, kind: "hospital", pushToken, endsAt });
    });
  }, [registerActivity]);

  const endsAtRef = useRef<Date | null>(null);
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

    const endsAt = calcHealFinish({ user: userData, timeDiff });
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
        if (!started) endsAtRef.current = null;
      })
      .finally(() => {
        isStarting.current = false;
      });
  }, [endActivity, shouldRun, timeDiff, userData]);
};
