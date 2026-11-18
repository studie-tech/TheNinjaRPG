import { z } from "zod";
import { BattleTypes, MAX_PLAYER_LEVEL, UserRanks } from "@/drizzle/constants";

/** Shared battle sample accepted by balance reports and overview navigation. */
export const balanceUsageFilterSchema = z.object({
  battleTypes: z.array(z.enum(BattleTypes)).optional(),
  userRanks: z.array(z.enum(UserRanks)).optional(),
  minLevel: z.number().min(1).max(MAX_PLAYER_LEVEL).optional(),
  maxLevel: z.number().min(1).max(MAX_PLAYER_LEVEL).optional(),
});
