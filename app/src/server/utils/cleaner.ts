import { notExists, type SQL } from "drizzle-orm";
import type { AnyMySqlColumn, MySqlTable } from "drizzle-orm/mysql-core";
import {
  bankTransfers,
  bloodlineRolls,
  conceptImage,
  conversation,
  conversationComment,
  forumPost,
  forumThread,
  historicalAvatar,
  jutsu,
  questHistory,
  user2conversation,
  userAttribute,
  userData,
  userItem,
  userJutsu,
  userPet,
} from "@/drizzle/schema";
import {
  executeStatementForDeleteCleanupCandidates,
  selectDistinctKeyForDeleteCleanupCandidates,
  selectParentForMissing,
  selectUserIdsForUpdateUserDataCandidates,
} from "@/queries/cleaner";
import type { DrizzleClient } from "@/server/db";
import { retryOnDeadlock } from "@/server/utils/mysqlErrors";

/**
 * Players written per batched UserData statement. MySQL skips range optimization once an
 * IN list of UserData keys outgrows `range_optimizer_max_mem_size` (from roughly 275 keys
 * at the default 8 MB), and the UPDATE then scans and locks the whole primary key.
 */
const USER_UPDATE_BATCH_SIZE = 200;

/** Scan with consistent reads, then recheck eligibility in indexed write batches. */
export const deleteCleanupCandidates = async (
  client: Pick<DrizzleClient, "selectDistinct" | "execute">,
  table: MySqlTable,
  key: Record<string, AnyMySqlColumn<{ data: string | number; notNull: true }>>,
  predicate: SQL | undefined,
  batchSize = 1000,
  indexName = "PRIMARY",
) => {
  if (!predicate) throw new Error("Cleanup requires an eligibility predicate");
  const columns = Object.entries(key);
  const firstColumn = columns[0];
  if (!firstColumn) throw new Error("Cleanup requires an indexed key");
  let cursor: Record<string, string | number> | undefined;
  while (true) {
    const previous = cursor;
    const candidates = await selectDistinctKeyForDeleteCleanupCandidates(
      client,
      key,
      table,
      predicate,
      previous,
      columns,
      batchSize,
    );
    if (!candidates.length) return;

    await retryOnDeadlock(() =>
      executeStatementForDeleteCleanupCandidates(
        client,
        table,
        columns,
        firstColumn,
        candidates,
        predicate,
        indexName,
      ),
    );
    // Keyset progress also skips candidates rescued between the read and write.
    cursor = candidates[candidates.length - 1];
    if (candidates.length < batchSize) return;
  }
};

/**
 * Rewrite the players matching `pending` in primary-key batches. Candidates come from
 * consistent reads, and `update` must recheck `pending`, so each statement locks only its
 * batch instead of every row a table-wide UPDATE scans.
 */
export const updateUserDataCandidates = async (
  client: Pick<DrizzleClient, "select">,
  pending: SQL | undefined,
  update: (batch: string[]) => Promise<unknown>,
  batchSize = USER_UPDATE_BATCH_SIZE,
) => {
  if (!pending) throw new Error("Batched updates require an eligibility predicate");
  let cursor: string | undefined;
  while (true) {
    const candidates = await selectUserIdsForUpdateUserDataCandidates(
      client,
      pending,
      cursor,
      batchSize,
    );
    const batch = candidates.map((row) => row.userId);
    if (!batch.length) return;
    await retryOnDeadlock(() => update(batch));
    cursor = batch[batch.length - 1];
    if (batch.length < batchSize) return;
  }
};

/** Relational leftovers can wait for the daily timer; active queue repair cannot. */
export const cleanupOrphanRows = async (
  client: Pick<DrizzleClient, "select" | "selectDistinct" | "execute">,
) => {
  const missing = (
    parent: MySqlTable,
    parentKey: AnyMySqlColumn,
    childKey: AnyMySqlColumn,
  ) => notExists(selectParentForMissing(client, parentKey, parent, childKey));
  // DELETE disables antijoin materialization to avoid locking unrelated parents;
  // candidate SELECTs retain the optimizer's non-locking materialization choices.
  const withoutUser = (childKey: AnyMySqlColumn) =>
    missing(userData, userData.userId, childKey);
  const sweeps: Array<{
    table: MySqlTable;
    key: Record<string, AnyMySqlColumn<{ data: string | number; notNull: true }>>;
    predicate: SQL;
    indexName?: string;
  }> = [
    {
      table: conversationComment,
      key: { id: conversationComment.id },
      predicate: missing(
        conversation,
        conversation.id,
        conversationComment.conversationId,
      ),
    },
    {
      table: user2conversation,
      key: {
        conversationId: user2conversation.conversationId,
        userId: user2conversation.userId,
      },
      predicate: missing(
        conversation,
        conversation.id,
        user2conversation.conversationId,
      ),
    },
    {
      table: user2conversation,
      key: {
        conversationId: user2conversation.conversationId,
        userId: user2conversation.userId,
      },
      predicate: withoutUser(user2conversation.userId),
    },
    {
      table: userJutsu,
      key: { id: userJutsu.id },
      predicate: missing(jutsu, jutsu.id, userJutsu.jutsuId),
    },
    // Transfers have no row id or unique key. Restrict each write to selected
    // indexed sender/receiver pairs. A pair can contain multiple historical transfers.
    {
      table: bankTransfers,
      key: { senderId: bankTransfers.senderId, receiverId: bankTransfers.receiverId },
      predicate: withoutUser(bankTransfers.senderId),
      indexName: "BankTransfers_senderId_receiverId_idx",
    },
    {
      table: bankTransfers,
      key: { senderId: bankTransfers.senderId, receiverId: bankTransfers.receiverId },
      predicate: withoutUser(bankTransfers.receiverId),
      indexName: "BankTransfers_senderId_receiverId_idx",
    },
    { table: userPet, key: { id: userPet.id }, predicate: withoutUser(userPet.userId) },
    {
      table: bloodlineRolls,
      key: { id: bloodlineRolls.id },
      predicate: withoutUser(bloodlineRolls.userId),
    },
    {
      table: conceptImage,
      key: { id: conceptImage.id },
      predicate: withoutUser(conceptImage.userId),
    },
    {
      table: forumThread,
      key: { id: forumThread.id },
      predicate: withoutUser(forumThread.userId),
    },
    {
      table: forumPost,
      key: { id: forumPost.id },
      predicate: withoutUser(forumPost.userId),
    },
    {
      table: forumPost,
      key: { id: forumPost.id },
      predicate: missing(forumThread, forumThread.id, forumPost.threadId),
    },
    {
      table: historicalAvatar,
      key: { id: historicalAvatar.id },
      predicate: withoutUser(historicalAvatar.userId),
    },
    {
      table: questHistory,
      key: { id: questHistory.id },
      predicate: withoutUser(questHistory.userId),
    },
    {
      table: userAttribute,
      key: { id: userAttribute.id },
      predicate: withoutUser(userAttribute.userId),
    },
    {
      table: userJutsu,
      key: { id: userJutsu.id },
      predicate: withoutUser(userJutsu.userId),
    },
    {
      table: userItem,
      key: { id: userItem.id },
      predicate: withoutUser(userItem.userId),
    },
  ];
  // Keep full-table consistent scans sequential to avoid saturating the database.
  for (const sweep of sweeps) {
    await deleteCleanupCandidates(
      client,
      sweep.table,
      sweep.key,
      sweep.predicate,
      1000,
      sweep.indexName,
    );
  }
};
