import type { UserCachePatch } from "@/validators/userCache";

export const getPurchaseSnapshotUserUpdate = ({
  updateUserPatch,
}: {
  updateUserPatch: UserCachePatch | undefined;
}) => ({
  userPatch: updateUserPatch ?? null,
});
