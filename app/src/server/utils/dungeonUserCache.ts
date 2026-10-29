import type { UserData } from "@/drizzle/schema";
import { effectiveMasteries } from "@/libs/mastery";
import { calcMaxEnergy } from "@/libs/profile";
import { findDungeonRewardUserCache } from "@/queries/dungeon";
import { fetchMasterySources } from "@/queries/skillTree";
import { getRewardUserDelta } from "@/server/api/routers/quests";
import type { DrizzleClient } from "@/server/db";
import { getRewardUserUpdate } from "@/server/utils/rewardUserCache";
import {
  PostProcessedRewardSchema,
  type PostProcessedRewards,
} from "@/validators/rewards";

/** Confirm receipt balances and reconcile progression when the delivered reward affects it. */
export const getDungeonRewardUserUpdate = async (
  client: DrizzleClient,
  before: UserData,
  rewards: PostProcessedRewards | undefined,
) => {
  if (!rewards || getRewardUserDelta(rewards) === undefined)
    return getRewardUserUpdate({
      client,
      userId: before.userId,
      rewards: rewards ?? PostProcessedRewardSchema.parse({}),
      granted: { titles: [], badges: [], sageModes: [] },
      requiresRelations: true,
    });
  // Completion is counted when the final battle settles; its battle-ended profile
  // refresh reconciles trackers before this scalar-only receipt is delivered.
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
