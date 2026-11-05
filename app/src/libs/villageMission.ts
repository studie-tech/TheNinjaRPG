import {
  VILLAGE_MISSION_RANK_POINTS,
  type VillageMissionTask,
} from "@/drizzle/constants";
import type { Quest, Village } from "@/drizzle/schema";
import { getUtcDayKey } from "@/utils/time";
import { villageMissionContentError } from "@/validators/villageMission";

export const isVillageMissionAvailable = (
  quest: Quest,
  villageId: string,
  now = new Date(),
) =>
  quest.questType === "village_mission" &&
  !quest.hidden &&
  (!quest.requiredVillage || quest.requiredVillage === villageId) &&
  (!quest.startsAt || quest.startsAt <= getUtcDayKey(now)) &&
  (!quest.endsAt || quest.endsAt >= getUtcDayKey(now)) &&
  !quest.requiredBloodlineId &&
  !quest.requiredSageModeId &&
  !quest.requiredSageRank &&
  !quest.prerequisiteQuestId &&
  !villageMissionContentError(quest.content, quest.consecutiveObjectives);

export const getVillageMissionProgress = (
  village: Pick<Village, "activeMission" | "missionCounters">,
) => {
  const mission = village.activeMission;
  if (!mission) return null;
  const objectives = mission.objectives.map((objective) => ({
    ...objective,
    current: Math.min(
      objective.value,
      Math.max(
        0,
        (village.missionCounters[objective.task] ?? 0) -
          (mission.baseline[objective.task] ?? 0),
      ),
    ),
  }));
  return {
    ...mission,
    objectives,
    completed: objectives.every((o) => o.current >= o.value),
  };
};

export const villageMissionCompletionEvents = (
  quest: Pick<Quest, "questType" | "questRank">,
): Partial<Record<VillageMissionTask, number>> => {
  if (
    quest.questType !== "mission" ||
    !(quest.questRank in VILLAGE_MISSION_RANK_POINTS)
  )
    return {};
  const rank = quest.questRank as keyof typeof VILLAGE_MISSION_RANK_POINTS;
  const task = `${rank.toLowerCase()}_missions_total` as VillageMissionTask;
  return { [task]: 1, combined_mission_effort: VILLAGE_MISSION_RANK_POINTS[rank] };
};
