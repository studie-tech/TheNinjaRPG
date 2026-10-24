import { and, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  battle,
  huntingProgress,
  huntingReceipt,
  huntingSession,
  userItem,
} from "@/drizzle/schema";
import type { CombatResult, CompleteBattle } from "@/libs/combat/types";
import { huntingVictoryReceipt } from "@/libs/hunting/contracts";
import { getTerritoryWarBoost } from "@/libs/territoryWar";
import type { DrizzleClient } from "@/server/db";
import { retryOnDeadlock } from "@/server/utils/mysqlErrors";

/**
 * Claim and settle a personal encounter exactly once using only preloaded battle data.
 * Inventory inserts, allowance, receipt and character recovery span different rows, so
 * they must share a transaction: a single CAS cannot roll back a partial reward grant.
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
  const hunter = current.usersState.find((user) => user.userId === meta.userId);
  const boost = hunter
    ? getTerritoryWarBoost({
        ...hunter,
        village: hunter.villageId
          ? current.extraState.villages[hunter.villageId]
          : null,
        clan: hunter.clanId ? current.extraState.clans[hunter.clanId] : null,
      })
    : 0;
  const boostedMeta = {
    ...meta,
    contract: {
      ...meta.contract,
      experience: Math.floor(meta.contract.experience * (1 + boost)),
    },
  };
  const receipt = huntingVictoryReceipt(boostedMeta, current.id, result.outcome);
  const committed = await retryOnDeadlock(() =>
    client.transaction(async (tx) => {
      // Recovery mutates trackers/results; each deadlock retry must start from the same snapshot.
      const playerBattle = structuredClone(current);
      playerBattle.extraState.hunting = structuredClone(boostedMeta);
      const playerResult = structuredClone(result);
      const claim = await tx
        .delete(battle)
        .where(and(eq(battle.id, current.id), eq(battle.version, fetchedVersion)));
      if (claim.rowsAffected !== 1) return false;
      const session = await tx
        .update(huntingSession)
        .set({
          battleId: null,
          lastResult: receipt,
          version: sql`${huntingSession.version} + 1`,
        })
        .where(
          and(
            eq(huntingSession.userId, meta.userId),
            eq(huntingSession.id, meta.sessionId),
            eq(huntingSession.version, meta.sessionVersion + 1),
            eq(huntingSession.battleId, current.id),
          ),
        );
      if (session.rowsAffected !== 1)
        throw new Error("Hunting session changed during settlement");
      if (result.outcome === "Won") {
        const progress = await tx
          .update(huntingProgress)
          .set({
            used: meta.used + 1,
            cooldownUntil: receipt.cooldownUntil
              ? new Date(receipt.cooldownUntil)
              : null,
            version: sql`${huntingProgress.version} + 1`,
          })
          .where(
            and(
              eq(huntingProgress.userId, meta.userId),
              eq(huntingProgress.contractId, meta.contract.id),
              eq(huntingProgress.version, meta.progressVersion),
            ),
          );
        if (progress.rowsAffected !== 1)
          throw new Error("Hunting allowance changed during settlement");
        if (receipt.materials.length)
          await tx.insert(userItem).values(
            receipt.materials.flatMap((m) =>
              Array.from(
                {
                  length: Math.ceil(m.quantity / (meta.materialStacks[m.itemId] ?? 1)),
                },
                (_, index) => ({
                  id: nanoid(),
                  userId: meta.userId,
                  itemId: m.itemId,
                  quantity: Math.min(
                    meta.materialStacks[m.itemId] ?? 1,
                    m.quantity - index * (meta.materialStacks[m.itemId] ?? 1),
                  ),
                }),
              ),
            ),
          );
      }
      await tx.insert(huntingReceipt).values({
        battleId: current.id,
        userId: meta.userId,
        contractId: meta.contract.id,
        result: receipt,
        createdAt: new Date(),
      });
      await settlePlayer(tx as unknown as DrizzleClient, playerBattle, playerResult);
      return playerResult;
    }),
  );
  // Publish recovery changes only after every guarded write has committed.
  if (committed) Object.assign(result, committed, { hunting: receipt });
  return !!committed;
};
