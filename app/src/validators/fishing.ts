import { z } from "zod";

export const fishingHabitatInputSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1).max(191),
  sector: z.number().int().min(1),
  tileX: z.number().int().nonnegative(),
  tileY: z.number().int().nonnegative(),
  radius: z.number().int().min(0).max(8).default(1),
  speciesIds: z.array(z.string()).min(1).max(16),
  active: z.boolean().default(true),
});
export const fishingHabitatSectorInputSchema = z.object({
  sector: z.number().int().min(1),
});
export const fishingHabitatDeleteInputSchema = z.object({
  id: z.string().min(1),
});
export const fishingMarkSchoolInputSchema = z.object({ habitatId: z.string().min(1) });

export const fishingActionSchema = z.enum(["LURE", "HOOK", "REEL", "SLACK", "STEER"]);
export const fishingCastInputSchema = z.object({
  sector: z.number().int().min(1),
  rodUserItemId: z.string().min(1),
  baitUserItemId: z.string().min(1),
  tackleUserItemId: z.string().min(1).nullable(),
});
export const fishingTrackInputSchema = z.object({ speciesId: z.string().nullable() });
export const fishingActInputSchema = z.object({
  sessionId: z.string(),
  version: z.number().int().positive(),
  action: fishingActionSchema,
});
export const fishingResolveInputSchema = z.object({
  sessionId: z.string(),
  version: z.number().int().positive(),
  keep: z.boolean(),
});
export const fishingPendingCatchClaimInputSchema = z.object({
  sessionId: z.string().min(1),
});
export const fishingSessionSchema = z.object({
  id: z.string(),
  speciesId: z.string(),
  state: z.enum(["ATTRACT", "HOOK", "FIGHT", "LANDED", "FAILED", "RESOLVED"]),
  version: z.number().int(),
  tension: z.number().int(),
  landingProgress: z.number().int(),
  expiresAt: z.date(),
});
export const fishingStateSchema = z.object({
  fishingExperience: z.number().int(),
  fishingLevel: z.number().int(),
  expForCurrentLevel: z.number().int(),
  expForNextLevel: z.number().int().nullable(),
  equipment: z.array(
    z.object({
      userItemId: z.string(),
      itemId: z.string(),
      name: z.string(),
      kind: z.enum(["ROD", "BAIT", "TACKLE"]),
      quantity: z.number().int().positive(),
      attractionBonus: z.number().int(),
      controlBonus: z.number().int(),
      experienceBonus: z.number().int(),
    }),
  ),
  trackedSpeciesId: z.string().nullable(),
  tutorialClaimed: z.boolean(),
  starterRecoveryClaimed: z.boolean(),
  collection: z.array(
    z.object({
      speciesId: z.string(),
      caughtCount: z.number().int(),
      firstCaughtAt: z.date(),
      largestSize: z.number().int(),
      bestQuality: z.number().int(),
    }),
  ),
  pendingCatches: z.array(
    z.object({ sessionId: z.string(), speciesId: z.string(), itemId: z.string() }),
  ),
  activeSession: fishingSessionSchema.nullable(),
  participantCount: z.number().int().positive(),
  socialBonusPercent: z.number().int().min(0).max(15),
  recentMarks: z.array(z.object({ habitatId: z.string(), markedAt: z.date() })),
  schools: z.array(
    z.object({
      habitatId: z.string(),
      x: z.number().int(),
      y: z.number().int(),
      movesAt: z.date(),
    }),
  ),
});
