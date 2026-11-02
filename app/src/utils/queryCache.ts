import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { isPlainObject } from "@/utils/typeutils";

export type QueryUpdateOptions = { revision: number | undefined };
export type QueryCacheUpdate<T> = (current: T) => T | undefined;

/** Capture only settled data; pending reads may reconcile another mutation. */
export const prepareQueryUpdate = <T>(
  client: QueryClient,
  key: QueryKey,
  canUpdate?: (data: T) => boolean,
) => {
  const state = client.getQueryState<T>(key);
  if (
    state?.data === undefined ||
    state.status === "error" ||
    state.isInvalidated ||
    state.fetchStatus !== "idle" ||
    (canUpdate && !canUpdate(state.data))
  )
    return undefined;
  return state.dataUpdateCount;
};

/**
 * Apply a local change or reconcile a confirmed mutation against its captured revision.
 * Returning undefined from the updater requests an authoritative refresh.
 * Resolve true only when cached data was updated without requesting recovery.
 */
export const updateQueryCache = async <T>(
  client: QueryClient,
  key: QueryKey,
  update: QueryCacheUpdate<T> | undefined,
  mutation?: QueryUpdateOptions,
) => {
  const filter = { queryKey: key, exact: true };
  if (!mutation) {
    if (!update) return false;
    const before = client.getQueryState(key);
    let applied = false;
    let needsRefresh =
      before?.status === "error" ||
      !!before?.isInvalidated ||
      before?.fetchStatus !== "idle";
    if (before?.fetchStatus !== "idle") await client.cancelQueries(filter);
    client.setQueryData<T>(key, (old) => {
      const state = client.getQueryState(key);
      needsRefresh ||=
        state?.status === "error" ||
        !!state?.isInvalidated ||
        state?.fetchStatus !== "idle";
      if (old === undefined) return undefined;
      const next = update(old);
      applied = next !== undefined;
      needsRefresh ||= next === undefined;
      return next;
    });
    // A local patch must preserve reconciliation of unrelated fields.
    if (needsRefresh) await client.invalidateQueries(filter);
    return applied && !needsRefresh;
  }
  if (!update || mutation.revision === undefined) {
    // An initial fetch may contain a snapshot taken before the mutation.
    await client.cancelQueries(filter);
    await client.invalidateQueries(filter);
    return false;
  }
  const wasFetching = client.getQueryState(key)?.fetchStatus !== "idle";
  // An idle query can be patched in this turn; cancellation is only needed for an unfinished read.
  if (wasFetching) await client.cancelQueries(filter);
  // Another action may depend on this unfinished read for reconciliation.
  if (wasFetching) {
    await client.invalidateQueries(filter);
    return false;
  }
  let applied = false;
  client.setQueryData<T>(key, (old) => {
    const state = client.getQueryState(key);
    // A refetch or another patch may already contain this mutation's changes.
    if (
      old === undefined ||
      !state ||
      state.dataUpdateCount !== mutation.revision ||
      state.status === "error" ||
      state.isInvalidated ||
      state.fetchStatus !== "idle"
    )
      return undefined;
    const next = update(old);
    applied = next !== undefined;
    return next;
  });
  if (!applied) await client.invalidateQueries(filter);
  return applied;
};

/** Objects merge recursively; arrays, Dates and null are absolute replacements. */
export type QueryPatch<T> = T extends Date | readonly unknown[]
  ? T
  : T extends object
    ? { [K in keyof T]?: QueryPatch<T[K]> }
    : T;

/** Numeric changes use the original value; nested IDs assert relation identity. */
export type QueryDelta<T> = {
  [K in keyof T]?: K extends "id"
    ? T[K]
    : NonNullable<T[K]> extends number
      ? number
      : NonNullable<T[K]> extends readonly (infer Entry)[]
        ? {
            remove?: Partial<Record<keyof Entry, string | number>>[];
            update?: (Partial<Entry> & { id: string })[];
          }
        : NonNullable<T[K]> extends Date
          ? never
          : NonNullable<T[K]> extends object
            ? QueryDelta<NonNullable<T[K]>>
            : never;
};

/** Merge record changes, rejecting unknown numeric baselines and mismatched identities. */
export const mergeQueryChanges = <T extends Record<string, unknown>>(
  current: T,
  patch: QueryPatch<NoInfer<T>>,
  delta: QueryDelta<NoInfer<T>> = {},
  caps?: Readonly<Partial<Record<keyof NoInfer<T>, number>>>,
  policy?: QueryMergePolicy,
): T | undefined => mergeChanges(current, patch, delta, caps, policy);

const mergeChanges = <T extends object>(
  current: T,
  patch: object,
  delta: object = {},
  caps?: Readonly<Record<string, number | undefined>>,
  policy?: QueryMergePolicy,
): T | undefined => {
  const original = current as Record<string, unknown>;
  const values = patch as Record<string, unknown>;
  const amounts = delta as Record<string, unknown>;
  if (
    (values.id !== undefined && values.id !== original.id) ||
    (amounts.id !== undefined && amounts.id !== original.id)
  )
    return undefined;
  const updated = { ...original, ...values };
  // A changed membership must carry its complete relation, never fields from the old owner.
  for (const [relation, foreignKey] of Object.entries(policy?.relations ?? {})) {
    if (values[foreignKey] === undefined || values[foreignKey] === original[foreignKey])
      continue;
    const value = values[relation];
    if (
      amounts[relation] !== undefined ||
      (values[foreignKey] === null
        ? value !== null
        : !isCacheObject(value) || value.id !== values[foreignKey])
    )
      return undefined;
    updated[relation] = value;
  }
  for (const field in { ...values, ...amounts }) {
    const value = values[field];
    const amount = amounts[field];
    const foreignKey = policy?.relations?.[field];
    if (
      foreignKey &&
      values[foreignKey] !== undefined &&
      values[foreignKey] !== original[foreignKey]
    )
      continue;
    if (amount === undefined && value === original[field]) continue;
    // Sparse list changes preserve unrelated entries and reject unknown update targets.
    if (isCacheObject(amount) && ("remove" in amount || "update" in amount)) {
      const entries = original[field];
      if (!Array.isArray(entries) || value !== undefined) return undefined;
      const changes = amount as {
        remove?: Record<string, string | number>[];
        update?: (Record<string, unknown> & { id: string })[];
      };
      if (
        changes.update?.some(
          (change) => !entries.some((entry) => entry.id === change.id),
        )
      )
        return undefined;
      updated[field] = entries
        .filter(
          (entry) =>
            !changes.remove?.some((match) =>
              Object.entries(match).every(
                ([key, expected]) =>
                  (entry[key] instanceof Date ? entry[key].getTime() : entry[key]) ===
                  expected,
              ),
            ),
        )
        .map((entry) => {
          const change = changes.update?.find((change) => change.id === entry.id);
          return change ? { ...entry, ...change } : entry;
        });
      continue;
    }
    if (
      amount === undefined &&
      isCacheObject(value) &&
      policy?.replace?.(field, value)
    ) {
      updated[field] = value;
      continue;
    }
    if (isCacheObject(value) || isCacheObject(amount)) {
      const merged = mergeChanges(
        isCacheObject(original[field]) ? original[field] : {},
        isCacheObject(value) ? value : {},
        isCacheObject(amount) ? amount : {},
        undefined,
        { replace: policy?.replace },
      );
      if (!merged) return undefined;
      updated[field] = merged;
    } else if (typeof amount === "number" && field !== "id") {
      const baseline = original[field];
      if (typeof baseline !== "number") return undefined;
      updated[field] = Math.min(baseline + amount, caps?.[field] ?? Infinity);
    }
  }
  return updated as T;
};

const isCacheObject = (value: unknown): value is Record<string, unknown> =>
  isPlainObject(value) && !(value instanceof Date);

type QueryMergePolicy = {
  relations?: Readonly<Record<string, string>>;
  replace?: (field: string, value: Record<string, unknown>) => boolean;
};
