import * as Sentry from "@sentry/nextjs";
import { getInventoryQuantityChanges } from "@/deltas/item";
import type {
  Item,
  UserData,
  UserItem,
  UserRaidBuff,
  UserTitle,
} from "@/drizzle/schema";
import { getTimedRegeneration } from "@/libs/timedBuffs";
import { regenerationBuffs } from "@/libs/titles";
import {
  deleteEmptyUserItem,
  deleteUserCookingJobForSettleCookingExperience,
  executeConsumedForConsumeMeal,
  executeRowsForSettleCookingExperience,
  insertUserRaidBuffForConsumeMeal,
} from "@/queries/item";
import { errorResponse } from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
import type { ActionReadinessWrite } from "@/server/utils/actionReadiness";
import { retryOnDeadlock } from "@/server/utils/mysqlErrors";
import { getNextUserSnapshotAt } from "@/utils/time";

/**
 * Atomically exchanges each due receipt's XP for an account increment, independently of
 * output stacks. Zero XP marks a delivered receipt until best-effort cleanup removes it.
 * Returns true for every due snapshot, including lost claims and partial failures, so
 * callers reload account XP instead of returning a snapshot from before another claim.
 */
export const settleCookingExperience = async (
  client: DrizzleClient,
  userId: string,
  jobs: readonly { id: string; experience: number; finishesAt: Date }[],
  now = new Date(),
) => {
  const due = jobs.filter((job) => job.finishesAt <= now);
  if (!due.length) return false;
  for (const job of due) {
    if (job.experience <= 0) continue;
    try {
      // Drizzle cannot express this joined UPDATE. Claim one receipt per statement:
      // MySQL updates a joined account row only once even if several receipts match.
      // Use the guarded literal XP because multi-table assignment order is unspecified;
      // reading receipt.experience while also zeroing it could otherwise award zero.
      await retryOnDeadlock(() =>
        executeRowsForSettleCookingExperience(client, job, userId, now),
      );
    } catch (error) {
      // Other receipts may already have committed. Keep this one retryable and finish
      // reconciliation rather than hiding successful grants behind a stale profile.
      Sentry.captureException(error, {
        level: "warning",
        tags: { source: "settleCookingExperience" },
      });
    }
  }
  try {
    await retryOnDeadlock(() =>
      deleteUserCookingJobForSettleCookingExperience(client, userId, now),
    );
  } catch (error) {
    // A zero marker cannot grant XP again; cleanup failure must not undo reconciliation.
    Sentry.captureException(error, {
      level: "warning",
      tags: { source: "settleCookingExperience" },
    });
  }
  return true;
};

/**
 * One joined update claims the account snapshot, debits the exact carried stack and
 * replaces its single meal buff together. Only expired empty placeholders and harmless
 * zero-quantity stacks can remain if preparatory or cleanup work loses a race.
 */
export const consumeMeal = async ({
  client,
  user,
  owned,
  expectedQuantity,
  readiness,
}: {
  client: DrizzleClient;
  user: UserData & {
    raidBuffs?: UserRaidBuff[];
    titles?: UserTitle[];
    regenerationWithoutTimedBuffs?: number;
  };
  owned: UserItem & { item: Item };
  expectedQuantity?: number;
  readiness?: ActionReadinessWrite;
}) => {
  const now = new Date();
  if (user.status !== "AWAKE" || user.battleId)
    return errorResponse("Meals can only be eaten while awake and out of combat");
  if (
    owned.storedAtHome ||
    owned.isInAuction ||
    owned.equipped !== "NONE" ||
    (owned.craftingFinishedAt && owned.craftingFinishedAt > now)
  ) {
    return errorResponse("Carry a finished meal in your inventory before eating it");
  }
  if (expectedQuantity === undefined || expectedQuantity !== owned.quantity)
    return errorResponse(
      "Your meal stack changed. Refresh your inventory and try again",
    );
  if (owned.item.effects.length !== 1 || owned.item.mealDurationSeconds < 1) {
    return errorResponse("This meal has an invalid effect or duration");
  }
  const id = `meal-${user.userId}`;
  const previous = user.raidBuffs?.find(
    (buff) => buff.id === id && buff.expiresAt > now,
  );
  const extendsMeal = previous?.itemId === owned.itemId;
  const expiresAt = new Date(
    (extendsMeal ? previous.expiresAt.getTime() : now.getTime()) +
      owned.item.mealDurationSeconds * 1000,
  );
  // A rejected same-account race may leave this expired, effect-free row. That
  // reversible residue costs no item or active effect; an existing buff is untouched.
  await retryOnDeadlock(() => insertUserRaidBuffForConsumeMeal(client, id, user, now));
  // Drizzle cannot express this joined UPDATE. Every guard is checked in the same
  // statement as both value changes, so a lost account/item race changes neither.
  const consumed = await retryOnDeadlock(() =>
    executeConsumedForConsumeMeal(
      client,
      user,
      now,
      expectedQuantity,
      owned,
      expiresAt,
      extendsMeal ? previous.createdAt : now,
      id,
      readiness,
    ),
  );
  if (consumed.rowsAffected === 0)
    return errorResponse("Your state or meal stack changed. Please try again");
  if (expectedQuantity === 1) {
    try {
      await retryOnDeadlock(() => deleteEmptyUserItem(client, owned.id, user.userId));
    } catch (error) {
      // Consumption already committed. Inventory reads hide zero stacks and reclaim
      // stale tombstones; report success so the player does not retry the same meal.
      Sentry.captureException(error, {
        level: "warning",
        tags: { source: "consumeMeal" },
      });
    }
  }
  const raidBuffs = [
    ...(user.raidBuffs ?? []).filter((buff) => buff.id !== id),
    {
      id,
      userId: user.userId,
      itemId: owned.itemId,
      questId: null,
      effects: owned.item.effects,
      expiresAt,
      createdAt: extendsMeal ? previous.createdAt : now,
    },
  ];
  return {
    success: true,
    message: `Ate ${owned.item.name}. ${extendsMeal ? "Extended" : "Applied"} its meal effect.`,
    inventoryChanges: getInventoryQuantityChanges(
      [owned],
      [{ id: owned.id, quantity: expectedQuantity - 1 }],
      now,
    ),
    bloodlineRollsChanged: false,
    raidBuffsChanged: true,
    userPatch: {
      updatedAt: getNextUserSnapshotAt(user.updatedAt, now),
      raidBuffs,
      regeneration: getTimedRegeneration(
        user.regenerationWithoutTimedBuffs ?? user.regeneration,
        regenerationBuffs({ ...user, raidBuffs }),
        now,
      ),
    },
  };
};
