import { COST_GENERATE_AVATAR } from "@/drizzle/constants";
import type { UserCachePatch } from "@/validators/userCache";

export const getUnchargedAvatarUserUpdate = () => ({
  userDelta: {},
});

export const getCreatedAvatarUserUpdate = ({
  userPatch,
}: {
  userPatch: UserCachePatch;
}) => ({
  userPatch,
  userDelta: { reputationPoints: -COST_GENERATE_AVATAR },
});

export const getGeneratedAvatarPatch = (
  avatar: string,
  thumbnail: string | null | undefined,
) => ({
  avatar,
  avatarLight: thumbnail || null,
});
export const getSelectedAvatarPatch = (
  type: string,
  avatar: string | null,
  avatarLight: string | null,
) => (type === "user" ? { avatar, avatarLight } : undefined);
