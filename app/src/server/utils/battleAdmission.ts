import type { DrizzleClient } from "@/server/db";
import { retryOnDeadlock } from "@/server/utils/mysqlErrors";

/**
 * Commit a battle with the guarded admission writes it depends on, or roll them all back.
 * For admissions a single guarded statement cannot cover; each caller documents why.
 * `admit` must await its writes sequentially on the transaction's PlanetScale session and
 * calls `reject` to abort with a user-facing message. Expected conflicts return that
 * message, while unexpected database errors propagate to the caller.
 */
export const commitBattleAdmission = async <T>({
  client,
  admit,
  createBattle,
  didClaim,
  claimFailedMessage,
}: {
  client: DrizzleClient;
  admit?: (tx: DrizzleClient, reject: (message: string) => never) => Promise<void>;
  createBattle: (client: DrizzleClient) => Promise<T>;
  didClaim: (result: T) => boolean;
  claimFailedMessage: string;
}) => {
  const rejected = new Error("Battle admission rejected");
  let rejection = claimFailedMessage;
  const reject = (message: string): never => {
    rejection = message;
    throw rejected;
  };
  try {
    const result = await retryOnDeadlock(() =>
      client.transaction(async (transaction) => {
        const tx = transaction as unknown as DrizzleClient;
        await admit?.(tx, reject);
        const created = await createBattle(tx);
        if (!didClaim(created)) reject(claimFailedMessage);
        return created;
      }),
    );
    return { success: true as const, result };
  } catch (error) {
    if (error === rejected) return { success: false as const, message: rejection };
    throw error;
  }
};
