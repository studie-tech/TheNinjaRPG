"use client";

import { useCallback, useEffect, useRef } from "react";
import { api } from "@/app/_trpc/client";
import { hospitalRecoveryAt } from "@/libs/hospital";
import { appEvents, liveActivity } from "@/libs/native";
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
  const { mutateAsync: registerActivity } = api.push.registerActivity.useMutation({
    // Mutations are not retried by the global tRPC client. Losing this particular write
    // leaves the server unable to update an activity that is already on the Lock Screen.
    retry: 3,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10_000),
  });
  const { mutate: endActivity } = api.push.endActivity.useMutation();

  // ActivityKit ids, so an activity is only ended once and only started once per stay.
  const activeId = useRef<string | null>(null);
  const isStarting = useRef(false);
  // Read inside the start callback rather than captured, because `userData` changes on
  // every profile refresh and the effect re-runs with it.
  const shouldBeRunning = useRef(false);
  const endsAtRef = useRef<Date | null>(null);
  /** The last non-hospitalised account whose orphaned native card was reconciled. */
  const stoppedAccount = useRef<string | null>(null);

  // The plugin subscribes to pushTokenUpdates before `start` resolves, so a token can
  // arrive while `activeId` is still null. Held here and claimed once the id is known,
  // rather than dropped — a discarded token means the server can never update that
  // activity, and Apple will not reissue one just because we missed it.
  const pendingToken = useRef<{ activityId: string; pushToken: string } | null>(null);
  const registrationInFlight = useRef<Promise<void> | null>(null);

  const flushPendingToken = useCallback(
    function flushPendingToken() {
      if (registrationInFlight.current) return;
      const pending = pendingToken.current;
      const endsAt = endsAtRef.current;
      if (!pending || !endsAt || pending.activityId !== activeId.current) return;

      const request = registerActivity({
        activityId: pending.activityId,
        kind: "hospital",
        pushToken: pending.pushToken,
        endsAt,
      })
        .then(() => {
          const current = pendingToken.current;
          if (
            current?.activityId === pending.activityId &&
            current.pushToken === pending.pushToken
          ) {
            pendingToken.current = null;
          }
        })
        .catch(() => {
          // Keep the token. A foreground transition calls this function again, which
          // covers a device that stayed offline longer than the bounded immediate retries.
        })
        .finally(() => {
          registrationInFlight.current = null;
          const current = pendingToken.current;
          // Apple may rotate the token while the previous one is on the wire. Flush a new
          // value immediately, but do not loop on the same value after exhausted retries.
          if (
            current &&
            (current.activityId !== pending.activityId ||
              current.pushToken !== pending.pushToken)
          ) {
            flushPendingToken();
          }
        });
      registrationInFlight.current = request;
    },
    [registerActivity],
  );

  const submitToken = useCallback(
    (activityId: string, pushToken: string) => {
      pendingToken.current = { activityId, pushToken };
      flushPendingToken();
    },
    [flushPendingToken],
  );

  // Apple reissues the token, so this stays subscribed rather than reading it once.
  useEffect(() => {
    if (!liveActivity.isSupported()) return;
    return liveActivity.onToken(({ activityId, pushToken }) => {
      submitToken(activityId, pushToken);
    });
  }, [submitToken]);

  useEffect(() => {
    if (!liveActivity.isSupported()) return;
    return appEvents.onStateChange((isActive) => {
      if (isActive) flushPendingToken();
    });
  }, [flushPendingToken]);

  const isHospitalised = userData?.status === "HOSPITALIZED";
  // An absent profile is unresolved, not recovered. NativeBridge owns signed-out cleanup
  // with endAll(); treating the loading gap as recovery would discard a valid activity on
  // every cold launch before the current player's profile arrives.
  const shouldRun = isHospitalised && !!userData;
  shouldBeRunning.current = shouldRun;

  useEffect(() => {
    if (!liveActivity.isSupported()) return;

    if (!userData) return;

    if (!shouldRun) {
      activeId.current = null;
      endsAtRef.current = null;
      pendingToken.current = null;
      // An activity outlives the process, so there may be no JavaScript id after a cold
      // relaunch. Reconcile once per recovered account by kind in the native store.
      if (stoppedAccount.current !== userData.userId) {
        stoppedAccount.current = userData.userId;
        void liveActivity.endKind("hospital");
        endActivity({ kind: "hospital" });
      }
      return;
    }

    stoppedAccount.current = null;

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
          flushPendingToken();
        }
      })
      .finally(() => {
        isStarting.current = false;
      });
  }, [endActivity, flushPendingToken, shouldRun, timeDiff, userData]);
};
