/**
 * Restores the pre-Diamond bloodline of players whose Diamond Federal Support has ended.
 */

import { and, type SQL } from "drizzle-orm";
import { resolveDiamondBloodlineRevert } from "@/libs/bloodline";
import {
  clearDiamondBloodlineSet,
  currentBloodlineNotOwnedGuard,
  insertActionLogForDiamondBloodlineRevert,
  lapsedDiamondGuard,
  listBloodlineForDiamondBloodlineRevert,
  listBloodlineRollsForDiamondBloodlineRevert,
  listJutsuForDiamondBloodlineRevert,
  listUserDataForDiamondBloodlineRevert,
  updateUserDataForClearDiamondBloodline,
  updateUserDataForUpdateBloodline,
  updateUserJutsuForUpdateBloodline,
} from "@/queries/bloodline";
import type { DrizzleClient } from "@/server/db";

/** Players handled per run; the rest follow on the next cleaner run. */
const REVERT_BATCH_SIZE = 200;

/**
 * Revert every player who still holds a remembered pre-Diamond bloodline but is no longer
 * DIAMOND: a Diamond pick goes back to the remembered bloodline (or none), while a bloodline
 * they own stays. Either way the remembered bloodline is forgotten. Each write is guarded on
 * the lapsed state and the current bloodline, so a renewed subscription or a concurrent
 * change wins; a player in battle is retried on a later run.
 *
 * The subscription and cleaner crons call this right after their federal status writers;
 * a tier that ends through a PayPal, Stripe or store webhook is reverted on the next
 * cleaner run.
 */
export const revertLapsedDiamondBloodlines = async (
  client: DrizzleClient,
  userId?: string,
) => {
  const users = await listUserDataForDiamondBloodlineRevert(
    client,
    REVERT_BATCH_SIZE,
    userId,
  );
  if (users.length === 0) return { reverted: 0, cleared: 0 };
  const preIds = [
    ...new Set(users.flatMap((user) => user.preDiamondBloodlineId ?? [])),
  ];
  const currentIds = [...new Set(users.flatMap((user) => user.bloodlineId ?? []))];
  const [rolls, preLines, jutsus] = await Promise.all([
    listBloodlineRollsForDiamondBloodlineRevert(
      client,
      users.map((user) => user.userId),
    ),
    preIds.length ? listBloodlineForDiamondBloodlineRevert(client, preIds) : [],
    currentIds.length ? listJutsuForDiamondBloodlineRevert(client, currentIds) : [],
  ]);
  let reverted = 0;
  const clearIds: string[] = [];
  for (const user of users) {
    const ownedBloodlineIds = rolls
      .filter((roll) => roll.userId === user.userId)
      .flatMap((roll) => roll.bloodlineId ?? []);
    const preLine = preLines.find((line) => line.id === user.preDiamondBloodlineId);
    const revert = resolveDiamondBloodlineRevert({
      currentBloodlineId: user.bloodlineId,
      preDiamondBloodlineId: user.preDiamondBloodlineId,
      preDiamondBloodlineExists: !!preLine,
      ownedBloodlineIds,
    });
    if (!revert) {
      clearIds.push(user.userId);
      continue;
    }
    const restoreId = revert.restoreBloodlineId;
    const currentJutsus = jutsus.filter(
      (jutsu) => jutsu.bloodlineId === user.bloodlineId,
    );
    // Queued levels of the Diamond bloodline's jutsu are refunded when their turn comes.
    const result = await updateUserDataForUpdateBloodline(
      client,
      { id: restoreId ?? undefined },
      0,
      user,
      new Date(),
      {
        set: clearDiamondBloodlineSet,
        where: and(lapsedDiamondGuard(), currentBloodlineNotOwnedGuard()) as SQL,
      },
    );
    if (!result.rowsAffected) continue;
    reverted += 1;
    const from = user.bloodlineName ?? "unknown bloodline";
    const to = preLine?.name ?? "no bloodline";
    await Promise.all([
      currentJutsus.length
        ? updateUserJutsuForUpdateBloodline(
            client,
            user,
            currentJutsus.map((jutsu) => jutsu.id),
          )
        : undefined,
      insertActionLogForDiamondBloodlineRevert(
        client,
        user,
        `Diamond Federal Support ended: bloodline reverted from ${from} to ${to}`,
        restoreId,
      ),
    ]);
  }
  // One guarded statement forgets the remembered bloodline of every player keeping theirs.
  const cleared = clearIds.length
    ? (await updateUserDataForClearDiamondBloodline(client, clearIds)).rowsAffected
    : 0;
  return { reverted, cleared };
};
