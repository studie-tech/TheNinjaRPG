import { z } from "zod";
import { VILLAGE_MISSION_TASKS } from "@/drizzle/constants";
import { collapseRewards } from "@/libs/rewards";
import type { QuestRewardType } from "@/validators/rewardPackages";
import { rewardPayloads } from "@/validators/rewardPackages";
import { hasReward, ObjectiveReward } from "@/validators/rewards";

export const villageMissionObjectiveSchema = z.object({
  id: z.string().min(1),
  task: z.enum(VILLAGE_MISSION_TASKS),
  description: z.string(),
  value: z.number().int().positive(),
});

export const villageMissionSchema = z.object({
  id: z.string(),
  questId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  rewardTokens: z.number().int().positive(),
  objectives: z.array(villageMissionObjectiveSchema).min(1),
  baseline: z.record(z.string(), z.number()),
  rerolled: z.boolean(),
  startedAt: z.string(),
});
export type VillageMission = z.infer<typeof villageMissionSchema>;

/** Validate simultaneous shared objectives and a token-only completion payout, including packages. */
export const villageMissionContentError = (
  content: {
    objectives: unknown[];
    reward: Partial<QuestRewardType>;
    rewardMode?: string;
  },
  consecutiveObjectives: boolean,
) => {
  if (consecutiveObjectives) return "Village mission objectives must be simultaneous";
  if (content.rewardMode === "choose")
    return "Village missions cannot use reward choices";
  const reward = collapseRewards(
    rewardPayloads(content.reward, ObjectiveReward.parse(content.reward)),
  );
  if (
    (content.reward.reward_packages ?? []).some((pack) =>
      hasReward({ ...pack.rewards, reward_tokens: 0 }),
    )
  )
    return "Village Mission packages may only contain village tokens";
  if (
    content.objectives.some(
      (objective) =>
        typeof objective === "object" &&
        objective !== null &&
        "reward_packages" in objective &&
        Array.isArray(objective.reward_packages) &&
        objective.reward_packages.length > 0,
    )
  )
    return "Village Missions only support packages on the completed quest";
  if (!Number.isSafeInteger(reward.reward_tokens) || (reward.reward_tokens ?? 0) <= 0) {
    return "Village missions require a positive whole-number token reward";
  }
  if (
    !z.array(villageMissionObjectiveSchema).min(1).safeParse(content.objectives).success
  ) {
    return "Village missions support PvP kills, Siege Operation, Combined Mission Effort, and D–A mission totals with positive whole-number targets";
  }
  const objectives = content.objectives as Array<{
    id: string;
    nextObjectiveId?: string;
    attackers?: unknown[];
  }>;
  if (new Set(objectives.map((o) => o.id)).size !== objectives.length)
    return "Objective IDs must be unique";
  if (objectives.some((o) => o.nextObjectiveId || o.attackers?.length))
    return "Village missions cannot branch or spawn attackers";
  return null;
};
