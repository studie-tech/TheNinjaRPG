import { isPlainObject } from "@/utils/typeutils";

/** Preserve equal profile branches, including Dates decoded by SuperJSON. */
export const shareUserCache = (
  previous: unknown,
  next: unknown,
  depth = 0,
): unknown => {
  if (previous === next) return previous;
  if (depth > 500) return next;
  if (previous instanceof Date && next instanceof Date)
    return previous.getTime() === next.getTime() ? previous : next;

  if (Array.isArray(previous) && Array.isArray(next)) {
    // Query responses contain dense arrays. Leave other array shapes untouched.
    if (
      Object.keys(previous).length !== previous.length ||
      Object.keys(next).length !== next.length
    )
      return next;
    let equal = previous.length === next.length;
    let shared: unknown[] | undefined;
    for (let index = 0; index < next.length; index++) {
      const value = shareUserCache(previous[index], next[index], depth + 1);
      if (value !== previous[index]) equal = false;
      if (value !== next[index]) {
        shared ??= [...next];
        shared[index] = value;
      }
    }
    return equal ? previous : (shared ?? next);
  }

  if (isShareableRecord(previous) && isShareableRecord(next)) {
    const keys = Object.keys(next);
    let equal = Object.keys(previous).length === keys.length;
    let shared: Record<string, unknown> | undefined;
    for (const key of keys) {
      const own = Object.hasOwn(previous, key),
        before = own ? previous[key] : undefined;
      const nextValue = next[key];
      const value = shareUserCache(before, nextValue, depth + 1);
      if (!own || value !== before) equal = false;
      if (value !== nextValue) {
        shared ??= { ...next };
        shared[key] = value;
      }
    }
    return equal ? previous : (shared ?? next);
  }
  return next;
};

const isShareableRecord = (value: unknown): value is Record<string, unknown> =>
  isPlainObject(value) && Object.getPrototypeOf(value) === Object.prototype;
