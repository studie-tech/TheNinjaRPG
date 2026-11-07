export const QUERY_METRICS_HEADER = "x-tnr-query-metrics";
export const MAX_QUERY_METRICS_HEADER_LENGTH = 4096;
// Uniform event sampling preserves relative load while leaving ingestion headroom.
export const QUERY_METRICS_SAMPLE_RATE = 0.02;
export const QUERY_METRICS_COUNT_WEIGHT = 1 / QUERY_METRICS_SAMPLE_RATE;

export const shouldSampleQueryMetric = (random: () => number = Math.random) =>
  random() < QUERY_METRICS_SAMPLE_RATE;

const QUERY_TRIGGERS = [
  "initial",
  "invalidation",
  "refetch",
  "refresh",
  "unknown",
  "mixed",
] as const;
export type QueryTrigger = (typeof QUERY_TRIGGERS)[number];
export type QueryAttribution = { trigger: QueryTrigger; mutationContext: string };
export const UNKNOWN_QUERY_ATTRIBUTION: QueryAttribution = {
  trigger: "unknown",
  mutationContext: "none",
};

/** The SDK inherits setUser() attributes; load and device metrics need only aggregate dimensions. */
export const stripQueryMetricUserAttributes = <
  T extends { name: string; attributes?: Record<string, unknown> },
>(
  metric: T,
): Omit<T, "attributes"> & { attributes?: Record<string, unknown> } =>
  (metric.name.startsWith("trpc.") || metric.name.startsWith("renderer.")) &&
  metric.attributes
    ? {
        ...metric,
        attributes: Object.fromEntries(
          Object.entries(metric.attributes).filter(([key]) => !key.startsWith("user.")),
        ),
      }
    : metric;

/** Validate against the registered router, never an independently maintained list of labels. */
export const parseQueryMetricsHeader = (
  header: string | null,
  procedures: ReadonlyMap<string, string>,
): ReadonlyMap<string, QueryAttribution> => {
  const result = new Map<string, QueryAttribution>();
  if (!header || header.length > MAX_QUERY_METRICS_HEADER_LENGTH) return result;
  try {
    const entries: unknown = JSON.parse(header);
    if (!entries || typeof entries !== "object" || Array.isArray(entries))
      return result;
    for (const [path, value] of Object.entries(entries)) {
      if (procedures.get(path) !== "query" || !value || typeof value !== "object")
        continue;
      const { trigger, mutationContext } = value as Record<string, unknown>;
      if (!QUERY_TRIGGERS.some((allowed) => allowed === trigger)) continue;
      const context =
        typeof mutationContext === "string" &&
        (["none", "multiple", "unknown"].includes(mutationContext) ||
          procedures.get(mutationContext) === "mutation")
          ? mutationContext
          : "unknown";
      result.set(path, { trigger: trigger as QueryTrigger, mutationContext: context });
    }
  } catch {
    // Attribution is optional diagnostics, never a reason to reject a game request.
  }
  return result;
};

/** Drop all input-bearing key segments; only tRPC's static procedure path is a metric label. */
export const trpcPathFromKey = (
  key: readonly unknown[] | undefined,
): string | undefined => {
  const path = key?.[0];
  return Array.isArray(path) &&
    path.length > 0 &&
    path.every(
      (segment) =>
        typeof segment === "string" && /^[A-Za-z][A-Za-z0-9_]*$/.test(segment),
    )
    ? path.join(".")
    : undefined;
};
