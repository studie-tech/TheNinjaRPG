import { z } from "zod";
import { ENCOUNTER_MAX_WAVE_DELAY_ROUNDS } from "@/drizzle/constants";

/** Shared roster contract; activity progress and personal reward receipts live separately. */
export const coopRosterSchema = z.object({
  memberIds: z.array(z.string()),
  invitedIds: z.array(z.string()),
  readyIds: z.array(z.string()),
});
/** Enemy template occurrences and the minimum rounds elapsed since the previous wave began. */
/** How a boss form rises where the form before it fell; `tier` scales the cinematic. */
export const bossArrivalSchema = z.object({
  announce: z.string().min(1).max(32),
  log: z.string().min(1).max(200),
  tier: z.number().int().min(1).max(4),
  color: z.number().int().min(0).max(0xffffff),
  glow: z.number().int().min(0).max(0xffffff),
});
export const encounterWaveSchema = z.object({
  aiIds: z.array(z.string().min(1, "Choose an enemy for every wave.")).min(1),
  delayRounds: z.number().int().min(0).max(ENCOUNTER_MAX_WAVE_DELAY_ROUNDS).prefault(0),
  /** The wave is the previous enemy's next form, not a new enemy. */
  arrival: bossArrivalSchema.optional(),
});
/** Shared member, invitation and readiness IDs; activity adapters enforce their policy. */
export type CoopRoster = z.infer<typeof coopRosterSchema>;
/** Authored wave consumed by server initiation, preserving repeated enemy template IDs. */
export type EncounterWave = z.infer<typeof encounterWaveSchema>;
export type BossArrival = z.infer<typeof bossArrivalSchema>;
