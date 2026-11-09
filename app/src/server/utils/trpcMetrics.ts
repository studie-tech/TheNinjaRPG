import * as Sentry from "@sentry/nextjs";
import {
  QUERY_METRICS_COUNT_WEIGHT,
  QUERY_METRICS_SAMPLE_RATE,
  type QueryAttribution,
  shouldSampleQueryMetric,
  UNKNOWN_QUERY_ATTRIBUTION,
} from "@/libs/queryTelemetry";

/** Sample executions independently of traces; keep each query's count and duration paired. */
export const measureTrpcCall = async <T extends { ok: boolean }>(
  call: { path: string; type: string; attribution?: QueryAttribution },
  next: () => Promise<T>,
  metrics: Pick<typeof Sentry.metrics, "count" | "distribution"> = Sentry.metrics,
  random: () => number = Math.random,
) => {
  if (!["query", "mutation"].includes(call.type) || !shouldSampleQueryMetric(random))
    return next();

  if (call.type === "mutation") {
    recordMetric(() =>
      metrics.count("trpc.mutation", QUERY_METRICS_COUNT_WEIGHT, {
        attributes: { procedure: call.path, sample_rate: QUERY_METRICS_SAMPLE_RATE },
      }),
    );
  }
  if (call.type !== "query") return next();

  const attribution = call.attribution ?? UNKNOWN_QUERY_ATTRIBUTION;
  const attributes = {
    procedure: call.path,
    trigger: attribution.trigger,
    mutation_context: attribution.mutationContext,
    sample_rate: QUERY_METRICS_SAMPLE_RATE,
  };
  recordMetric(() =>
    metrics.count("trpc.query.fetch", QUERY_METRICS_COUNT_WEIGHT, { attributes }),
  );
  const started = performance.now();
  let outcome = "error";
  try {
    const result = await next();
    outcome = result.ok ? "success" : "error";
    return result;
  } finally {
    recordMetric(() =>
      metrics.distribution("trpc.query.duration", performance.now() - started, {
        unit: "millisecond",
        attributes: { ...attributes, outcome },
      }),
    );
  }
};

const recordMetric = (record: () => void) => {
  try {
    record();
  } catch {
    // Diagnostics must never reject an action or replace its original error.
  }
};
