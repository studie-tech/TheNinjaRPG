import {
  ERRANDS_PER_DAY,
  IMG_MISSION_A,
  IMG_MISSION_B,
  IMG_MISSION_C,
  IMG_MISSION_D,
  IMG_MISSION_E,
  IMG_MISSION_M,
  IMG_MISSION_PVP,
  IMG_MISSION_S,
  type LetterRank,
  MEDICAL_MISSIONS_PER_DAY,
  type MEDNIN_RANK,
  MEDNIN_RANKS,
  MISSION_HALL_QUEST_TYPES,
  MISSION_HALL_SOLO_QUEST_TYPES,
  MISSIONS_PER_DAY,
  PVP_MISSIONS_PER_DAY,
  QUESTS_CONCURRENT_LIMIT,
  type QuestType,
  type UserStatus,
  WAR_MISSIONS_PER_DAY,
} from "@/drizzle/constants";
import type { Quest, UserData } from "@/drizzle/schema";
import { actionStatusMessage } from "@/libs/actionReadiness";
import { calcMedninRank } from "@/libs/hospital";
import { isAvailableUserQuests } from "@/libs/quest/availability";
import { availableQuestLetterRanks } from "@/libs/rank";
import { isVillageInvolvedInAnyWar } from "@/libs/war";
import type { UserWithRelations } from "@/routers/profile";
import { capitalizeFirstLetter } from "@/utils/string";
import { canAccessStructure, type SectorVillage } from "@/utils/village";

/** Build mission-hall categories and copy for village missions or outlaw crimes. */
export const getMissionHallSettings = (isOutlaw: boolean) => {
  const type = isOutlaw ? "crime" : "mission";
  return [
    {
      type: "errand",
      rank: "D",
      name: "Errand",
      image: IMG_MISSION_E,
      description: `Errands typically involve simple tasks such as fetching an item somewhere in the village, delivering groceries, etc.`,
    },
    {
      type: type,
      rank: "D",
      name: "D-rank",
      image: IMG_MISSION_D,
      description: `D-rank ${type}s are the lowest rank of ${type}s. They are usually simple ${type}s that have a low chance of danger, finding & retrieving items, doing manual labor, or fetching a lost cat`,
    },
    {
      type: type,
      rank: "C",
      name: "C-rank",
      image: IMG_MISSION_C,
      description: `C-rank ${type}s are the second lowest rank of ${type}s. They are usually ${type}s that have a chance of danger, e.g. escorting a client through friendly territory, etc.`,
    },
    {
      type: type,
      rank: "B",
      name: "B-rank",
      image: IMG_MISSION_B,
      description: `B-rank ${type}s are the third highest rank of ${type}s. They are usually ${type}s that have a decent chance of danger, e.g. escorting a client through neutral or enemy territory.`,
    },
    {
      type: type,
      rank: "A",
      name: "A-rank",
      image: IMG_MISSION_A,
      description: `A-rank ${type}s are the second highest rank of ${type}s. They usually have a high chance of danger and are considered to be very difficult, e.g. assassinating a target, etc.`,
    },
    ...(isOutlaw
      ? [
          {
            type: "crime" as const,
            rank: "S" as const,
            name: "S-rank",
            image: IMG_MISSION_S,
            description:
              "S-rank crimes are dangerous assignments for the strongest outlaws.",
          },
        ]
      : []),
    {
      type: "medical",
      rank: "D",
      name: "Medical",
      image: IMG_MISSION_M,
      description: `Medical quests are specialized missions for medical ninja. These quests focus on healing, medical research, and providing medical assistance to the village.`,
    },
    {
      type: "pvp",
      rank: "S",
      name: "PvP",
      image: IMG_MISSION_PVP,
      description: `PvP missions involve combat against other players. Test your skills in player versus player battles.`,
    },
  ] as const;
};

/**
 * Quests offered by a Mission Hall tile. PvP and medical tiles list every rank the player can
 * take; the others match their type and rank, so random tiles count what startRandom draws from.
 * The A-rank picker also keeps the village-locked quests of the other classifier, which no other
 * tile can start.
 */
export const getMissionHallTileQuests = <
  T extends Pick<Quest, "questType" | "questRank" | "requiredVillage">,
>(
  setting: Pick<ReturnType<typeof getMissionHallSettings>[number], "type" | "rank">,
  quests: T[],
  userRanks: LetterRank[],
) => {
  const { type, rank } = setting;
  if (type === "pvp" || type === "medical") {
    return quests.filter(
      (q) => q.questType === type && userRanks.includes(q.questRank),
    );
  }
  return quests.filter(
    (q) =>
      q.questRank === rank &&
      (q.questType === type ||
        (rank === "A" &&
          ["mission", "crime"].includes(q.questType) &&
          !!q.requiredVillage)),
  );
};

/**
 * Select the quests shown for a Mission Hall type. Medical lists every available quest from
 * the player's rank downward; other types keep the full list.
 *
 * @param quests - The quests to filter.
 * @param user - The user to filter for.
 * @param questType - The Mission Hall type being listed.
 * @returns The quests, and a display suffix when the best one is below the player's rank.
 */
export const filterMissionHallQuests = <
  T extends Parameters<typeof isAvailableUserQuests>[0],
>(
  quests: T[],
  user: NonNullable<UserWithRelations>,
  questType: QuestType,
) => {
  if (questType !== "medical") return { filtered: quests, rankInfo: "" };
  const userMedicalRank = calcMedninRank({
    medicalExperience: user.medicalExperience,
    rank: user.rank,
  });
  // Quests without a rank list alongside the player's own rank.
  const rankOrder = (quest: T) =>
    MEDNIN_RANKS.indexOf(quest.medicalRank || userMedicalRank);
  const filtered = quests
    .filter((e) => e.questType === questType && isAvailableUserQuests(e, user).check)
    .sort((a, b) => rankOrder(b) - rankOrder(a));
  let rankInfo = "";
  // Set rank info if we're showing missions from lower ranks
  if (filtered.length > 0) {
    const highestRankShown = filtered.reduce((highest, mission) => {
      if (!mission.medicalRank) return highest;
      const missionRankIndex = MEDNIN_RANKS.indexOf(mission.medicalRank);
      const highestIndex = MEDNIN_RANKS.indexOf(highest);
      return missionRankIndex > highestIndex ? mission.medicalRank : highest;
    }, "NONE" as MEDNIN_RANK);

    if (highestRankShown !== userMedicalRank) {
      rankInfo = ` (showing missions up to ${capitalizeFirstLetter(highestRankShown)} rank)`;
    }
  }
  return { filtered, rankInfo };
};

/** A player can have multiple events, but cannot start the same quest twice. */
export const questAlreadyActiveBlockMessage = (
  quest: Pick<Quest, "id" | "name">,
  user: Pick<NonNullable<UserWithRelations>, "userQuests">,
): string | null =>
  user.userQuests?.some((active) => active.questId === quest.id && !active.endAt)
    ? `You are already on this quest: ${quest.name}`
    : null;

/** Returns a rejection message when the quest's concurrency slot is occupied. */
export const questTypeConcurrentBlockMessage = (
  quest: Pick<Quest, "questType" | "name">,
  user: NonNullable<UserWithRelations>,
): string | null => {
  /** Returns the user's unfinished quests for a specific quest type. */
  const activeOfType = (type: string) =>
    user.userQuests?.filter((q) => q.quest.questType === type && !q.endAt) ?? [];
  switch (quest.questType) {
    case "story":
    case "hunting":
    case "gathering":
    case "anbu":
    case "event": {
      const cur = activeOfType(quest.questType);
      if (cur.length >= QUESTS_CONCURRENT_LIMIT) {
        return `Already ${QUESTS_CONCURRENT_LIMIT} active ${quest.questType} quests; ${cur
          .map((c) => c.quest.name)
          .join(", ")}. Abandon one to start this quest.`;
      }
      return null;
    }
    case "battlepyramid": {
      const [activePyramid] = activeOfType("battlepyramid");
      if (activePyramid) {
        return `You have an unfinished Battle Pyramid run (${activePyramid.quest.name}). Go to Battle Arena → Battle Pyramid and abandon it to start this quest.`;
      }
      return null;
    }
    case "starter": {
      if (activeOfType("starter").length >= 1) {
        return `Already in active starter quest. Abandon if you want to restart.`;
      }
      return null;
    }
    case "war": {
      const found = user.userQuests?.find(
        (q) => MISSION_HALL_QUEST_TYPES.includes(q.quest.questType) && !q.endAt,
      );
      return found ? `Already have an active ${found.quest.questType}` : null;
    }
    case "mission":
    case "crime":
    case "medical":
    case "pvp":
    case "errand": {
      const found = user.userQuests?.find(
        (q) => MISSION_HALL_SOLO_QUEST_TYPES.includes(q.quest.questType) && !q.endAt,
      );
      return found ? `Already active ${found.quest.questType}` : null;
    }
    default:
      return null;
  }
};

/**
 * Explains why a player cannot act on quest steps right now. Dialog choices and reward
 * claims require an awake player, so the UI must say so instead of hiding every action.
 */
export const questProgressBlockedMessage = (
  status: UserStatus | undefined,
): string | null => {
  switch (status) {
    case undefined:
    case "AWAKE":
      return null;
    case "ASLEEP":
      return "You are asleep. Wake up at your home to continue this quest.";
    case "HOSPITALIZED":
      return "You are hospitalized. Heal at the hospital to continue this quest.";
    case "TRAVEL":
      return "You are travelling. Arrive at your destination to continue this quest.";
    case "BATTLE":
      return "You are in battle. Finish the battle to continue this quest.";
    case "QUEUED":
      return "You are queued for battle. Leave the queue to continue this quest.";
  }
};

/**
 * Mission Hall starts consume a daily slot (and single-attempt missions forever), but their
 * steps can only be progressed while awake. Reject the start instead of stranding the player.
 */
export const missionHallStartBlockedMessage = (
  questType: QuestType,
  status: UserStatus,
): string | null =>
  MISSION_HALL_QUEST_TYPES.includes(questType) && status !== "AWAKE"
    ? actionStatusMessage(status)
    : null;

/**
 * Structure and occupation guards that only apply when a player starts a quest
 * through the UI (Mission Hall, Anbu page, etc.). NPC-initiated quests skip these.
 * Returns a rejection message, or null to allow proceeding.
 */
export const questUiAccessBlockMessage = (
  quest: Pick<Quest, "questType" | "questRank">,
  user: NonNullable<UserWithRelations>,
  sectorVillage: SectorVillage | null,
): string | null => {
  const hasStructureAccess = canAccessStructure(
    user,
    questStructureRoute(quest.questType),
    sectorVillage,
  );
  if (quest.questType === "story") {
    if (!hasStructureAccess) {
      return "Must be in the Global Anbu HQ to start story quests";
    }
  } else if (quest.questType === "hunting") {
    if (user.occupation !== "HUNTER") {
      return "You are not a hunter";
    }
  } else if (quest.questType === "gathering") {
    if (user.occupation !== "GATHERING") {
      return "You are not a gatherer";
    }
  } else if (quest.questType === "anbu") {
    if (!hasStructureAccess) {
      return "Must be in the Anbu page to start anbu quests";
    }
    if (!user.anbuId) {
      return "You are not in an anbu squad";
    }
  } else if (quest.questType === "event") {
    if (!hasStructureAccess) {
      return "Must be in your allied village to start quest";
    }
  } else if (quest.questType === "war") {
    if (!user.villageId) {
      return "You must be in a village to accept war missions";
    }
    if (!user.isOutlaw && !hasStructureAccess) {
      return "Must be in your allied village to start quest";
    }
    if (user.dailyWarMissions >= WAR_MISSIONS_PER_DAY) {
      return questDailyLimitMessage("war", WAR_MISSIONS_PER_DAY);
    }
  } else if (["mission", "crime", "medical", "pvp"].includes(quest.questType)) {
    if (["mission", "crime"].includes(quest.questType) && quest.questRank !== "A") {
      return `Only A rank missions/crimes are allowed`;
    }
    if (!user.isOutlaw && !hasStructureAccess) {
      return "Must be in your allied village to start quest";
    }
  }
  return null;
};

/** Daily assignment counters used by the mission hall, discovery and acquisition guards. */
export const questDailyQuota = (
  questType: string,
  user: Pick<
    UserData,
    | "dailyMissions"
    | "dailyErrands"
    | "dailyMedicalMissions"
    | "dailyPvpMissions"
    | "dailyWarMissions"
  >,
) => {
  switch (questType) {
    case "mission":
    case "crime":
      return {
        field: "dailyMissions" as const,
        current: user.dailyMissions,
        limit: MISSIONS_PER_DAY,
      };
    case "errand":
      return {
        field: "dailyErrands" as const,
        current: user.dailyErrands,
        limit: ERRANDS_PER_DAY,
      };
    case "medical":
      return {
        field: "dailyMedicalMissions" as const,
        current: user.dailyMedicalMissions,
        limit: MEDICAL_MISSIONS_PER_DAY,
      };
    case "pvp":
      return {
        field: "dailyPvpMissions" as const,
        current: user.dailyPvpMissions,
        limit: PVP_MISSIONS_PER_DAY,
      };
    case "war":
      return {
        field: "dailyWarMissions" as const,
        current: user.dailyWarMissions,
        limit: WAR_MISSIONS_PER_DAY,
      };
    default:
      return null;
  }
};

/** Shared feedback when an assignment's daily quota is exhausted. */
export const questDailyLimitMessage = (questType: string, limit: number) => {
  const label =
    questType === "medical"
      ? "medical mission"
      : questType === "pvp"
        ? "PvP mission"
        : questType === "war"
          ? "war mission"
          : questType;
  return `You have reached your daily ${label} limit of ${limit}${
    questType === "war" ? "" : ". Please try again tomorrow."
  }`;
};

/** Structure used by the quest's normal UI entry point. */
export const questStructureRoute = (questType: string) => {
  switch (questType) {
    case "mastery":
      return "/traininggrounds" as const;
    case "event":
      return "/adminbuilding" as const;
    case "story":
      return "/globalanbuhq" as const;
    case "battlepyramid":
      return "/battlearena" as const;
    case "anbu":
      return "/anbu" as const;
    default:
      return "/missionhall" as const;
  }
};

/** Check whether the quest's hall is inaccessible here, allowing outlaw starts that do not require a hall. */
export const questRequiresTravel = (
  questType: string,
  user: NonNullable<UserWithRelations>,
  sectorVillage?: SectorVillage | null,
) => {
  if (user.isOutlaw && !["event", "story", "anbu"].includes(questType)) return false;
  return !canAccessStructure(user, questStructureRoute(questType), sectorVillage);
};

/** War missions follow the mission hall: an involved village, including allies, and the daily cap. */
export const isWarMissionAvailable = ({
  questType,
  villageId,
  dailyWarMissions,
  activeWars,
}: {
  questType: string;
  villageId: string | null;
  dailyWarMissions: number;
  activeWars: QuestWarSummary[];
}) => {
  if (questType !== "war") return true;
  if (!villageId || dailyWarMissions >= WAR_MISSIONS_PER_DAY) return false;
  return isVillageInvolvedInAnyWar(activeWars, villageId);
};

/** Enforce mission-hall rank limits and reserve village and S-rank missions for their dedicated flows. */
export const isQuestRankAllowed = (
  quest: Pick<Quest, "questType" | "questRank">,
  user: Pick<UserData, "rank">,
  source: "ui" | "random_assignment" = "ui",
) => {
  if (
    quest.questType === "village_mission" ||
    (quest.questType === "mission" && quest.questRank === "S")
  )
    return false;
  if (source === "random_assignment" && quest.questType !== "mission") return true;
  return availableQuestLetterRanks(user.rank).includes(quest.questRank);
};

interface QuestWarSummary {
  attackerVillageId: string;
  defenderVillageId: string;
  warAllies: { villageId: string }[];
}
