import * as Sentry from "@sentry/nextjs";
import { Redis } from "@upstash/redis";
import superjson from "superjson";
import type { CombatResult, ReturnedBattle } from "@/libs/combat/types";

const COMPLETION_TTL_SECONDS = 600;
type Completion = { battle: ReturnedBattle; result: CombatResult };
const completionKey = (userId: string, battleId: string) =>
  `combat-completion:${JSON.stringify([userId, battleId])}`;

/** Private display receipts let another tab recover an arena result without settling rewards again. */
export const createCombatCompletionStore = (redis: Pick<Redis, "get" | "set">) => ({
  async save(userId: string, battle: ReturnedBattle, result: CombatResult | null) {
    if (!result || !["ARENA", "TRAINING"].includes(battle.battleType)) return;
    try {
      await redis.set(
        completionKey(userId, battle.id),
        superjson.serialize({ battle, result }),
        {
          ex: COMPLETION_TTL_SECONDS,
        },
      );
    } catch (error) {
      // The action response still displays committed rewards when optional receipt storage is unavailable.
      Sentry.captureException(error, { tags: { source: "combatCompletionSave" } });
    }
  },
  async recover(userId: string, battleId: string): Promise<Completion | null> {
    try {
      // The winning request deletes the battle before its parallel settlement writes finish.
      // Only missing-row recovery waits; ongoing turns never read this cache or add database queries.
      for (const delay of [0, 100, 200, 400, 800]) {
        if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
        const saved = await redis.get<ReturnType<typeof superjson.serialize>>(
          completionKey(userId, battleId),
        );
        if (!saved) continue;
        const completion = superjson.deserialize<Completion>(saved);
        return completion.battle.id === battleId && completion.result
          ? completion
          : null;
      }
    } catch (error) {
      // Combat keeps its return/retry controls when result recovery cannot reach the cache.
      Sentry.captureException(error, { tags: { source: "combatCompletionRead" } });
    }
    return null;
  },
});

let store: ReturnType<typeof createCombatCompletionStore> | undefined;
/** Share expiring receipts across server instances; keys always include the authenticated player. */
export const combatCompletionStore = () =>
  (store ??= createCombatCompletionStore(Redis.fromEnv()));
