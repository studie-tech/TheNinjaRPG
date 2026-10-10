import { z } from "zod";
import { ElementNames, OCCUPATIONS, TavernColorPresets } from "@/drizzle/constants";
import type { UserItemWithRelations } from "@/drizzle/schema";
import { baseServerResponse } from "@/validators/base";
import { boostTemplateEntrySchema } from "@/validators/shrine";

export const userDeltaSchema = z.object({
  money: z.number().optional(),
  earnedExperience: z.number().optional(),
  reputationPoints: z.number().optional(),
  seichiSilver: z.number().optional(),
  extraItemSlots: z.number().optional(),
  extraJutsuSlots: z.number().optional(),
  bloodrightSpent: z.number().optional(),
});

export type UserDelta = z.infer<typeof userDeltaSchema>;

// Absolute values are kept separate from arithmetic deltas so a saved field is never added.
export const userPatchSchema = z.object({
  money: z.number().optional(),
  bank: z.number().optional(),
  seichiSilver: z.number().optional(),
  curEnergy: z.number().optional(),
  curHealth: z.number().optional(),
  curChakra: z.number().optional(),
  curStamina: z.number().optional(),
  regenAt: z.date().optional(),
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
  clan: z
    .object({
      id: z.string(),
      bank: z.number().optional(),
      repTreasury: z.number().optional(),
    })
    .optional(),
  avatar: z.string().nullable().optional(),
  avatarLight: z.string().nullable().optional(),
  jutsuLoadout: z.string().optional(),
  loadout: z.object({ jutsuIds: z.array(z.string()) }).optional(),
  village: z
    .object({
      id: z.string(),
      tokens: z.number().optional(),
      hexColor: z.string().optional(),
      openForChallenges: z.boolean().optional(),
      openForChallengesAt: z.date().optional(),
      shrineSettings: z
        .object({
          unlockedAiIds: z.array(z.string()).optional(),
          activeBoosts: z.record(z.string(), z.string()).optional(),
          activeAiIds: z.array(z.string()).optional(),
          boostTemplate: z.array(boostTemplateEntrySchema).optional(),
          boostTemplateUpdatedBy: z.string().optional(),
          boostTemplateUpdatedAt: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
  occupation: z.enum(OCCUPATIONS).optional(),
  occupationSignupAt: z.date().optional(),
  tutorialStep: z.number().optional(),
  reputationPoints: z.number().optional(),
  username: z.string().optional(),
  customTitle: z.string().optional(),
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
});

export type UserDeltaResponse = z.infer<typeof userDeltaResponseSchema>;

export type UserCachePatch = z.infer<typeof userPatchSchema>;
