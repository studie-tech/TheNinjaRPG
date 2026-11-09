import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { combatProfilePatch, type CombatProfileUpdate } from "@/deltas/combat";
import type { CompleteBattle } from "@/libs/combat/types";
import { calcBattleResult } from "@/libs/combat/settlement";
import { prepareUserUpdate, updateUserCache } from "@/utils/userCache";

/**
 * Mounts the `profile.getUser` cache entry the way the app does: seeded with
 * `cached` and kept alive by an observer that counts every fallback read. Pass
 * a captured `revision` to `apply` to replay an update under it.
 */
export const observeProfile = <User>(
  cached: { userData: User; notifications?: unknown[] },
  refetch: () => Promise<unknown>,
) => {
  const key = [["profile", "getUser"], { type: "query" }];
  const client = new QueryClient();
  client.setQueryData(key, cached);
  let reads = 0;
  const observer = new QueryObserver(client, {
    queryKey: key,
    staleTime: Infinity,
    queryFn: async () => {
      reads++;
      return refetch();
    },
  });
  const stop = observer.subscribe(() => undefined);
  return {
    client,
    key,
    reads: () => reads,
    user: () => client.getQueryData<{ userData: User }>(key)!.userData,
    revision: () => prepareUserUpdate(client, key),
    apply: (update?: CombatProfileUpdate, revision = prepareUserUpdate(client, key)) =>
      updateUserCache(
        client,
        key,
        update ? (user) => combatProfilePatch(user, update) : undefined,
        {
          revision,
          delta: update?.userDelta,
        },
      ),
    close: () => {
      stop();
      client.clear();
    },
  };
};

/**
 * `calcBattleResult` without relation rewards, which require profile
 * reconciliation; isolates the eligible solo PvE outcome.
 */
export const soloPveResult = (battle: CompleteBattle, userId: string) => {
  const result = calcBattleResult(battle, userId, [])!;
  result.villagePrestige = 0;
  result.villageTokens = 0;
  result.anbuPoints = 0;
  result.clanPoints = 0;
  return result;
};
