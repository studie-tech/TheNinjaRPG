import type { CombatResult, CompleteBattle } from "@/libs/combat/types";
import { huntingVictoryReceipt } from "@/libs/hunting/contracts";
import { splitIntoStacks } from "@/libs/item";
import { getTerritoryWarBoost } from "@/libs/territoryWar";
import { deleteBattleIfVersionMatches } from "@/queries/combat";
import {
  insertHuntingReceiptForSettleHuntingBattle,
  updateHuntingProgressForSettleHuntingBattle,
  updateHuntingSessionForSettleHuntingBattle,
} from "@/queries/hunting";
import type { DrizzleClient } from "@/server/db";
import { grantUserItems } from "@/server/utils/itemGrants";
import { retryOnDeadlock } from "@/server/utils/mysqlErrors";

/**
 * Claim and settle a personal encounter exactly once using only preloaded battle data.
 * MySQL cannot DELETE Battle, grant materials, INSERT the receipt and UPDATE allowance
 * and character recovery in one statement; the transaction prevents partial grants.
 * The callback must run guarded player recovery on the supplied transaction client.
 */
export const settleHuntingBattle = async (
  client: DrizzleClient,
  current: CompleteBattle,
  result: CombatResult,
  fetchedVersion: number,
  settlePlayer: (
    tx: DrizzleClient,
    current: CompleteBattle,
    result: CombatResult,
  ) => Promise<unknown>,
) => {
  const meta = current.extraState.hunting;
  if (!meta) return false;
  // Reuse initiation's history and political metadata; combat settlement cannot fetch again.
  const hunter = current.usersState.find((user) => user.userId === meta.userId);
  const clan = hunter?.clanId ? current.extraState.clans[hunter.clanId] : null;
  const territoryBoost = hunter
    ? getTerritoryWarBoost({
        ...hunter,
        village: hunter.villageId
          ? current.extraState.villages[hunter.villageId]
          : null,
        clan,
      })
    : 0;
  // Stack additively like quest rewards; outlaw factions have no clan hunter boost.
  const clanBoost = hunter && !hunter.isOutlaw ? (clan?.hunterExpBoost ?? 0) / 100 : 0;
  const boost = clanBoost + territoryBoost;
  const boostedMeta = {
    ...meta,
    contract: {
      ...meta.contract,
      // Epsilon keeps exact products such as 50 * 1.16 from flooring to 57.
      experience: Math.floor(meta.contract.experience * (1 + boost) + 1e-9),
    },
  };
  const receipt = huntingVictoryReceipt(boostedMeta, current.id, result.outcome);
  const committed = await retryOnDeadlock(() =>
    client.transaction(async (tx) => {
      // Recovery mutates trackers/results; each deadlock retry must start from the same snapshot.
      const playerBattle = structuredClone(current);
      playerBattle.extraState.hunting = structuredClone(boostedMeta);
      const playerResult = structuredClone(result);
      const claim = await deleteBattleIfVersionMatches(tx, current, fetchedVersion);
      if (claim.rowsAffected !== 1) return false;
      const session = await updateHuntingSessionForSettleHuntingBattle(
        tx,
        receipt,
        meta,
        current,
      );
      if (session.rowsAffected !== 1)
        throw new Error("Hunting session changed during settlement");
      if (result.outcome === "Won") {
        const progress = await updateHuntingProgressForSettleHuntingBattle(
          tx,
          meta,
          receipt,
        );
        if (progress.rowsAffected !== 1)
          throw new Error("Hunting allowance changed during settlement");
      }
      await insertHuntingReceiptForSettleHuntingBattle(tx, current, meta, receipt);
      await settlePlayer(tx, playerBattle, playerResult);
      // Granted items join stacks only outside a battle, so the materials follow the player's
      // settlement above. The stacks were read at start because combat settlement cannot fetch.
      if (result.outcome === "Won" && receipt.materials.length)
        await grantUserItems(
          tx,
          meta.userId,
          receipt.materials.flatMap((material) =>
            splitIntoStacks(
              material.quantity,
              meta.materialStacks[material.itemId] ?? 1,
            ).map((quantity) => ({ itemId: material.itemId, quantity })),
          ),
          { preloaded: meta.grantStacks ?? [] },
        );
      return playerResult;
    }),
  );
  // Publish recovery changes only after every guarded write has committed.
  if (committed) Object.assign(result, committed, { hunting: receipt });
  return !!committed;
};
