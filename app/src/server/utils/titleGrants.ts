import { insertUserTitleForGrant, updateUserDataForGrant } from "@/queries/title";
import type { DrizzleClient } from "@/server/db";
import { retryOnDeadlock } from "@/server/utils/mysqlErrors";

/**
 * Publish ownership and the account version in one commit. A hospital heal settles at SQL
 * NOW(3), so either autocommit write order can advance regenAt past acquisition with stale
 * bonuses. One guarded UPDATE cannot insert missing UserTitle rows; these two writes need
 * a short transaction. Advance the account version before timestamping the immutable grant.
 * Existing encounters retain their preloaded passives and recovery rates.
 * @param inTransaction - Reuse the caller's transaction instead of nesting another session.
 */
export const grantTitles = async (
  client: DrizzleClient,
  userId: string,
  ids: string[],
  inTransaction = false,
) => {
  if (!ids.length) return;
  const grant = async (database: DrizzleClient) => {
    const owner = await updateUserDataForGrant(database, userId);
    if (owner.rowsAffected === 0) return;
    // The PK preserves the first acquisition clock and effect snapshot on retries/concurrent grants.
    await insertUserTitleForGrant(database, userId, ids);
  };
  if (inTransaction) await grant(client);
  else await retryOnDeadlock(() => client.transaction(grant));
};
