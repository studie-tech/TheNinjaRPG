import { eq } from "drizzle-orm";
import { battle } from "@/drizzle/schema";
import type { CompleteBattle } from "@/libs/combat/types";
import type { DrizzleClient } from "@/server/db";
import { unpackBattleExtraState } from "@/server/utils/battleStorage";

/**
 * Read a stored battle (the only one when `battleId` is omitted) with its compressed
 * catalogs folded back into extraState, as `fetchBattle` loads it for combat.
 */
export const storedBattle = async (
  database: Pick<DrizzleClient, "query">,
  battleId?: string,
): Promise<CompleteBattle | undefined> => {
  const row = await database.query.battle.findFirst(
    battleId ? { where: eq(battle.id, battleId) } : undefined,
  );
  if (!row) return undefined;
  const { catalogs, ...rest } = row;
  return {
    ...rest,
    extraState: unpackBattleExtraState(rest.extraState, catalogs),
  } as CompleteBattle;
};
