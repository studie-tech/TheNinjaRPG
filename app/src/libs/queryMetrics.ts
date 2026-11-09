import * as Sentry from "@sentry/nextjs";
import {
  hashKey,
  type Mutation,
  type Query,
  type QueryClient,
} from "@tanstack/react-query";
import type { TRPCLink } from "@trpc/client";
import type { AppRouter } from "@/api/root";
import {
  MAX_QUERY_METRICS_HEADER_LENGTH,
  QUERY_METRICS_COUNT_WEIGHT,
  QUERY_METRICS_HEADER,
  QUERY_METRICS_SAMPLE_RATE,
  type QueryAttribution,
  type QueryTrigger,
  shouldSampleQueryMetric,
  trpcPathFromKey,
  UNKNOWN_QUERY_ATTRIBUTION,
} from "@/libs/queryTelemetry";

/**
 * Instrument one account's cache once; feature callers keep ordinary tRPC/TanStack APIs.
 * docs/Observability.md describes the triggers and the mutation-context window.
 */
export const createQueryMetricsTracker = (
  client: QueryClient,
  metrics: Pick<typeof Sentry.metrics, "count"> = Sentry.metrics,
  random: () => number = Math.random,
) => {
  const pending = new WeakMap<Query, QueryAttribution>();
  const fetching = new WeakMap<Query, QueryAttribution>();
  const knownQueries = new Set<string>();
  const knownMutations = new Set<string>();
  const settling = new Map<Mutation<unknown, unknown, unknown, unknown>, string>();
  const completedThisTurn = new Set<string>();
  let clearScheduled = false;
  let scope: QueryAttribution | undefined;

  // This is observed mutation context, not proof of causality: a timer can run while
  // an async callback is awaiting other work. Never guess between overlapping paths.
  const mutationContext = () => {
    const paths = new Set([...settling.values(), ...completedThisTurn]);
    return paths.size === 0 ? "none" : paths.size === 1 ? [...paths][0]! : "multiple";
  };
  const attribution = (trigger: QueryTrigger): QueryAttribution => ({
    trigger,
    mutationContext: mutationContext(),
  });
  const run = <T>(value: QueryAttribution, callback: () => T): T => {
    const previous = scope;
    scope = value;
    try {
      return callback();
    } finally {
      scope = previous;
    }
  };
  const beginMutation = (mutation: Mutation<unknown, unknown, unknown, unknown>) => {
    const path = trpcPathFromKey(mutation.options.mutationKey);
    settling.set(mutation, path && knownMutations.has(path) ? path : "unknown");
  };
  const mutationCache = client.getMutationCache();
  const originalHooks = mutationCache.config;
  mutationCache.config = {
    ...originalHooks,
    onSuccess: (...args) => {
      beginMutation(args[3]);
      return originalHooks.onSuccess?.(...args);
    },
    onError: (...args) => {
      beginMutation(args[3]);
      return originalHooks.onError?.(...args);
    },
  };
  mutationCache.subscribe((event) => {
    if (event.type === "removed") {
      settling.delete(event.mutation);
      return;
    }
    if (event.type !== "updated" || !["success", "error"].includes(event.action.type))
      return;
    const path = settling.get(event.mutation);
    settling.delete(event.mutation);
    if (!path) return;
    // Include the caller's continuation immediately after await mutateAsync(), then expire.
    completedThisTurn.add(path);
    if (!clearScheduled) {
      clearScheduled = true;
      setTimeout(() => {
        completedThisTurn.clear();
        clearScheduled = false;
      }, 0);
    }
  });
  client.getQueryCache().subscribe((event) => {
    if (event.type !== "updated" || !trpcPathFromKey(event.query.queryKey)) return;
    const { query, action } = event;
    if (action.type === "invalidate") {
      pending.set(query, scope ?? attribution("invalidation"));
    } else if (action.type === "fetch") {
      fetching.set(
        query,
        scope ??
          pending.get(query) ??
          attribution(query.state.data === undefined ? "initial" : "refresh"),
      );
      pending.delete(query);
    } else if (action.type === "success") {
      pending.delete(query);
    }
  });

  const invalidate = client.invalidateQueries.bind(client);
  const refetch = client.refetchQueries.bind(client);
  client.invalidateQueries = (filters, options) => {
    const value = attribution("invalidation");
    try {
      return run(value, () => invalidate(filters, options));
    } finally {
      if (shouldSampleQueryMetric(random)) {
        // Scheduling can register a hydrated query's first client-side operation.
        const path = trpcPathFromKey(filters?.queryKey);
        const target = !filters?.queryKey?.length
          ? "all"
          : path &&
              [...knownQueries].some(
                (known) => known === path || known.startsWith(`${path}.`),
              )
            ? path
            : "unknown";
        try {
          metrics.count("trpc.query.invalidation", QUERY_METRICS_COUNT_WEIGHT, {
            attributes: {
              target,
              mutation_context: value.mutationContext,
              sample_rate: QUERY_METRICS_SAMPLE_RATE,
            },
          });
        } catch {
          /* Diagnostics must not reject cache work. */
        }
      }
    }
  };
  client.refetchQueries = (filters, options) => {
    const value = scope ?? attribution("refetch");
    // TanStack forwards these options to Query.fetch. Distinct metadata ensures even
    // a paused replacement emits a fetch event; it does not change cancellation rules.
    const meta = (options as { meta?: Record<string, unknown> } | undefined)?.meta;
    const fetchOptions = { ...options, meta: { ...meta, queryTelemetry: value } };
    return run(value, () => refetch(filters, fetchOptions));
  };

  return {
    capture: (path: string, input: unknown): QueryAttribution => {
      knownQueries.add(path);
      const candidates = client
        .getQueryCache()
        .findAll({ queryKey: [path.split(".")] })
        .filter(
          (query) => query.state.fetchStatus !== "idle" && matchesInput(query, input),
        );
      if (candidates.length !== 1) return UNKNOWN_QUERY_ATTRIBUTION;
      const query = candidates[0]!;
      if (scope) {
        fetching.set(query, scope);
        pending.delete(query);
      }
      return fetching.get(query) ?? UNKNOWN_QUERY_ATTRIBUTION;
    },
    noteMutation: (path: string) => {
      knownMutations.add(path);
    },
  };
};

/** Capture before retrying/batching; inputs are used only for cache matching, never emitted. */
export const queryMetricsLink =
  (
    tracker: Pick<
      ReturnType<typeof createQueryMetricsTracker>,
      "capture" | "noteMutation"
    >,
  ): TRPCLink<AppRouter> =>
  () =>
  ({ op, next }) => {
    if (op.type === "mutation") tracker.noteMutation(op.path);
    let value = UNKNOWN_QUERY_ATTRIBUTION;
    try {
      if (op.type === "query") value = tracker.capture(op.path, op.input);
    } catch {
      /* Optional diagnostics. */
    }
    return next(
      op.type === "query"
        ? { ...op, context: { ...op.context, queryTelemetry: value } }
        : op,
    );
  };

export const queryMetricsHeaders = (
  operations: readonly {
    path: string;
    type: string;
    context: Record<string, unknown>;
  }[],
): Record<string, string> => {
  const entries = new Map<string, QueryAttribution>();
  for (const op of operations) {
    if (op.type !== "query") continue;
    const value =
      (op.context.queryTelemetry as QueryAttribution | undefined) ??
      UNKNOWN_QUERY_ATTRIBUTION;
    const previous = entries.get(op.path);
    entries.set(
      op.path,
      previous &&
        (previous.trigger !== value.trigger ||
          previous.mutationContext !== value.mutationContext)
        ? { trigger: "mixed", mutationContext: "multiple" }
        : value,
    );
  }
  if (!entries.size) return {};
  const header = JSON.stringify(Object.fromEntries(entries));
  return header.length <= MAX_QUERY_METRICS_HEADER_LENGTH
    ? { [QUERY_METRICS_HEADER]: header }
    : {};
};

// tRPC infinite-query keys store the input without cursor/direction, which the client
// adds to every page request (direction even when the input is undefined).
const matchesInput = (query: Query, input: unknown) => {
  const details = query.queryKey[1] as { input?: unknown; type?: string } | undefined;
  let compared = input;
  if (details?.type === "infinite" && input && typeof input === "object") {
    const {
      cursor: _cursor,
      direction: _direction,
      ...remaining
    } = input as Record<string, unknown>;
    compared =
      details.input === undefined && Object.keys(remaining).length === 0
        ? undefined
        : remaining;
  }
  return hashKey([details?.input]) === hashKey([compared]);
};
