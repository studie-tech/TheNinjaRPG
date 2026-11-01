import { getUserProgressionUpdate } from "@/deltas/profile";
import type { fetchUpdatedUser } from "@/routers/profile";
import type { UserDeltaResponse } from "@/validators/userCache";

/** Reuse the upfront progression projection unless automatic effects still need reconciliation. */
export const getRaidSnapshotUpdate = (
  snapshot: Awaited<ReturnType<typeof fetchUpdatedUser>>,
) => {
  const update =
    snapshot.user && !snapshot.requiresProgressionRefresh
      ? getUserProgressionUpdate(snapshot.user, snapshot.publishedAchievementIds)
      : undefined;
  return { ...update, userDelta: update ? {} : undefined };
};

/** A successful guarded wake changes only the actor's queue status. */
export const raidQueueWakeUpdate = (
  initial: ReturnType<typeof getRaidSnapshotUpdate>,
  woke: boolean,
) => ({
  ...initial,
  userPatch:
    woke && initial.userPatch
      ? { ...initial.userPatch, status: "AWAKE" as const }
      : undefined,
  userDelta: woke && initial.userPatch ? {} : undefined,
});

/**
 * Combine admission state with a safe upfront progression snapshot.
 * Unknown admission or progression state must reconcile as one profile.
 */
export const confirmRaidBattleUpdate = (
  initial: ReturnType<typeof getRaidSnapshotUpdate>,
  result: Pick<UserDeltaResponse, "userPatch" | "userDelta"> & {
    requiresUserRefresh?: boolean;
  },
) => ({
  ...initial,
  userPatch:
    !result.requiresUserRefresh && result.userPatch && initial.userPatch
      ? { ...initial.userPatch, ...result.userPatch }
      : undefined,
  userDelta:
    !result.requiresUserRefresh && result.userPatch && initial.userPatch
      ? result.userDelta
      : undefined,
});

/**
 * Guard an unchanged raid queue response against the caller's opening status without changing
 * balances.
 */
export const getRaidQueueExpectedUpdate = ({
  userStatus,
}: {
  userStatus: "AWAKE" | "HOSPITALIZED" | "TRAVEL" | "BATTLE" | "QUEUED" | "ASLEEP";
}) => ({
  userDelta: {},
  userExpected: { status: userStatus },
});

/**
 * Clear battle and travel state only after the caller is confirmed awake; otherwise require
 * reconciliation.
 */
export const getRaidQueueWakeUserUpdate = ({
  confirmedAwake,
}: {
  confirmedAwake: boolean;
}) => ({
  userPatch: confirmedAwake
    ? { status: "AWAKE" as const, travelFinishAt: null, battleId: null }
    : undefined,
});

/** Project confirmed raid queue admission without additional balance changes. */
export const getJoinRaidQueueUserUpdate = () => ({
  userPatch: { status: "QUEUED" as const },
  userDelta: {},
});
