/**
 * Keeps up to `limit` released display objects for reuse, so churning actors skip
 * construction and teardown. Releases beyond the limit, and every kept item when the
 * pool itself is disposed, go through `dispose`.
 */
export const createRecyclePool = <T>(options: {
  limit: number;
  dispose: (item: T) => void;
}) => {
  const items: T[] = [];
  return {
    /** A released item ready to reset, or undefined when the pool is empty. */
    take: () => items.pop(),
    release: (item: T) => {
      if (items.length < options.limit) items.push(item);
      else options.dispose(item);
    },
    dispose: () => {
      for (const item of items.splice(0)) options.dispose(item);
    },
    size: () => items.length,
  };
};
