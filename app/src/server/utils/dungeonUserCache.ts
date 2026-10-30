import type { UserData } from "@/drizzle/schema";
import { effectiveMasteries } from "@/libs/mastery";
import { calcMaxEnergy } from "@/libs/profile";
import { findDungeonRewardUserCache } from "@/queries/dungeon";
import { fetchMasterySources } from "@/queries/skillTree";
import { getRewardUserDelta } from "@/server/api/routers/quests";
import type { DrizzleClient } from "@/server/db";
import type { PostProcessedRewards } from "@/validators/rewards";

/** Confirm scalar receipt balances, leaving derived progression to the profile query. */
export const getDungeonRewardUserUpdate = async (
  client: DrizzleClient,
  before: UserData,
  rewards: PostProcessedRewards | undefined,
) => {
  if (!rewards || getRewardUserDelta(rewards) === undefined)
    return { userPatch: undefined };
  // Completion is counted when the final battle settles. Its confirmed total lets
  // clients detect a missed battle-ended profile refresh and reconcile trackers.
  const confirmation = await Promise.all([
    findDungeonRewardUserCache(client, before.userId),
    fetchMasterySources(client, before.userId),
    // Receipt delivery has committed; missing cache data reconciles through the profile.
  ]).catch(() => undefined);
  if (!confirmation?.[0]) return { userPatch: undefined };
  const [saved, sources] = confirmation;
  const sourceUser = { ...saved, ...sources };
  const { bloodlineId: _bloodlineId, isAi: _isAi, ...patch } = saved;
  return {
    userPatch: {
      ...patch,
      effectiveMasteries: effectiveMasteries(sourceUser),
      maxEnergy: calcMaxEnergy(sourceUser),
    },
  };
};
