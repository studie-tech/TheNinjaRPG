import { z } from "zod";
import {
  TD_DOJO,
  TD_SEALS,
  TD_SENTRIES,
  TD_SHOP,
  TD_ULTIMATES,
} from "@/libs/towerDefense/content";
import { TD_TARGET_MODES, type TdAction } from "@/libs/towerDefense/sim";

/** Longest action log a claim may carry. */
export const TD_MAX_ACTIONS = 60_000;
/** Longest run a claim may replay: about 14 hours of game time. */
export const TD_MAX_TICKS = 500_000;

const tick = z.int().min(0).max(TD_MAX_TICKS);
const coordinate = z.int().min(-3000).max(3000);
const slot = z.int().min(0).max(5);

/** One recorded action; mirrors `TdAction` in `libs/towerDefense/sim`. */
export const towerDefenseActionSchema = z.union([
  z.tuple([tick, z.literal("buy"), z.enum(TD_SHOP)]),
  z.tuple([tick, z.literal("max"), z.enum(TD_SHOP)]),
  z.tuple([tick, z.literal("spend")]),
  z.tuple([tick, z.literal("build"), slot, z.enum(TD_SENTRIES)]),
  z.tuple([tick, z.literal("upgrade"), slot]),
  z.tuple([tick, z.literal("sell"), slot]),
  z.tuple([tick, z.literal("ult"), z.enum(TD_ULTIMATES), coordinate, coordinate]),
  z.tuple([tick, z.literal("perk"), z.int().min(0).max(9)]),
  z.tuple([tick, z.literal("reroll")]),
  z.tuple([tick, z.literal("aim"), z.enum(TD_TARGET_MODES)]),
  z.tuple([tick, z.literal("focus"), z.int().min(0)]),
  z.tuple([tick, z.literal("blink"), coordinate, coordinate]),
  z.tuple([tick, z.literal("sub")]),
  z.tuple([tick, z.literal("seal"), z.enum(TD_SEALS), coordinate, coordinate]),
  z.tuple([tick, z.literal("trap"), coordinate, coordinate]),
  z.tuple([tick, z.literal("loot"), z.int().min(0)]),
  z.tuple([tick, z.literal("call")]),
  z.tuple([tick, z.literal("auto"), z.union([z.literal(0), z.literal(1)])]),
  z.tuple([tick, z.literal("quit")]),
]) satisfies z.ZodType<TdAction>;

export const towerDefenseActionsSchema = z
  .array(towerDefenseActionSchema)
  .max(TD_MAX_ACTIONS)
  .refine(
    (actions) =>
      actions.every(
        (action, index) => index === 0 || action[0] >= (actions[index - 1]?.[0] ?? 0),
      ),
    "Actions must be in tick order",
  );

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
