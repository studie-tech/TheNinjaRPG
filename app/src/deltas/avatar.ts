import { COST_GENERATE_AVATAR } from "@/drizzle/constants";
import type { UserCachePatch } from "@/validators/userCache";

/** Confirm that an avatar operation incurred no profile currency charge. */
export const getUnchargedAvatarUserUpdate = () => ({
  userDelta: {},
});

/** Combine the saved avatar fields with the reputation debit for a charged generation. */
export const getCreatedAvatarUserUpdate = ({
  userPatch,
}: {
  userPatch: UserCachePatch;
}) => ({
  userPatch,
  userDelta: { reputationPoints: -COST_GENERATE_AVATAR },
});

/** Project the generated avatar URLs, storing a missing thumbnail as null. */
export const getGeneratedAvatarPatch = (
  avatar: string,
  thumbnail: string | null | undefined,
) => ({
  avatar,
  avatarLight: thumbnail || null,
});

/**
 * Project avatar selection only for the user profile; other avatar targets require separate
 * reconciliation.
 */
export const getSelectedAvatarPatch = (
  type: string,
  avatar: string | null,
  avatarLight: string | null,
) => (type === "user" ? { avatar, avatarLight } : undefined);
