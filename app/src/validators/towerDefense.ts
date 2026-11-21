import { z } from "zod";
import {
  TD_CHALLENGE_MAX_STRENGTH,
  TD_CHALLENGE_MAX_WAVES,
  TD_CHALLENGE_MIN_STRENGTH,
} from "@/drizzle/constants";
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

/** Which quest objective a challenge run is started for. */
export const tdChallengeRequestSchema = z.object({
  questId: z.string().max(191),
  objectiveId: z.string().max(191),
});
export type TdChallengeRequest = z.infer<typeof tdChallengeRequestSchema>;

/** The challenge a quest objective sets, with the objective it completes. */
const tdQuestChallengeSchema = tdChallengeRequestSchema.extend({
  waves: z.int().min(1).max(TD_CHALLENGE_MAX_WAVES),
  enemyHealth: z.int().min(TD_CHALLENGE_MIN_STRENGTH).max(TD_CHALLENGE_MAX_STRENGTH),
  enemyDamage: z.int().min(TD_CHALLENGE_MIN_STRENGTH).max(TD_CHALLENGE_MAX_STRENGTH),
});
export type TdQuestChallenge = z.infer<typeof tdQuestChallengeSchema>;

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
  challenge: tdQuestChallengeSchema.optional(),
});
export type TowerDefenseRunToken = z.infer<typeof towerDefenseRunTokenSchema>;
