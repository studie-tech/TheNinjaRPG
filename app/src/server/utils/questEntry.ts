import { and, eq, exists, isNull, sql } from "drizzle-orm";
import type { UserRole } from "@/drizzle/constants";
import {
  questHistory,
  type UserItem,
  type UserQuest,
  userItem,
} from "@/drizzle/schema";
import { getQuestEntryRequirements } from "@/libs/questRun";
import {
  selectQuestForQuestAttemptWhere,
  selectQuestHistoryForQuestAttemptIsActive,
  updateQuestHistoryForCommitQuestEntryBattle,
  updateQuestHistoryForPayQuestEntryAtStart,
} from "@/queries/quests";
import type { DrizzleClient } from "@/server/db";
import { updateUserItemQuantityAtomically } from "@/server/utils/concurrency";
import { retryOnDeadlock } from "@/server/utils/mysqlErrors";
import type { QuestContentType } from "@/validators/objectives";

/** Match the same open attempt and its playable content inside a guarded write. */
const questAttemptWhere = (client: DrizzleClient, attempt: UserQuest, role: UserRole) =>
  and(
    eq(questHistory.id, attempt.id),
    eq(questHistory.userId, attempt.userId),
    eq(questHistory.questId, attempt.questId),
    eq(questHistory.isolated, attempt.isolated ?? false),
    attempt.startedAt ? eq(questHistory.startedAt, attempt.startedAt) : sql`FALSE`,
    isNull(questHistory.endAt),
    eq(questHistory.completed, 0),
    exists(selectQuestForQuestAttemptWhere(client, attempt, role)),
  );

/** Embed attempt/version/visibility validation in the battle participant claim without a fetch. */
export const questAttemptIsActive = (
  client: DrizzleClient,
  attempt: UserQuest,
  role: UserRole,
) =>
  exists(
    selectQuestHistoryForQuestAttemptIsActive(
      client,
      questAttemptWhere(client, attempt, role),
    ),
  );

/**
 * Debit planned entry charges and write the receipt for a freshly started attempt.
 * Runs inside the caller's start transaction, awaiting writes in order on its session.
 * Returns false when the receipt or any stack changed, so the caller rolls everything back.
 * The receipt makes the first-battle charge a no-op, so entry is only ever paid once.
 */
export const payQuestEntryAtStart = async ({
  client,
  userId,
  questId,
  charges,
}: {
  client: DrizzleClient;
  userId: string;
  questId: string;
  charges: NonNullable<ReturnType<typeof getQuestEntryCharges>>;
}) => {
  const receipt = await updateQuestHistoryForPayQuestEntryAtStart(
    client,
    userId,
    questId,
  );
  if (receipt.rowsAffected !== 1) return false;
  for (const charge of charges) {
    const debited = await updateUserItemQuantityAtomically({
      client,
      userId,
      userItemId: charge.id,
      expectedQuantity: charge.expectedQuantity,
      nextQuantity: charge.expectedQuantity - charge.quantity,
      where: [
        eq(userItem.itemId, charge.itemId),
        eq(userItem.storedAtHome, false),
        eq(userItem.isInAuction, false),
      ],
    });
    if (!debited) return false;
  }
  return true;
};

/**
 * Allocate required quantities deterministically across available inventory stacks.
 * Returns null for insufficient inventory, or no charges when the attempt is already paid.
 * Expected item identities and quantities become CAS guards so evolved stacks cannot pay
 * for their former item; each debit is positive and bounded by its stack.
 */
export const getQuestEntryCharges = (
  attempt: Pick<UserQuest, "entryPaid"> & {
    quest: { content: Pick<QuestContentType, "entryItems"> };
  },
  items: readonly Pick<
    UserItem,
    "id" | "itemId" | "quantity" | "storedAtHome" | "isInAuction"
  >[],
) => {
  const charges: {
    id: string;
    itemId: string;
    quantity: number;
    expectedQuantity: number;
  }[] = [];
  if (!attempt.entryPaid) {
    for (const required of getQuestEntryRequirements(attempt.quest.content)) {
      let remaining = required.quantity;
      for (const item of items
        .filter(
          (row) =>
            row.itemId === required.itemId &&
            !row.storedAtHome &&
            !row.isInAuction &&
            row.quantity > 0,
        )
        .sort((a, b) => a.id.localeCompare(b.id))) {
        const quantity = Math.min(item.quantity, remaining);
        if (quantity > 0)
          charges.push({
            id: item.id,
            itemId: item.itemId,
            quantity,
            expectedQuantity: item.quantity,
          });
        remaining -= quantity;
      }
      if (remaining > 0) return null;
    }
  }
  return charges;
};

/**
 * Commit the receipt, all item debits and battle claim together, or roll them all back.
 * A guarded update cannot cover the receipt, separate inventory stacks and battle inserts.
 * Battle initiation calls this only for actual ticket debits; later and no-ticket floors
 * use the ordinary participant claim and compensation path without a transaction.
 * The callback must await writes sequentially on the transaction's PlanetScale session;
 * didClaim verifies the participant claim before committing. Expected conflicts return
 * actionable feedback, while unexpected database errors propagate to the caller.
 */
export const commitQuestEntryBattle = async <T>({
  client,
  attempt,
  items,
  role,
  createBattle,
  didClaim,
}: {
  client: DrizzleClient;
  attempt: UserQuest;
  items: readonly UserItem[];
  role: UserRole;
  createBattle: (client: DrizzleClient) => Promise<T>;
  didClaim: (result: T) => boolean;
}) => {
  const rejected = new Error("Quest entry rejected");
  let message = "This quest changed or ended. Abandon it and start again.";
  const charges = getQuestEntryCharges(attempt, items);
  if (!charges)
    return {
      success: false as const,
      message: "You do not have the required entry items in your inventory.",
    };
  try {
    const result = await retryOnDeadlock(() =>
      client.transaction(async (tx) => {
        const database = tx as unknown as DrizzleClient;
        if (!attempt.entryPaid) {
          const receipt = await updateQuestHistoryForCommitQuestEntryBattle(
            tx,
            attempt,
            questAttemptWhere(database, attempt, role),
          );
          if (receipt.rowsAffected !== 1) throw rejected;
          for (const charge of charges) {
            const debited = await updateUserItemQuantityAtomically({
              client: database,
              userId: attempt.userId,
              userItemId: charge.id,
              expectedQuantity: charge.expectedQuantity,
              nextQuantity: charge.expectedQuantity - charge.quantity,
              where: [
                eq(userItem.itemId, charge.itemId),
                eq(userItem.storedAtHome, false),
                eq(userItem.isInAuction, false),
              ],
            });
            if (!debited) {
              message = "Your entry items changed. Please try again.";
              throw rejected;
            }
          }
        }
        const created = await createBattle(database);
        if (!didClaim(created)) {
          message = "Battle could not start. Please try again.";
          throw rejected;
        }
        return created;
      }),
    );
    return { success: true as const, result };
  } catch (error) {
    if (error === rejected) return { success: false as const, message };
    throw error;
  }
};
