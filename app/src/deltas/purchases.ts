import type { UserCachePatch } from "@/validators/userCache";

/**
 * Forward the purchase's confirmed profile snapshot, using null when no snapshot is
 * available.
 */
export const getPurchaseSnapshotUserUpdate = ({
  updateUserPatch,
}: {
  updateUserPatch: UserCachePatch | undefined;
}) => ({
  userPatch: updateUserPatch ?? null,
});
