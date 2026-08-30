/**
 * Bounded concurrency for provider fan-out.
 *
 * A village-wide announcement can address thousands of devices, and firing every request
 * at once does not make them go faster: undici queues whatever exceeds its connection
 * limit, and `AbortSignal.timeout` covers the time a request spends queued — so a large
 * enough batch starts timing out requests that never left the process. HTTP/2 has the same
 * shape of problem once a batch exceeds the peer's concurrent-stream limit.
 */

/** Comfortably inside undici's default pool and APNs' concurrent-stream allowance. */
export const MAX_CONCURRENT_SENDS = 20;

/**
 * Map over `items` with at most `limit` in flight, preserving input order. `worker` is
 * expected not to reject — every caller here resolves failures into a result object.
 */
export const mapWithConcurrency = async <T, R>(
  items: T[],
  worker: (item: T) => Promise<R>,
  limit = MAX_CONCURRENT_SENDS,
): Promise<R[]> => {
  if (items.length <= limit) return Promise.all(items.map(worker));

  const results = new Array<R>(items.length);
  let next = 0;
  // Each runner pulls the next index rather than taking a fixed slice, so one slow
  // request cannot leave the rest of its share waiting behind it.
  const runner = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: limit }, runner));
  return results;
};
