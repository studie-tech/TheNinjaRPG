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
  habitatId: z.string().min(1),
  rodUserItemId: z.string().min(1),
  baitUserItemId: z.string().min(1),
  tackleUserItemId: z.string().min(1).nullable(),
  aimX: z.number().min(0).max(1),
  aimY: z.number().min(0).max(1),
  charge: z.number().min(0.1).max(1),
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
export const fishingSimulationInputSchema = z.object({
  sequence: z.number().int().positive(),
  durationMs: z.number().int().min(50).max(200),
  rodX: z.number().min(-1).max(1),
  rodY: z.number().min(-1).max(1),
  reel: z.boolean(),
  hook: z.boolean(),
});
export const fishingSyncInputSchema = z.object({
  sessionId: z.string().min(1),
  version: z.number().int().positive(),
  inputs: z.array(fishingSimulationInputSchema).min(1).max(8),
});
export const fishingCancelInputSchema = z.object({
  sessionId: z.string().min(1),
  version: z.number().int().positive(),
});
export const fishingPendingCatchClaimInputSchema = z.object({
  sessionId: z.string().min(1),
});
export const fishingSimulationStateSchema = z.object({
  engineVersion: z.number().int(),
  behavior: z.enum(["DARTING", "HEAVY", "CAUTIOUS", "ERRATIC"]),
  modifiers: z.object({
    attractionBonus: z.number(),
    controlBonus: z.number(),
    socialBonus: z.number(),
  }),
  seed: z.number().int(),
  tick: z.number().int().nonnegative(),
  elapsedMs: z.number().int().nonnegative(),
  phase: z.enum(["ATTRACT", "BITE", "FIGHT", "LANDED", "FAILED"]),
  lastInputSequence: z.number().int().nonnegative(),
  player: z.object({ x: z.number(), y: z.number() }),
  lure: z.object({
    x: z.number(),
    y: z.number(),
    velocityX: z.number(),
    velocityY: z.number(),
  }),
  fish: z.object({
    x: z.number(),
    y: z.number(),
    velocityX: z.number(),
    velocityY: z.number(),
    stamina: z.number(),
    interest: z.number(),
    biteMs: z.number(),
    slackMs: z.number(),
  }),
  line: z.object({ length: z.number(), tension: z.number() }),
  school: z.object({ x: z.number(), y: z.number(), proximity: z.number() }).nullable(),
  landingProgress: z.number(),
});
export const fishingSessionSchema = z.object({
  id: z.string(),
  speciesId: z.string().nullable(),
  state: z.enum(["ATTRACT", "HOOK", "FIGHT", "LANDED", "FAILED", "RESOLVED"]),
  version: z.number().int(),
  tension: z.number().int(),
  landingProgress: z.number().int(),
  expiresAt: z.date(),
  simulation: fishingSimulationStateSchema.nullable(),
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
  habitats: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      speciesIds: z.array(z.string()),
    }),
  ),
  participantCount: z.number().int().positive(),
  socialBonusPercent: z.number().int().min(0).max(15),
  recentMarks: z.array(
    z.object({ habitatId: z.string(), markedAt: z.date(), expiresAt: z.date() }),
  ),
  schools: z.array(
    z.object({
      habitatId: z.string(),
      x: z.number().int(),
      y: z.number().int(),
      movesAt: z.date(),
      matchesTrackedSpecies: z.boolean(),
    }),
  ),
});
