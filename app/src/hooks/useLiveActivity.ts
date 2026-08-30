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

  useEffect(() => {
    if (!liveActivity.isSupported() || !userData) return;

    if (!isHospitalised) {
      const current = activeId.current;
      if (current) {
        activeId.current = null;
        endsAtRef.current = null;
        void liveActivity.end(current);
        endActivity({ kind: "hospital" });
      }
      return;
    }

    // Already showing one; the server pushes the updates from here.
    if (activeId.current || isStarting.current) return;

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
        endsAt: endsAt.toISOString(),
      })
      .then((started) => {
        activeId.current = started?.activityId ?? null;
        if (!started) endsAtRef.current = null;
      })
      .finally(() => {
        isStarting.current = false;
      });
  }, [endActivity, isHospitalised, timeDiff, userData]);
};
