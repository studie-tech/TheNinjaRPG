import type { UserData } from "@/drizzle/schema";
import { effectiveMasteries } from "@/libs/mastery";
import { calcMaxEnergy } from "@/libs/profile";
import { findDungeonRewardUserCache } from "@/queries/dungeon";
import { fetchMasterySources } from "@/queries/skillTree";
import type { DrizzleClient } from "@/server/db";
import { getMembershipUserPatch } from "@/server/utils/socialUserCache";
import type { PostProcessedRewards } from "@/validators/rewards";

/** Return committed completion balances; private sources supply only public derived values. */
export const getDungeonRewardUserPatch = async (
  client: DrizzleClient,
  before: UserData,
  rewards: PostProcessedRewards | undefined,
) => {
  const [saved, sources, membership] = await Promise.all([
    findDungeonRewardUserCache(client, before.userId),
    fetchMasterySources(client, before.userId),
    (rewards?.reward_village_membership ?? "NONE") !== "NONE" ||
    (rewards?.reward_titles?.length ?? 0) > 0
      ? getMembershipUserPatch(client, before)
      : undefined,
  ]);
  if (!saved) return undefined;
  const sourceUser = { ...saved, ...sources };
  const { bloodlineId: _bloodlineId, isAi: _isAi, ...patch } = saved;
  return {
    ...patch,
    ...membership,
    effectiveMasteries: effectiveMasteries(sourceUser),
    maxEnergy: calcMaxEnergy(sourceUser),
  };
};
