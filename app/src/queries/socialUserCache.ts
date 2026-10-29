import { eq, inArray } from "drizzle-orm";
import { clan, quest, userData, village } from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";

/** Observe queue cleanup without assuming a guarded wake displaced a newer combat. */
export const findQueueUserCache = (
  client: Pick<DrizzleClient, "query">,
  userId: string,
) =>
  client.query.userData.findFirst({
    where: eq(userData.userId, userId),
    columns: {
      status: true,
      battleId: true,
      updatedAt: true,
      travelFinishAt: true,
      bracketImmunityLiftedUntil: true,
      bracketImmunityPausedAt: true,
    },
  });

/** Read SQL-generated war timers, conditional mission cancellation and committed balances. */
export const findWarUserCache = (
  client: Pick<DrizzleClient, "query">,
  userId: string,
) =>
  client.query.userData.findFirst({
    where: eq(userData.userId, userId),
    columns: {
      warMission: true,
      immunityUntil: true,
      bracketImmunityLiftedUntil: true,
      warParticipantUntil: true,
      money: true,
      villagePrestige: true,
      villageId: true,
    },
  });

/** A membership change replaces embedded settlements and the inputs to regeneration. */
export const findMembershipUserCache = (
  client: Pick<DrizzleClient, "query">,
  userId: string,
) =>
  client.query.userData.findFirst({
    where: eq(userData.userId, userId),
    columns: {
      sector: true,
      longitude: true,
      latitude: true,
      reputationPoints: true,
      clanId: true,
      villageId: true,
      isOutlaw: true,
      joinedVillageAt: true,
      villagePrestige: true,
      rank: true,
      senseiId: true,
      status: true,
      updatedAt: true,
      regeneration: true,
      homeType: true,
    },
    with: {
      clan: true,
      bloodline: true,
      raidBuffs: true,
      titles: true,
      village: {
        with: {
          structures: true,
          relationshipA: true,
          relationshipB: true,
          sectors: {
            columns: { sector: true, boostLockedUntil: true, shrineLevel: true },
          },
        },
      },
    },
  });

/** Only village fields changed by missions, governance, restoration and scheduled boosts. */
export const findVillageUserCache = (
  client: Pick<DrizzleClient, "query">,
  villageId: string,
) =>
  client.query.village.findFirst({
    where: eq(village.id, villageId),
    columns: {
      id: true,
      tokens: true,
      activeMission: true,
      missionCounters: true,
      structureMaintenanceDue: true,
      type: true,
      belowMemberMinimumSince: true,
      lastMaintenancePaidAt: true,
      kageId: true,
      leaderUpdatedAt: true,
      kageSchedule: true,
      shrineSettings: true,
    },
  });

/** Embedded clan fields, without the hall's member roster. */
export const findClanUserCache = (
  client: Pick<DrizzleClient, "query">,
  clanId: string,
) => client.query.clan.findFirst({ where: eq(clan.id, clanId) });

/** Confirm precisely the fields combat admission can settle, including due training queues. */
export const findBattleUserCache = (
  client: Pick<DrizzleClient, "query">,
  userId: string,
) =>
  client.query.userData.findFirst({
    where: eq(userData.userId, userId),
    columns: {
      sector: true,
      role: true,
      level: true,
      rank: true,
      bloodlineId: true,
      isAi: true,
      status: true,
      battleId: true,
      updatedAt: true,
      pveFights: true,
      pvpFights: true,
      stealthActive: true,
      stealthActivatedAt: true,
      immunityUntil: true,
      warParticipantUntil: true,
      bracketImmunityLiftedUntil: true,
      bracketImmunityPausedAt: true,
      curEnergy: true,
      curHealth: true,
      curChakra: true,
      curStamina: true,
      regenAt: true,
      questData: true,
      energyQueueHead: true,
      masteryQueueHead: true,
      elementalQueueHead: true,
      experience: true,
      petExperience: true,
      offence: true,
      defence: true,
      strength: true,
      speed: true,
      intelligence: true,
      willpower: true,
      ninjutsuMastery: true,
      genjutsuMastery: true,
      taijutsuMastery: true,
      bukijutsuMastery: true,
      bloodlineMastery: true,
      sageMastery: true,
      currentlyTrainingElement: true,
      elementalTrainingStartedAt: true,
      elementalTrainingSpeed: true,
      currentlyTrainingMastery: true,
      masteryTrainingStartedAt: true,
      trainingSpeed: true,
      dailyTrainings: true,
      elementalMastery: true,
    },
  });

/** Confirm conditional elder demotion and the staff takeover prestige floor. */
export const findGovernanceUserCache = (
  client: Pick<DrizzleClient, "query">,
  userId: string,
) =>
  client.query.userData.findFirst({
    where: eq(userData.userId, userId),
    columns: { rank: true, villagePrestige: true },
  });

/** Read scheduled boosts and their token balance in one relation query. */
export const findVillageBoostUserCache = (
  client: Pick<DrizzleClient, "query">,
  userId: string,
) =>
  client.query.userData.findFirst({
    where: eq(userData.userId, userId),
    columns: { villageId: true },
    with: {
      village: { columns: { id: true, tokens: true, shrineSettings: true } },
    },
  });

/** Load only the definitions needed to apply public masking to committed tracker goals. */
export const listBattleQuestCacheDefinitions = (
  client: Pick<DrizzleClient, "query">,
  questIds: string[],
) =>
  client.query.quest.findMany({
    where: inArray(quest.id, questIds),
    columns: { id: true, content: true },
  });
