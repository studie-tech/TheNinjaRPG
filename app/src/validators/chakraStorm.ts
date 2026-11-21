import { z } from "zod";
import {
  CS_RUN_SECONDS,
  CS_STAGES,
  CS_TPS,
  CS_TRAINING,
} from "@/libs/chakraStorm/content";

/** Longest run a claim may replay: the full scouting run, which ends itself there. */
export const CS_MAX_TICKS = CS_RUN_SECONDS * CS_TPS;
/** Most actions a claim may carry: a walking change on every tick, with room for drafts. */
export const CS_MAX_ACTIONS = CS_MAX_TICKS + 2_000;
/** Longest encoded log a claim may carry, well under a serverless request body. */
export const CS_MAX_LOG_CHARS = 400_000;

/** What the server signs when a run starts; the claim replays exactly this. */
export const chakraStormRunTokenSchema = z.object({
  game: z.literal("chakraStorm"),
  v: z.literal(1),
  userId: z.string(),
  nonce: z.string(),
  seed: z.string(),
  stage: z.enum(CS_STAGES),
  training: z.partialRecord(z.enum(CS_TRAINING), z.int().min(0)),
  issuedAt: z.int(),
});
export type ChakraStormRunToken = z.infer<typeof chakraStormRunTokenSchema>;
