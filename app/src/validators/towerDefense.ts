import { z } from "zod";
import { decodeTdActions } from "@/libs/towerDefense/actionLog";
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

const tick = z.int().min(0).max(TD_MAX_TICKS);

/**
 * An action log in the compact encoding of `libs/towerDefense/actionLog`, decoded and
 * validated in one pass: a long log has hundreds of thousands of actions.
 */
export const towerDefenseActionsSchema = z
  .string()
  .max(TD_MAX_LOG_CHARS)
  .transform((text, context) => {
    const actions = decodeTdActions(text, {
      maxTick: TD_MAX_TICKS,
      maxActions: TD_MAX_ACTIONS,
    });
    if (actions) return actions;
    context.addIssue({ code: "custom", message: "The action log is malformed" });
    return z.NEVER;
  });

/** Dojo levels as signed into a run. */
export const towerDefenseDojoSchema = z.partialRecord(z.enum(TD_DOJO), z.int().min(0));

/** What the server signs when a run starts; the claim replays exactly this. */
export const towerDefenseRunTokenSchema = z.object({
  v: z.literal(1),
  userId: z.string(),
  nonce: z.string(),
  seed: z.string(),
  startWave: z.int().min(1),
  bestWave: z.int().min(0),
  dojo: towerDefenseDojoSchema,
  issuedAt: z.int(),
});
export type TowerDefenseRunToken = z.infer<typeof towerDefenseRunTokenSchema>;

export const claimTowerDefenseRunSchema = z.object({
  token: z.string().min(1).max(8000),
  actions: towerDefenseActionsSchema,
  endTick: tick,
});
