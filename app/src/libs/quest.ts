import { ObjectiveReward } from "@/validators/objectives";
import { getQuestCounterFieldName } from "@/validators/user";
import { ObjectiveTracker, QuestTracker } from "@/validators/objectives";
import { secondsPassed } from "@/utils/time";
import { isQuestObjectiveAvailable } from "@/libs/objectives";
import { canChangeContent, canPlayHiddenQuests } from "@/utils/permissions";
import {
  IMG_MISSION_S,
  IMG_MISSION_A,
  IMG_MISSION_B,
  IMG_MISSION_C,
  IMG_MISSION_D,
  IMG_MISSION_E,
  VILLAGE_SYNDICATE_ID,
  ADDITIONAL_MISSION_REWARD_MULTIPLIER,
  type LetterRank,
  type QuestType,
  MAP_TOTAL_SECTORS,
} from "@/drizzle/constants";
import { SECTOR_WIDTH, SECTOR_HEIGHT } from "@/libs/travel/constants";
import { getUnique } from "@/utils/grouping";
import { isQuestComplete, findCompletedPredecessor } from "@/libs/objectives";
import type { UserWithRelations } from "@/routers/profile";
import type {
  AllObjectivesType,
  AllObjectiveTask,
  ObjectiveRewardType,
} from "@/validators/objectives";
import type { Quest, UserData, UserItem } from "@/drizzle/schema";
import type { QuestTrackerType } from "@/validators/objectives";

/**
 * Get currently active quests for a user
 */
export const getUserQuests = (user: NonNullable<UserWithRelations>) => {
  const userQuests =
    user?.userQuests
      .filter((uq) => !!uq.quest)
      .filter((uq) => isAvailableUserQuests({ ...uq.quest, ...uq }, user, true).check)
      .map((uq) => ({ ...uq, ...uq.quest })) ?? [];
  return userQuests;
};

/**
 * Get active objectives for a user
 */
export const getActiveObjectives = (user: NonNullable<UserWithRelations>) => {
  const activeQuests = user.userQuests.map((uq) => uq.quest);
  const activeObjectives: AllObjectivesType[] = [];
  activeQuests.forEach((quest) => {
    const tracker = user.questData?.find((q) => q.id === quest.id);
    quest?.content.objectives.forEach((objective, i) => {
      if (tracker && !isQuestObjectiveAvailable(quest, tracker, i)) {
        return;
      }
      const goal = tracker?.goals.find((g) => g.id === objective.id);
      if (goal && goal.done === false) {
        if (goal.sector !== objective.sector) {
          objective.sector = goal.sector;
        }
        if (goal.longitude !== objective.longitude) {
          objective.longitude = goal.longitude;
        }
        if (goal.latitude !== objective.latitude) {
          objective.latitude = goal.latitude;
        }
        activeObjectives.push(objective);
      }
    });
  });
  return activeObjectives;
};

/**
 * Check if this is a location objective and user is at the location
 */
export const isLocationObjective = (
  location: { latitude: number; longitude: number; sector: number },
  objective: AllObjectivesType,
) => {
  if ("sector" in objective) {
    if (
      location.sector === Number(objective.sector) &&
      location.latitude === Number(objective.latitude) &&
      location.longitude === Number(objective.longitude)
    ) {
      return true;
    }
  }
  return false;
};

/**
 * Go through current user quests, and return updated list of questData &
 * list of rewards to award the user
 * @param user - User with questData
 * @param questId - Quest ID
 * @param dialogNextObjectiveId - Requested next objective ID,
 * @returns Rewards, trackers, userQuest, resolved, successDescriptions
 */
export const getReward = (
  user: NonNullable<UserWithRelations>,
  questId: string,
  dialogNextObjectiveId?: string,
) => {
  // Derived
  let rawRewards = ObjectiveReward.parse({});
  const { trackers, notifications, consequences } = getNewTrackers(user, [
    { task: "any" },
    { task: "dialog", contentId: dialogNextObjectiveId },
  ]);
  const userQuest = user.userQuests.find((uq) => uq.questId === questId);
  let resolved = false;
  // Start mutating
  if (userQuest && !userQuest.completed) {
    const tracker = trackers.find((q) => q.id === userQuest.quest.id);
    const goals = tracker?.goals ?? [];
    resolved = !tracker || isQuestComplete(userQuest.quest, tracker);
    if (resolved) {
      rawRewards = ObjectiveReward.parse(userQuest.quest.content.reward);
    }
    userQuest.quest.content.objectives.forEach((objective) => {
      const status = goals.find((g) => g.id === objective.id);
      if (status?.done && !status.collected) {
        status.collected = true;
        if (objective.successDescription) {
          notifications.push(objective.successDescription);
        }
        if (objective.reward_money) {
          rawRewards.reward_money += objective.reward_money;
        }
        if (objective.reward_clanpoints) {
          rawRewards.reward_clanpoints += objective.reward_clanpoints;
        }
        if (objective.reward_exp) {
          rawRewards.reward_exp += objective.reward_exp;
        }
        if (objective.reward_tokens) {
          rawRewards.reward_tokens += objective.reward_tokens;
        }
        if (objective.reward_prestige) {
          rawRewards.reward_prestige += objective.reward_prestige;
        }
        if (objective.reward_reputation) {
          rawRewards.reward_reputation += objective.reward_reputation;
        }
        if (objective.reward_jutsus) {
          rawRewards.reward_jutsus.push(...objective.reward_jutsus);
        }
        if (objective.reward_badges) {
          rawRewards.reward_badges.push(...objective.reward_badges);
        }
        if (objective.reward_items) {
          rawRewards.reward_items.push(...objective.reward_items);
        }
        if (objective.reward_bloodlines) {
          rawRewards.reward_bloodlines = objective.reward_bloodlines;
        }
        if (objective.reward_rank !== "NONE") {
          rawRewards.reward_rank = objective.reward_rank;
        }
      }
    });
    // Scale rewards
    const isMissionOrCrime =
      userQuest.quest.questType === "mission" || userQuest.quest.questType === "crime";
    const factor =
      isMissionOrCrime && user.dailyMissions > 9
        ? ADDITIONAL_MISSION_REWARD_MULTIPLIER
        : 1;
    rawRewards.reward_money = Math.floor(rawRewards.reward_money * factor);
    rawRewards.reward_clanpoints = Math.floor(rawRewards.reward_clanpoints * factor);
    rawRewards.reward_exp = Math.floor(rawRewards.reward_exp * factor);
    rawRewards.reward_tokens = Math.floor(rawRewards.reward_tokens * factor);
    rawRewards.reward_prestige = Math.floor(rawRewards.reward_prestige * factor);
    rawRewards.reward_reputation = Math.floor(rawRewards.reward_reputation * factor);
  }
  // Final rewards (some need a bit pose-processing)
  const rewards = postProcessRewards(rawRewards);

  // Return results
  return { rewards, trackers, userQuest, resolved, notifications, consequences };
};

export type GetRewardResult = ReturnType<typeof getReward>["rewards"];

/**
 * Post-process rewards to ensure that the rewards are valid
 * @param rewards - Rewards to post-process
 * @returns Post-processed rewards
 */
export const postProcessRewards = (rewards: ObjectiveRewardType) => {
  return {
    ...rewards,
    reward_items: rewards.reward_items
      .filter((reward) => {
        return Math.random() * 100 < reward.number;
      })
      .map((reward) => reward.ids)
      .flat(),
  };
};
export type PostProcessedRewards = ReturnType<typeof postProcessRewards>;

/**
 * Collapse multiple rewards into a single reward
 * @param rewards - Rewards to collapse
 * @returns Collapsed reward
 */
export const collapseRewards = (
  rewards: ObjectiveRewardType[],
): ObjectiveRewardType => {
  const collapsed: ObjectiveRewardType = {
    reward_money: 0,
    reward_clanpoints: 0,
    reward_exp: 0,
    reward_tokens: 0,
    reward_prestige: 0,
    reward_reputation: 0,
    reward_items: [],
    reward_jutsus: [],
    reward_bloodlines: [],
    reward_badges: [],
    reward_rank: "NONE",
  };

  rewards.forEach((reward) => {
    // Sum numeric rewards
    collapsed.reward_money += reward.reward_money;
    collapsed.reward_clanpoints += reward.reward_clanpoints;
    collapsed.reward_exp += reward.reward_exp;
    collapsed.reward_tokens += reward.reward_tokens;
    collapsed.reward_prestige += reward.reward_prestige;
    collapsed.reward_reputation += reward.reward_reputation;

    // Concatenate array rewards
    collapsed.reward_items.push(...reward.reward_items);
    collapsed.reward_jutsus.push(...reward.reward_jutsus);
    collapsed.reward_bloodlines.push(...reward.reward_bloodlines);
    collapsed.reward_badges.push(...reward.reward_badges);

    // Handle rank reward (take the highest rank)
    if (reward.reward_rank !== "NONE") {
      if (collapsed.reward_rank === "NONE") {
        collapsed.reward_rank = reward.reward_rank;
      } else {
        // Compare ranks and keep the higher one
        const rankOrder = ["NONE", "GENIN", "CHUNIN", "JONIN", "SANNIN", "KAGE"];
        const currentIndex = rankOrder.indexOf(collapsed.reward_rank);
        const newIndex = rankOrder.indexOf(reward.reward_rank);
        if (newIndex > currentIndex) {
          collapsed.reward_rank = reward.reward_rank;
        }
      }
    }
  });

  return collapsed;
};

export type QuestConsequence = {
  type:
    | "add_item"
    | "remove_item"
    | "combat"
    | "fail_quest"
    | "start_quest"
    | "reset_quest"
    | "update_user";
  ids: string[];
  scaleStats?: boolean;
  scaleGains?: number;
};

/**
 * Used to update the quest tracking data for a user. Takes in the user with his questData
 * information, as well as a task to update. The value is the value to update the task with,
 * e.g. if task is 'pvp_kills' and value is 1, then the user has killed 1 player. This function
 * also ensure to remove all questData which is no longer needed, i.e. data relating to quests no longer
 * active for the user
 * @param user  - User with questData
 * @param task - Task to update
 * @param value - Value to update task with
 * @param contentId - If provided, refers to ID of content, e.g. opponentID defeated
 * @param notifications - If provided, is used to set notifications
 */
export const getNewTrackers = (
  user: NonNullable<UserWithRelations> & { useritems?: UserItem[] },
  tasks: {
    task: AllObjectiveTask | "any";
    increment?: number;
    value?: number;
    text?: string;
    contentId?: string;
  }[],
) => {
  const questData = user.questData ?? [];
  const activeQuests = getUserQuests(user);
  const notifications: string[] = [];
  const questIdsUpdated: string[] = [];
  const consequences: QuestConsequence[] = [];
  const trackers = activeQuests
    .map((quest) => {
      if (quest) {
        // Get the quest tracker for this quest, or create it
        let questTracker = questData.find((q) => q.id === quest.id);
        if (!questTracker) {
          questTracker = QuestTracker.parse({ id: quest.id });
        }
        // Update the goals of the quest
        questTracker.goals = quest.content.objectives.map((objective, i) => {
          // Get the current goal, or create it
          let status = questTracker?.goals.find((goal) => goal.id === objective.id);
          if (!status) {
            status = ObjectiveTracker.parse({ id: objective.id });
          }

          if ("sectorType" in objective && status.sector === undefined) {
            if (objective.sectorType === "specific") {
              status.sector = objective.sector;
            } else if (objective.sectorType === "random") {
              status.sector = Math.floor(Math.random() * MAP_TOTAL_SECTORS);
            } else if (objective.sectorType === "from_list") {
              if (objective.sectorList.length === 0) {
                status.sector = Math.floor(Math.random() * MAP_TOTAL_SECTORS);
              } else {
                const idx = Math.floor(Math.random() * objective.sectorList.length);
                status.sector = Number(objective.sectorList?.[idx]);
              }
            } else if (objective.sectorType === "user_village") {
              status.sector = user?.village?.sector || user.sector;
            } else if (objective.sectorType === "current_sector") {
              status.sector = user.sector;
            }
            if (status.sector !== undefined) {
              consequences.push({ type: "update_user", ids: ["location_update"] });
            }
          }

          // If locationType is not specific, update the location accordingly
          if (
            "locationType" in objective &&
            (status.longitude === undefined || status.latitude === undefined)
          ) {
            if (objective.locationType === "specific") {
              status.longitude = objective.longitude;
              status.latitude = objective.latitude;
            } else if (objective.locationType === "random") {
              status.longitude = Math.floor(Math.random() * SECTOR_WIDTH);
              status.latitude = Math.floor(Math.random() * SECTOR_HEIGHT);
            }
            if (status.longitude !== undefined && status.latitude !== undefined) {
              consequences.push({ type: "update_user", ids: ["location_update"] });
            }
          }

          // If a dialog, find any previous objective pointing to this one, and set the location to the same location
          const previousObjective = findCompletedPredecessor(
            quest.content.objectives,
            objective.id,
            questTracker,
          );

          if (previousObjective) {
            if (status.sector === undefined && "sector" in previousObjective) {
              status.sector = previousObjective.sector;
              consequences.push({ type: "update_user", ids: [`sector_update`] });
            }
            if (status.longitude === undefined && "longitude" in previousObjective) {
              status.longitude = previousObjective.longitude;
              consequences.push({ type: "update_user", ids: [`longitude_update`] });
            }
            if (status.latitude === undefined && "latitude" in previousObjective) {
              status.latitude = previousObjective.latitude;
              consequences.push({ type: "update_user", ids: [`latitude_update`] });
            }
          }

          // If we have a location on the status (i.e. instantiated for the user, overwrite objective)
          if ("sector" in objective) {
            if (status.longitude !== undefined) objective.longitude = status.longitude;
            if (status.latitude !== undefined) objective.latitude = status.latitude;
            if (status.sector !== undefined) objective.sector = status.sector;
            if ("locationType" in objective) {
              objective.locationType = "specific";
            }
          }

          // If done, return status
          if (status.done) {
            return status;
          }

          // If not available yet, just skip
          if (questTracker && !isQuestObjectiveAvailable(quest, questTracker, i)) {
            return status;
          }

          // Convenience
          const task = objective.task;
          const isKage = user.village?.kageId === user.userId;

          // General updates we want to apply every time
          if (task === "user_level") {
            status.value = user.level;
          } else if (task === "days_in_village") {
            const days = Math.floor(secondsPassed(user.joinedVillageAt) / 60 / 60 / 24);
            status.value = days;
          } else if (task === "days_as_kage" && isKage && user.village) {
            const seconds = secondsPassed(user.village.leaderUpdatedAt);
            const days = Math.floor(seconds / 60 / 60 / 24);
            status.value = days;
          } else if (task === "reputation_points") {
            status.value = user.reputationPointsTotal;
          } else if (task === "minutes_passed" && questTracker) {
            const minutes = Math.floor(
              secondsPassed(new Date(questTracker.startAt)) / 60,
            );
            status.value = minutes;
          } else if (task.includes("missions_total") || task.includes("crimes_total")) {
            const type = task.includes("missions") ? "mission" : "crime";
            const rank = task.split("_")[0]?.toUpperCase() as LetterRank;
            const field = getQuestCounterFieldName(type, rank);
            if (field) status.value = user[field];
          } else if (task === "errands_total") {
            const field = getQuestCounterFieldName("errand", "D");
            if (field) status.value = user[field];
          }

          // If opponentAIs is in objective, get the ids
          let opponentIds: string[] = [];
          if ("opponentAIs" in objective) {
            opponentIds = objective.opponentAIs
              .flatMap((o) => Array(o.number).fill(o.ids).flat() as string[])
              .filter((id): id is string => id !== undefined);
          }

          /** Helper function to put the user in combat */
          const putInCombat = () => {
            if (
              opponentIds.length > 0 &&
              "opponentAIs" in objective &&
              user.status === "AWAKE"
            ) {
              notifications.push(
                `Attacking ${opponentIds.length} target${opponentIds.length > 1 ? "s" : ""} for ${quest.name}.`,
              );
              consequences.push({
                type: "combat",
                ids: opponentIds,
                scaleStats: objective.opponent_scaled_to_user,
                scaleGains: objective.scaleGains,
              });
            }
          };

          // Instant objectives
          if (task === "win_quest") {
            status.done = true;
          } else if (task === "reset_quest") {
            consequences.push({ type: "reset_quest", ids: [quest.id] });
          } else if (task === "fail_quest") {
            consequences.push({ type: "fail_quest", ids: [quest.id] });
            notifications.push(objective.description || `Failed: ${quest.name}`);
          } else if (task === "new_quest" && "newQuestIds" in objective) {
            status.done = true;
            consequences.push({ type: "start_quest", ids: objective.newQuestIds });
          } else if (task === "start_battle") {
            if (!status.recentlyDied) {
              putInCombat();
            }
          }

          // Specific updates requested by the caller
          tasks
            .filter((taskUpdate) => taskUpdate.task === task)
            .forEach((taskUpdate) => {
              // If objective has a value, increment it
              if (status && "value" in objective) {
                if (taskUpdate.increment) {
                  status.value += taskUpdate.increment;
                }
                if (taskUpdate.value) {
                  status.value = taskUpdate.value;
                }
              }
              // Dialog objective
              if (task === "dialog" && taskUpdate.contentId) {
                const objectiveHasNext = objective.nextObjectiveId?.find(
                  (next) => next.nextObjectiveId === taskUpdate.contentId,
                );
                if (objectiveHasNext) {
                  status.done = true;
                  status.selectedNextObjectiveId = taskUpdate.contentId;
                }
              } else if (
                quest.consecutiveObjectives &&
                "nextObjectiveId" in objective &&
                typeof objective.nextObjectiveId === "string" &&
                !status.selectedNextObjectiveId
              ) {
                status.selectedNextObjectiveId = objective.nextObjectiveId;
              }

              // If objective has a location, set to completed
              if (status && isLocationObjective(user, objective)) {
                if (task === "move_to_location") {
                  notifications.push(`You arrived at destination for ${quest.name}.`);
                  status.done = true;
                } else if (
                  task === "collect_item" &&
                  "item_name" in objective &&
                  "collectItemIds" in objective &&
                  objective.collectItemIds
                ) {
                  notifications.push(`Got ${objective.item_name} for ${quest.name}.`);
                  consequences.push({
                    type: "add_item",
                    ids: objective.collectItemIds,
                  });
                  status.done = true;
                } else if (
                  task === "deliver_item" &&
                  "item_name" in objective &&
                  "deliverItemIds" in objective &&
                  objective.deliverItemIds
                ) {
                  // Verify user has these items
                  const check = objective.deliverItemIds.every((id) =>
                    user.useritems?.some((ui) => ui.itemId === id),
                  );
                  if (!check) {
                    notifications.push(
                      `You don't have ${objective.item_name} to deliver for ${quest.name}.`,
                    );
                    return;
                  }
                  // Remove items & complete objective
                  notifications.push(
                    `Delivered ${objective.item_name} for ${quest.name}.`,
                  );
                  consequences.push({
                    type: "remove_item",
                    ids: objective.deliverItemIds,
                  });
                  status.done = true;
                }
                if (task === "defeat_opponents" && opponentIds.length > 0) {
                  if (!opponentIds.includes(taskUpdate.contentId || "1337")) {
                    putInCombat();
                  }
                }
              }

              // Defeating specific opponents
              if (
                status &&
                ["start_battle", "defeat_opponents"].includes(task) &&
                "opponentAIs" in objective &&
                opponentIds.length > 0
              ) {
                if (
                  taskUpdate.text &&
                  opponentIds.includes(taskUpdate.contentId || "1337")
                ) {
                  const completionOutcome = objective.completionOutcome || "Win";
                  if (completionOutcome === "Any") {
                    status.done = true;
                  }
                  if (taskUpdate.text === "Won") {
                    if (objective.successDescription) {
                      notifications.push(objective.successDescription);
                    }
                    if (completionOutcome === "Win") {
                      status.done = true;
                    }
                  } else if (taskUpdate.text === "Lost") {
                    if (objective.failDescription) {
                      notifications.push(objective.failDescription);
                    }
                    if (completionOutcome === "Lose") {
                      status.done = true;
                    }
                    if (task === "start_battle") {
                      status.recentlyDied = true;
                    }
                  } else if (taskUpdate.text === "Draw") {
                    if (objective.drawDescription) {
                      notifications.push(objective.drawDescription);
                    }
                    if (completionOutcome === "Draw") {
                      status.done = true;
                    }
                  } else if (taskUpdate.text === "Fled") {
                    if (objective.fleeDescription) {
                      notifications.push(objective.fleeDescription);
                    }
                    if (completionOutcome === "Flee") {
                      status.done = true;
                    }
                  }
                  if (
                    !status.done &&
                    "failObjectiveId" in objective &&
                    objective.failObjectiveId
                  ) {
                    status.selectedNextObjectiveId = objective.failObjectiveId;
                    status.done = true;
                  }
                }
              }

              // Handle manual retriggering of start_battle objectives
              if (task === "start_battle" && taskUpdate.text === "retry") {
                status.recentlyDied = false;
                putInCombat();
                return;
              }
            });
          if ("value" in objective && status.value >= objective.value) {
            status.done = true;
          }

          // If status is now done, then add quest id to list of updated quests
          if (status.done) {
            questIdsUpdated.push(quest.id);
          }

          return status;
        });
        return questTracker;
      }
    })
    .filter((q): q is QuestTrackerType => !!q);

  return {
    trackers: getUnique(trackers, "id"),
    notifications,
    consequences,
    questIdsUpdated,
  };
};

export const getMissionHallSettings = (isOutlaw: boolean) => {
  const type = isOutlaw ? "crime" : "mission";
  return [
    {
      type: "errand",
      rank: "D",
      name: "Errand",
      image: IMG_MISSION_E,
      delayMinutes: 1,
      description: `Errands typically involve simple tasks such as fetching an item somewhere in the village, delivering groceries, etc.`,
    },
    {
      type: type,
      rank: "D",
      name: "D-rank",
      image: IMG_MISSION_D,
      delayMinutes: 5,
      description: `D-rank ${type}s are the lowest rank of ${type}s. They are usually simple ${type}s that have a low chance of danger, finding & retrieving items, doing manual labor, or fetching a lost cat`,
    },
    {
      type: type,
      rank: "C",
      name: "C-rank",
      image: IMG_MISSION_C,
      delayMinutes: 10,
      description: `C-rank ${type}s are the second lowest rank of ${type}s. They are usually ${type}s that have a chance of danger, e.g. escorting a client through friendly territory, etc.`,
    },
    {
      type: type,
      rank: "B",
      name: "B-rank",
      image: IMG_MISSION_B,
      delayMinutes: 15,
      description: `B-rank ${type}s are the third highest rank of ${type}s. They are usually ${type}s that have a decent chance of danger, e.g. escorting a client through neutral or enemy territory.`,
    },
    {
      type: type,
      rank: "A",
      name: "A-rank",
      image: IMG_MISSION_A,
      delayMinutes: 20,
      description: `A-rank ${type}s are the second highest rank of ${type}s. They usually have a high chance of danger and are considered to be very difficult, e.g. assassinating a target, etc.`,
    },
    {
      type: type,
      rank: "S",
      name: "S-rank",
      image: IMG_MISSION_S,
      delayMinutes: 25,
      description: `S-rank ${type}s are the highest rank of ${type}s. They are usually extremely dangerous and difficult and reserved for kage-level shinobi.`,
    },
  ] as const;
};

export const mockAchievementHistoryEntries = (
  achievements: Quest[],
  user: NonNullable<UserWithRelations>,
) => {
  return achievements
    .filter((q) => q !== null)
    .filter((q) => !q.hidden || canChangeContent(user.role))
    .filter((q) => !user.userQuests?.find((uq) => uq.questId === q.id))
    .map((a) => ({
      id: a.id,
      userId: user.userId,
      questId: a.id,
      questType: a.questType,
      completed: 0,
      previousCompletes: 0,
      previousAttempts: 0,
      quest: a,
      endAt: null,
      startedAt: new Date(),
    }));
};

/**
 * Hides the location information of quest objectives if certain conditions are met.
 *
 * @param quest - The quest object containing objectives.
 * @param user - Optional user data to check against objective sectors.
 *
 * This function iterates over each objective in the quest's content. If an objective has the
 * `hideLocation` property set to true and the user's sector does not match the objective's sector,
 * it will obfuscate the objective's location by setting its latitude, longitude, and sector to 1337.
 */
export const controlShownQuestLocationInformation = (
  quest?: Quest,
  user?: UserData,
) => {
  const tracker = user?.questData?.find((q) => q.id === quest?.id);
  quest?.content.objectives.forEach((objective) => {
    // If we have a tracker which specifies the location, use that (e.g. from random sectors etc)
    const status = tracker?.goals.find((goal) => goal.id === objective.id);
    if (tracker && status) {
      if ("sector" in status) {
        objective.sector = status.sector;
      }
      if ("longitude" in status) {
        objective.longitude = status.longitude!;
      }
      if ("latitude" in status) {
        objective.latitude = status.latitude!;
      }
    }

    // If we should hide the location, hide it when the user is not in the sector
    if (
      "hideLocation" in objective &&
      objective.hideLocation &&
      user?.sector !== objective.sector &&
      !canChangeContent(user?.role || "USER")
    ) {
      if (status) {
        delete status.sector;
        delete status.longitude;
        delete status.latitude;
      }
      objective.latitude = 1337;
      objective.longitude = 1337;
      objective.sector = 1337;
      objective.sectorType = "specific";
      objective.sectorList = ["1337"];
      objective.locationType = "specific";
    }
  });
};

/**
 * Filters out hidden and expired quests based on the user's role.
 *
 * @param questAndUserQuestInfo - The quest object to be checked.
 * @param role - The role of the user.
 * @returns A boolean indicating whether the quest is either hidden and the user can play hidden quests, or the quest is not expired.
 */
export const isAvailableUserQuests = (
  questAndUserQuestInfo: {
    hidden: boolean;
    maxAttempts: number;
    maxCompletes: number;
    questType: QuestType;
    endsAt?: string | null;
    requiredVillage: string | null;
    prerequisiteQuestId?: string | null;
    previousAttempts?: number | null;
    previousCompletes?: number | null;
    completed?: number | null;
  },
  user: UserData & {
    completedQuests: { id: string; questId: string; completed?: number }[];
  },
  ignorePreviousAttempts = false,
) => {
  const maxAttempts = questAndUserQuestInfo.maxAttempts;
  const maxCompletes = questAndUserQuestInfo.maxCompletes;
  const hideCheck = !questAndUserQuestInfo.hidden || canPlayHiddenQuests(user.role);
  const expiresCheck =
    !questAndUserQuestInfo.endsAt ||
    new Date(questAndUserQuestInfo.endsAt) > new Date();
  const villageCheck =
    !questAndUserQuestInfo.requiredVillage ||
    questAndUserQuestInfo.requiredVillage === user.villageId ||
    (questAndUserQuestInfo.requiredVillage === VILLAGE_SYNDICATE_ID && user.isOutlaw);

  // Event specific tests
  const eventCompletedCheck =
    questAndUserQuestInfo.questType !== "event" ||
    !questAndUserQuestInfo.previousCompletes ||
    questAndUserQuestInfo.previousCompletes < maxCompletes;
  const eventAttemptsCheck =
    ignorePreviousAttempts ||
    questAndUserQuestInfo.questType !== "event" ||
    !questAndUserQuestInfo.previousAttempts ||
    questAndUserQuestInfo.previousAttempts < maxAttempts;

  // Story specific checks
  const storyCompletedCheck =
    questAndUserQuestInfo.questType !== "story" ||
    !questAndUserQuestInfo.previousCompletes ||
    questAndUserQuestInfo.previousCompletes < maxCompletes;
  const storyAttemptsCheck =
    ignorePreviousAttempts ||
    questAndUserQuestInfo.questType !== "story" ||
    !questAndUserQuestInfo.previousAttempts ||
    questAndUserQuestInfo.previousAttempts < maxAttempts;

  // Check if prerequisite quest is completed
  const prerequisiteCheck =
    !questAndUserQuestInfo.prerequisiteQuestId ||
    user.completedQuests?.some((q) => {
      return (
        q.questId === questAndUserQuestInfo.prerequisiteQuestId && q.completed === 1
      );
    });

  // Check if quest is available
  const check =
    hideCheck &&
    expiresCheck &&
    eventCompletedCheck &&
    eventAttemptsCheck &&
    villageCheck &&
    prerequisiteCheck &&
    storyCompletedCheck &&
    storyAttemptsCheck;

  // If quest is not available, return the reason
  let message = "";
  if (!hideCheck) message += "Quest is hidden\n";
  if (!expiresCheck) message += "Quest has expired\n";
  if (!eventCompletedCheck) message += "Quest has been completed too many times\n";
  if (!eventAttemptsCheck) message += "Quest has been attempted too many times\n";
  if (!villageCheck) message += "Quest is not available in your village\n";
  if (!prerequisiteCheck) message += "You must complete the prerequisite quest first\n";
  if (!storyCompletedCheck) message += "Story quest already completed\n";
  if (!storyAttemptsCheck) message += "Story quest has been attempted too many times\n";
  // Returned detailed info on all the checks
  return { check, message };
};

/**
 * Verifies that the objective flow is valid according to the following rules:
 * - There can only be one starting objective, i.e. an objective where no other objectives point to it
 * - All objectives must be connected to the starting objective via a chain of nextObjectiveId
 * - All defined nextObjectiveId must be valid, i.e. point to an existing objective
 *
 * @param objectives - The objectives to verify.
 * @returns A boolean indicating whether the objective flow is valid.
 */
export const verifyQuestObjectiveFlow = (
  objectives: AllObjectivesType[],
): { check: boolean; message: string } => {
  // Helper which normalises the various `nextObjectiveId` shapes into a flat list of ids
  const collectNextIds = (obj: AllObjectivesType): string[] => {
    const result: string[] = [];
    const ref: unknown = (obj as { nextObjectiveId?: unknown }).nextObjectiveId;

    if (typeof ref === "string") {
      result.push(ref);
    } else if (Array.isArray(ref)) {
      for (const branch of ref) {
        if (branch && typeof branch === "object") {
          const id = (branch as { nextObjectiveId?: string }).nextObjectiveId;
          if (typeof id === "string") result.push(id);
        }
      }
    }

    return result;
  };

  try {
    // ------------------------------------------------------------------
    // 0. Basic presence check
    // ------------------------------------------------------------------
    if (!objectives || objectives.length === 0) {
      throw new Error("No objectives provided");
    }

    // ------------------------------------------------------------------
    // 1. Build quick lookup map & guard against duplicate ids
    // ------------------------------------------------------------------
    const idToObj = new Map<string, AllObjectivesType>();
    for (const obj of objectives) {
      if (idToObj.has(obj.id)) {
        throw new Error(`Duplicate objective id '${obj.id}'`);
      }
      idToObj.set(obj.id, obj);
    }

    // ------------------------------------------------------------------
    // 2. Build adjacency list while validating references & special rules
    // ------------------------------------------------------------------
    const adjacency = new Map<string, string[]>();
    const referencedIds = new Set<string>();

    for (const obj of objectives) {
      // Dialog objectives must expose at least one option (branch)
      if (obj.task === "dialog") {
        const nextRef = (obj as { nextObjectiveId?: unknown }).nextObjectiveId;
        if (!Array.isArray(nextRef) || nextRef.length === 0) {
          throw new Error(`Dialog objective '${obj.id}' must have at least one option`);
        }
      }

      const neighbours = collectNextIds(obj);
      if (neighbours.length === 0) {
        adjacency.set(obj.id, adjacency.get(obj.id) ?? []);
      }

      for (const raw of neighbours) {
        if (!raw) continue; // Safeguard against undefined values
        const nextId = raw;
        // Self-reference
        if (nextId === obj.id) {
          throw new Error(
            `Objective '${obj.id}' has a self-referencing nextObjectiveId`,
          );
        }
        // Unknown reference
        if (!idToObj.has(nextId)) {
          throw new Error(
            `Objective '${obj.id}' references unknown nextObjectiveId '${nextId}'`,
          );
        }
        referencedIds.add(nextId);
        const list = adjacency.get(obj.id) ?? [];
        list.push(nextId);
        adjacency.set(obj.id, list);
      }
    }

    // ------------------------------------------------------------------
    // 3. Determine unique starting objective (never referenced by others)
    // ------------------------------------------------------------------
    const startingIds = objectives
      .map((o) => o.id)
      .filter((id) => !referencedIds.has(id));

    if (startingIds.length === 0) {
      throw new Error("No starting objective found");
    }
    if (startingIds.length > 1) {
      throw new Error(`Multiple starting objectives found: ${startingIds.join(", ")}`);
    }
    const startId = startingIds[0]!;

    // ------------------------------------------------------------------
    // 4. DFS to detect cycles & ensure reachability
    // ------------------------------------------------------------------
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const dfs = (currentId: string): void => {
      if (recursionStack.has(currentId)) {
        throw new Error("Cycle detected in objective chain");
      }
      if (visited.has(currentId)) return;

      visited.add(currentId);
      recursionStack.add(currentId);

      const neighbours = adjacency.get(currentId) ?? [];
      for (const next of neighbours) dfs(next);

      recursionStack.delete(currentId);
    };

    dfs(startId);

    // All objectives must be reachable from the start
    if (visited.size !== objectives.length) {
      const unreachable = objectives.filter((o) => !visited.has(o.id)).map((o) => o.id);
      throw new Error(`Unreachable objectives detected: ${unreachable.join(", ")}`);
    }

    return { check: true, message: "" };
  } catch (err) {
    return { check: false, message: (err as Error).message };
  }
};
