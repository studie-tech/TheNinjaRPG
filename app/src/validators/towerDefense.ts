import { z } from "zod";
import { TD_DOJO } from "@/libs/towerDefense/content";

/** Longest run a claim may replay: about 14 hours of game time. */
export const TD_MAX_TICKS = 500_000;
/** Most actions a claim may carry: well above the busiest play over `TD_MAX_TICKS`. */
export const TD_MAX_ACTIONS = 300_000;
/**
 * Longest encoded log a claim may carry, keeping the request under the 4.5 MB body
 * limit of a serverless function. The client ends a run before its log outgrows it.
 */
export const TD_MAX_LOG_CHARS = 4_000_000;

/** What the server signs when a run starts; the claim replays exactly this. */
export const towerDefenseRunTokenSchema = z.object({
  v: z.literal(1),
  userId: z.string(),
  nonce: z.string(),
  seed: z.string(),
  startWave: z.int().min(1),
  bestWave: z.int().min(0),
  level: z.int().min(1),
  dojo: z.partialRecord(z.enum(TD_DOJO), z.int().min(0)),
  issuedAt: z.int(),
});
export type TowerDefenseRunToken = z.infer<typeof towerDefenseRunTokenSchema>;
