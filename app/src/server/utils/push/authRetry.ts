/**
 * Replace only authentication-rejected batch entries with one coordinated replay.
 *
 * The callback owns credential refresh, so one batch performs one refresh regardless of
 * how many device requests rejected the shared token. A refresh failure keeps the first
 * attempt's retryable results for the caller to report.
 */
export const retryRejectedOnce = async <T>(
  initial: T[],
  wasRejected: (result: T) => boolean,
  retry: (indexes: number[]) => Promise<T[]>,
): Promise<T[]> => {
  const indexes = initial
    .map((result, index) => (wasRejected(result) ? index : -1))
    .filter((index) => index >= 0);
  if (indexes.length === 0) return initial;

  try {
    const retried = await retry(indexes);
    indexes.forEach((index, offset) => {
      const replacement = retried[offset];
      if (replacement !== undefined) initial[index] = replacement;
    });
  } catch {
    // Preserve the original results if credential refresh or the replay fails as a batch.
  }
  return initial;
};
