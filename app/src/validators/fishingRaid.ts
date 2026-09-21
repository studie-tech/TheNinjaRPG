import { z } from "zod";

export const fishingRaidRoleSchema = z.enum(["PULLER", "ANCHOR", "GUIDE"]);
export const fishingRaidActionSchema = z.enum(["REEL", "HOLD", "TURN", "SLACK"]);

export const fishingRaidTemplateInputSchema = z
  .object({
    id: z.string().min(1).optional(),
    name: z.string().min(1).max(191),
    speciesId: z.string().min(1).max(64),
    habitatId: z.string().min(1),
    minimumLevel: z.number().int().min(1).max(100),
    minimumParticipants: z.number().int().min(2).max(16),
    maximumParticipants: z.number().int().min(2).max(16),
    entryBait: z.number().int().min(1).max(20),
    encounterSeconds: z.number().int().min(60).max(900),
    rewardExperience: z.number().int().min(0).max(100000),
    maxRewardsPerOccurrence: z.number().int().min(1).max(1),
    active: z.boolean().default(true),
    config: z.record(z.string(), z.unknown()).default({}),
  })
  .refine((value) => value.maximumParticipants >= value.minimumParticipants, {
    message: "The group cap must meet the minimum participants.",
  });

export const fishingRaidScheduleInputSchema = z.object({
  id: z.string().min(1).optional(),
  templateId: z.string().min(1),
  startsAt: z.date(),
  recurrenceMinutes: z.number().int().min(15).max(525600).nullable().optional(),
  spawnWindowSeconds: z.number().int().min(60).max(7200),
  announcementLeadSeconds: z.number().int().min(0).max(86400),
  active: z.boolean().default(true),
});
export const fishingRaidLobbyInputSchema = z.object({
  occurrenceId: z.string().min(1),
});
export const fishingRaidJoinInputSchema = fishingRaidLobbyInputSchema.extend({
  rodUserItemId: z.string().min(1),
  baitUserItemId: z.string().min(1),
  tackleUserItemId: z.string().min(1).nullable(),
});
export const fishingRaidReadyInputSchema = z.object({
  lobbyId: z.string().min(1),
  ready: z.boolean(),
  role: fishingRaidRoleSchema,
});
export const fishingRaidStartInputSchema = z.object({
  lobbyId: z.string().min(1),
  version: z.number().int().positive(),
});
export const fishingRaidActionInputSchema = z.object({
  lobbyId: z.string().min(1),
  version: z.number().int().positive(),
  action: fishingRaidActionSchema,
});
export const fishingRaidReconnectInputSchema = z.object({ lobbyId: z.string().min(1) });
export const fishingRaidLeaveInputSchema = z.object({ lobbyId: z.string().min(1) });
export const fishingRaidIdInputSchema = z.object({ id: z.string().min(1) });
