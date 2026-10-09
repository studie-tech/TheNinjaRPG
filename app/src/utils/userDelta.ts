import type { QueryClient, QueryKey } from "@tanstack/react-query";
import type { UserWithRelations } from "@/server/api/routers/profile";
import type { UserDelta } from "@/validators/userCache";

type User = NonNullable<UserWithRelations>;
type UserCache = { userData?: User | null };
export type UserDeltaPatch =
  | Partial<User>
  | ((current: User) => Partial<User> | undefined);

export const prepareUserDelta = async (client: QueryClient, key: QueryKey) => {
  // An action can render before the initial profile; leave that loading query running.
  if (!client.getQueryData<UserCache>(key)?.userData) return undefined;
  await client.cancelQueries({ queryKey: key, exact: true });
  return client.getQueryState(key)?.dataUpdateCount;
};

/** Apply confirmed changes only to the snapshot that preceded the mutation. */
export const applyUserDelta = async (
  client: QueryClient,
  key: QueryKey,
  delta: UserDelta | undefined,
  revision: number | undefined,
  patch?: UserDeltaPatch,
) => {
  if (delta === undefined || revision === undefined) {
    await client.invalidateQueries({ queryKey: key, exact: true });
    return;
  }
  await client.cancelQueries({ queryKey: key, exact: true });
  let applied = false;
  client.setQueryData<UserCache>(key, (old) => {
    // A completed refetch or another absolute patch may already include this debit.
    // Cancelling at success cannot undo that response; refresh rather than count it twice.
    if (!old?.userData || client.getQueryState(key)?.dataUpdateCount !== revision) {
      return undefined;
    }
    const known = typeof patch === "function" ? patch(old.userData) : patch;
    if (patch && known === undefined) return undefined;
    const changes: Partial<User> = { ...known };
    for (const field of Object.keys(delta) as (keyof UserDelta)[]) {
      const amount = delta[field];
      if (amount !== undefined) changes[field] = old.userData[field] + amount;
    }
    applied = true;
    return { ...old, userData: { ...old.userData, ...changes } };
  });
  if (!applied) await client.invalidateQueries({ queryKey: key, exact: true });
};
