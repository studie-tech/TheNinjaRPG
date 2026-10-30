import { z } from "zod";
import {
  BasicElementName,
  ElementNames,
  FederalStatuses,
  MASTERY_RANKS,
  MasteryNames,
  OCCUPATIONS,
  TavernColorPresets,
  TrainingSpeeds,
  UserRanks,
  UserStatuses,
} from "@/drizzle/constants";
import type { UserItemWithRelations, UserQueue, UserRaidBuff } from "@/drizzle/schema";
import type {
  AchievementProgress,
  UserWithRelations,
} from "@/server/api/routers/profile";
import { baseServerResponse } from "@/validators/base";
import { QuestTracker } from "@/validators/objectives";
import { PostProcessedRewardSchema } from "@/validators/rewards";

export const userDeltaSchema = z.object({
  clan: z
    .object({
      id: z.string(),
      bank: z.number().optional(),
      repTreasury: z.number().optional(),
      points: z.number().optional(),
    })
    .optional(),
  village: z
    .object({
      id: z.string(),
      tokens: z.number().optional(),
    })
    .optional(),
  offence: z.number().optional(),
  defence: z.number().optional(),
  strength: z.number().optional(),
  speed: z.number().optional(),
  intelligence: z.number().optional(),
  willpower: z.number().optional(),
  ninjutsuMastery: z.number().optional(),
  genjutsuMastery: z.number().optional(),
  taijutsuMastery: z.number().optional(),
  bukijutsuMastery: z.number().optional(),
  bloodlineMastery: z.number().optional(),
  sageMastery: z.number().optional(),
  dailyArenaFights: z.number().optional(),
  dailySageActivations: z.number().optional(),

  bank: z.number().optional(),
  money: z.number().optional(),
  petExperience: z.number().optional(),
  earnedExperience: z.number().optional(),
  reputationPoints: z.number().optional(),
  seichiSilver: z.number().optional(),
  extraItemSlots: z.number().optional(),
  extraJutsuSlots: z.number().optional(),
  bloodrightSpent: z.number().optional(),
  reputationPointsTotal: z.number().optional(),
  villagePrestige: z.number().optional(),
  experience: z.number().optional(),
  skillPoints: z.number().optional(),
  medicalExperience: z.number().optional(),
  huntingExperience: z.number().optional(),
  cookingExperience: z.number().optional(),
  craftingExperience: z.number().optional(),
  gatheringExperience: z.number().optional(),
  sageMasteryExperience: z.number().optional(),
});

export type UserDelta = z.infer<typeof userDeltaSchema>;

// Absolute values are kept separate from arithmetic deltas so a saved field is never added.
export const userPatchSchema = z.object({
  federalStatus: z.enum(FederalStatuses).optional(),
  deletionAt: z.date().nullable().optional(),
  isBanned: z.boolean().optional(),
  isSilenced: z.boolean().optional(),
  isTradeBanned: z.boolean().optional(),
  isWarned: z.boolean().optional(),
  rankedLp: z.number().optional(),
  petTask: z.custom<NonNullable<UserWithRelations>["petTask"]>().optional(),
  unreadNotifications: z.number().optional(),
  activePetId: z.string().nullable().optional(),
  petSlots: z.number().optional(),
  petAcquisitions: z.number().optional(),
  petDailyClaims: z
    .object({ dayKey: z.string(), speciesIds: z.array(z.string()) })
    .nullable()
    .optional(),
  bloodlineId: z.string().nullable().optional(),
  bloodlineReskinId: z.string().nullable().optional(),
  bloodline: z.custom<NonNullable<UserWithRelations>["bloodline"]>().optional(),
  activeReskin: z.custom<NonNullable<UserWithRelations>["activeReskin"]>().optional(),
  userSkills: z
    .custom<NonNullable<UserWithRelations>["userSkills"]>(Array.isArray)
    .optional(),
  cookingJobs: z
    .array(
      z.object({
        id: z.string(),
        userId: z.string(),
        experience: z.number(),
        finishesAt: z.date(),
      }),
    )
    .optional(),
  spriteBodyStyle: z.enum(["male", "female"]).nullable().optional(),
  attributes: z.array(z.object({ attribute: z.string() })).optional(),
  elementalMastery: z.partialRecord(z.enum(BasicElementName), z.number()).optional(),
  activeTrainedElement: z.enum(BasicElementName).nullable().optional(),
  preferredDamageElement: z.enum(BasicElementName).nullable().optional(),
  dailySageActivations: z.number().optional(),
  dailyMedicalMissions: z.number().optional(),
  dailyWarMissions: z.number().optional(),
  dailyOverworldQuestRolls: z.number().optional(),
  missionsD: z.number().optional(),
  missionsC: z.number().optional(),
  missionsB: z.number().optional(),
  missionsA: z.number().optional(),
  missionsS: z.number().optional(),
  missionsH: z.number().optional(),
  crimesD: z.number().optional(),
  crimesC: z.number().optional(),
  crimesB: z.number().optional(),
  crimesA: z.number().optional(),
  crimesS: z.number().optional(),
  crimesH: z.number().optional(),
  errands: z.number().optional(),
  pveFights: z.number().optional(),
  pvpFights: z.number().optional(),
  pvpExperience: z.number().optional(),
  pvpStreak: z.number().optional(),
  dungeonsCompleted: z.number().optional(),
  raidsCompleted: z.number().optional(),
  sageModeId: z.string().nullable().optional(),
  sageMode: z.custom<NonNullable<UserWithRelations>["sageMode"]>().optional(),
  titles: z.custom<NonNullable<UserWithRelations>["titles"]>(Array.isArray).optional(),

  updatedAt: z.date().optional(),
  petExperience: z.number().optional(),
  experience: z.number().optional(),
  earnedExperience: z.number().optional(),
  level: z.number().optional(),
  rank: z.enum(UserRanks).optional(),
  status: z.enum(UserStatuses).optional(),
  travelFinishAt: z.date().nullable().optional(),
  battleId: z.string().nullable().optional(),
  activeNpcQuestId: z.string().nullable().optional(),
  senseiId: z.string().nullable().optional(),
  offence: z.number().optional(),
  defence: z.number().optional(),
  strength: z.number().optional(),
  speed: z.number().optional(),
  intelligence: z.number().optional(),
  willpower: z.number().optional(),
  masteryRanks: z.partialRecord(z.enum(MasteryNames), z.enum(MASTERY_RANKS)).optional(),
  ninjutsuMastery: z.number().optional(),
  genjutsuMastery: z.number().optional(),
  taijutsuMastery: z.number().optional(),
  bukijutsuMastery: z.number().optional(),
  bloodlineMastery: z.number().optional(),
  sageMastery: z.number().optional(),
  maxHealth: z.number().optional(),
  maxChakra: z.number().optional(),
  maxStamina: z.number().optional(),
  regeneration: z.number().optional(),
  regenerationWithoutTimedBuffs: z.number().optional(),
  dailyTrainings: z.number().optional(),
  dailyMissions: z.number().optional(),
  dailyErrands: z.number().optional(),
  dailyArenaFights: z.number().optional(),
  dailyPvpMissions: z.number().optional(),
  skillPoints: z.number().optional(),
  villagePrestige: z.number().optional(),
  reputationPointsTotal: z.number().optional(),
  medicalExperience: z.number().optional(),
  huntingExperience: z.number().optional(),
  cookingExperience: z.number().optional(),
  craftingExperience: z.number().optional(),
  gatheringExperience: z.number().optional(),
  sageMasteryExperience: z.number().optional(),
  questFinishAt: z.date().optional(),
  masteryTrainingStartedAt: z.date().nullable().optional(),
  currentlyTrainingMastery: z.enum(MasteryNames).nullable().optional(),
  currentlyTrainingElement: z.enum(BasicElementName).nullable().optional(),
  elementalTrainingStartedAt: z.date().nullable().optional(),
  elementalTrainingSpeed: z.enum(TrainingSpeeds).optional(),
  elementalQueueHead: z.number().optional(),
  /** Every queue entry; the client derives each queue with the heads below */
  queue: z.custom<UserQueue[]>(Array.isArray).optional(),
  energyQueueHead: z.number().optional(),
  energyQueueTail: z.number().optional(),
  masteryQueueHead: z.number().optional(),
  trainingSpeed: z.enum(TrainingSpeeds).optional(),
  questData: z.array(QuestTracker).nullable().optional(),
  /** Persisted trackers omit virtual achievements retained in the warmed profile. */
  persistedQuestData: z.array(QuestTracker).nullable().optional(),
  userQuests: z
    .custom<NonNullable<UserWithRelations>["userQuests"]>(Array.isArray)
    .optional(),
  completedQuests: z
    .custom<NonNullable<UserWithRelations>["completedQuests"]>(Array.isArray)
    .optional(),
  money: z.number().optional(),
  bank: z.number().optional(),
  seichiSilver: z.number().optional(),
  curEnergy: z.number().optional(),
  curHealth: z.number().optional(),
  curChakra: z.number().optional(),
  curStamina: z.number().optional(),
  regenAt: z.date().optional(),
  raidBuffs: z.custom<UserRaidBuff[]>(Array.isArray).optional(),
  marriageSlots: z.number().optional(),
  extraReskinSlots: z.number().optional(),
  extraJutsuSlots: z.number().optional(),
  itemLoadout: z.string().nullable().optional(),
  items: z
    .array(
      z.custom<UserItemWithRelations>(
        (value) =>
          value !== null &&
          typeof value === "object" &&
          "id" in value &&
          typeof value.id === "string" &&
          "equipped" in value &&
          typeof value.equipped === "string" &&
          "item" in value &&
          value.item !== null &&
          typeof value.item === "object" &&
          "imbuements" in value &&
          Array.isArray(value.imbuements),
      ),
    )
    .optional(),
  anbuId: z.string().nullable().optional(),
  anbuSquad: z.custom<NonNullable<UserWithRelations>["anbuSquad"]>().optional(),
  clanId: z.string().nullable().optional(),
  villageId: z.string().nullable().optional(),
  sector: z.number().optional(),
  longitude: z.number().optional(),
  latitude: z.number().optional(),
  isOutlaw: z.boolean().optional(),
  joinedVillageAt: z.date().optional(),
  immunityUntil: z.date().optional(),
  stealthActive: z.boolean().optional(),
  stealthActivatedAt: z.date().nullable().optional(),
  bracketImmunityLiftedUntil: z.date().nullable().optional(),
  bracketImmunityPausedAt: z.date().nullable().optional(),
  warParticipantUntil: z.date().nullable().optional(),
  warMission: z.custom<NonNullable<UserWithRelations>["warMission"]>().optional(),
  activeWars: z
    .custom<NonNullable<UserWithRelations>["activeWars"]>(Array.isArray)
    .optional(),
  shrineBattles: z
    .custom<NonNullable<UserWithRelations>["shrineBattles"]>(Array.isArray)
    .optional(),
  activeRaids: z
    .custom<NonNullable<UserWithRelations>["activeRaids"]>(Array.isArray)
    .optional(),
  clan: z
    .custom<
      | (Partial<NonNullable<NonNullable<UserWithRelations>["clan"]>> & { id: string })
      | null
    >()
    .optional(),
  avatar: z.string().nullable().optional(),
  avatarLight: z.string().nullable().optional(),
  jutsuLoadout: z.string().optional(),
  loadout: z.object({ jutsuIds: z.array(z.string()) }).optional(),
  village: z
    .custom<
      | (Partial<
          Omit<NonNullable<NonNullable<UserWithRelations>["village"]>, "shrineSettings">
        > & {
          id: string;
          shrineSettings?: Partial<
            NonNullable<NonNullable<UserWithRelations>["village"]>["shrineSettings"]
          >;
        })
      | null
    >()
    .optional(),
  occupation: z.enum(OCCUPATIONS).optional(),
  occupationSignupAt: z.date().optional(),
  tutorialStep: z.number().optional(),
  reputationPoints: z.number().optional(),
  username: z.string().optional(),
  displayTitle: z.string().optional(),
  activeTitleId: z.string().nullable().optional(),
  gender: z.string().optional(),
  tavernUsernameColor: z.enum(TavernColorPresets).optional(),
  tavernTitleColor: z.enum(TavernColorPresets).optional(),
  primaryElement: z.enum(ElementNames).nullable().optional(),
  secondaryElement: z.enum(ElementNames).nullable().optional(),
  bloodright: z.array(z.object({ skillId: z.string(), cost: z.number() })).optional(),
  bloodrightSpent: z.number().optional(),
  monthlySkillResets: z.object({ month: z.string(), count: z.number() }).optional(),
  maxEnergy: z.number().optional(),
  effectiveMasteries: z
    .object({
      ninjutsuMastery: z.number(),
      genjutsuMastery: z.number(),
      taijutsuMastery: z.number(),
      bukijutsuMastery: z.number(),
      bloodlineMastery: z.number(),
      sageMastery: z.number(),
    })
    .optional(),
});

export const userDeltaResponseSchema = baseServerResponse.extend({
  userDelta: userDeltaSchema.optional(),
  userPatch: userPatchSchema.optional(),
  url: z.string().nullish(),
  imageId: z.string().nullish(),
  videoId: z.string().nullish(),
  teamId: z.string().optional(),
  achievementProgress: z.custom<AchievementProgress[]>(Array.isArray).optional(),
  rewards: PostProcessedRewardSchema.optional(),
  /** Feedback consumed by this response, independent of profile cache acceptance. */
  announcements: z.array(z.string()).optional(),
  notifications: z.array(z.string()).optional(),
  userQuest: z
    .object({
      questId: z.string(),
      quest: z.object({ name: z.string(), successDescription: z.string().nullable() }),
    })
    .nullable()
    .optional(),
  resolved: z.boolean().optional(),
  badges: z
    .array(z.object({ id: z.string(), name: z.string(), image: z.string() }))
    .optional(),
  rewardChoicePending: z.boolean().optional(),
});

export type UserDeltaResponse = z.infer<typeof userDeltaResponseSchema>;

export type UserCachePatch = z.infer<typeof userPatchSchema>;
