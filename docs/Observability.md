# Query and mutation load attribution

The shared tRPC provider instruments its QueryClient and query/mutation caches once.
Callers use the ordinary tRPC/TanStack APIs without adding labels at invalidation
sites. Sentry Application Metrics are independent of trace sampling.
All four metrics use a uniform 2% event sample, identified by `sample_rate:0.02`.

| Metric | Emitted by | Attributes | Meaning |
| --- | --- | --- | --- |
| `trpc.mutation` | Server | `procedure` | Estimated mutation invocations reaching middleware after authentication, isolation and BotID guards; attempts rather than committed writes. |
| `trpc.query.invalidation` | Client | `target`, `mutation_context` | Estimated calls to `invalidateQueries`, including repeated calls against already-invalidated, inactive or missing queries. The target is a procedure, router prefix, `all` or `unknown`. |
| `trpc.query.fetch` | Server | `procedure`, `trigger`, `mutation_context` | Estimated actual query invocations reaching middleware, including retries, for every procedure. Cache hits and invalidations that reuse unfinished reads add no server execution. |
| `trpc.query.duration` | Server | `procedure`, `trigger`, `mutation_context`, `outcome` | Procedure wall time in milliseconds, including application work and database latency; not SQL CPU time or the sum of SQL durations. |

The Sentry Next.js request wrapper flushes server metrics after the response
through the platform's `waitUntil`; game logic does not await a telemetry request.
Client metrics use the browser SDK and can be absent when telemetry is blocked.
CDN cache hits do not reach server middleware and produce no server execution metric.

## Finding optimization opportunities

In Sentry, select **Explore → Metrics**, project `theninjarpg`, the production
environment and a consistent time window.

1. Sum `trpc.query.fetch`, group by `procedure`, and filter `trigger:invalidation` to
   rank queries reloaded after invalidation. Filter `procedure:profile.getUser` for
   the account query specifically.
2. Sum `trpc.query.invalidation` and group by `target` to find frequent invalidation
   calls, including router-wide and global calls. Compare with server executions:
   invalidation counts alone overstate database load when reads are deduplicated,
   queries are inactive or responses come from the CDN.
3. Group profile executions by `mutation_context`, then compare with `trpc.mutation`
   grouped by `procedure`. This provides mutation correlation, not proof of causality.
4. Compare query duration by the same dimensions. Estimated count times average duration
   estimates total procedure wall time. Use PlanetScale Insights for the underlying
   SQL cost; parallel statements overlap in wall time.
5. Compare equal windows before and after an optimization, accounting for player
   activity and release changes. Metrics begin on deployment and do not backfill traces.

## Sampling and ingestion budget

`QUERY_METRICS_SAMPLE_RATE` in `app/src/libs/queryTelemetry.ts` controls client and
server emission. Each invalidation call and server procedure invocation gets an
independent random decision, regardless of procedure, player, trigger, outcome or
duration. A sampled query retains both its fetch counter and duration from one
decision made before execution. Sampling never skips game work, and attribution is
maintained for all cache activity so an unsampled invalidation can still explain a
sampled server fetch. Client and server samples are independent aggregate observations,
not linked samples of complete mutation/refetch chains.

Retained counters carry `1 / sample_rate` (50 at 2%), so **sum counter values** for
estimated production counts; do not scale them again. Duration values stay in real
milliseconds: means and percentiles describe the retained executions. Estimate total
procedure wall time using the weighted fetch count times the matching mean duration,
not the unscaled sum of duration samples. All four metrics carry `sample_rate` so
different rates can be filtered if configuration changes.

Rank large groups over equal windows, preferably seven or thirty days. Inspect the
number of retained records, not the weighted counter total, when judging confidence.
For event counts, an approximate 95% relative sampling margin is `2 / sqrt(n)`:
100 retained events gives about ±20%; 1,000 gives about ±6%. Small groups, close
rankings and tail-latency estimates need more data. These margins cover random sampling
only; blocked/lost telemetry and mutation-context ambiguity remain separate limitations.

The expected record volume is `0.02 * (mutations + invalidations + 2 * server queries)`.
At one KB per retained record, a five GB allowance accommodates about 250 million
underlying metric emissions. This is a planning estimate, not a hard billing cap:
actual record sizes, traffic and other metrics sharing the organization's allowance
affect ingestion. Check Sentry's Metrics usage after deployment and lower the shared
rate if projected usage approaches the allowance. Metrics do not inherit the Sentry
trace sampling rate.

## Trigger and mutation context

- `initial`: a query has no successful cached result.
- `invalidation`: a fetch was scheduled by invalidation or follows a pending invalidation.
- `refetch`: an explicit QueryClient/tRPC utility refetch outside invalidation.
- `refresh`: other fetches of existing data, including polling, focus/reconnect,
  observer refetches and imperative fetches.
- `unknown`: requests without the attribution header (such as tabs running an older
  bundle), direct callers or missing/unmatchable attribution.
- `mixed`: duplicate procedure calls in one batch have conflicting attribution.

`mutation_context` records a single procedure whose success/error callbacks are
settling, or that just completed in the same event-loop turn. It also covers the
continuation immediately after `await mutateAsync()`. Different overlapping mutation
paths produce `multiple`; no observed context produces `none`. `unknown` covers
unrecognized mutation metadata. An unrelated timer or realtime event can fire while
an async mutation callback awaits other work, so this field is a correlation hint.
The generic hook cannot infer exact timer, websocket or caller identity.

## Collection contract

The tracker scopes scheduling per QueryClient, retains pending invalidations and
snapshots attribution into each tRPC operation before retrying and batching. Cache
matching includes query inputs and handles infinite-query cursors, but inputs and
query-key hashes are never sent to metrics. Router/global invalidations require no
special handling at call sites. Predicates are evaluated exactly as TanStack evaluates them.

A bounded diagnostic header carries attribution for batched query paths. Server
validation uses the registered router's procedure types, with no manual allowlist.
Unknown query names, mutation names, triggers and oversized/malformed headers cannot
create arbitrary server metric labels or reject game requests. Attribution grants
no authority and includes no player identifiers or request/response payloads.

Delivery is best effort. Unsampled server calls bypass metric recording and
timing; sampled calls buffer records through the Sentry SDK. Client attribution
covers all queries, but only sampled invalidations incur metric serialization
and upload.
