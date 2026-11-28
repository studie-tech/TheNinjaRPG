/**
 * JSON with object keys sorted at every level, so two equal values always serialize to the
 * same string no matter how the database or a client ordered their keys. Dates become ISO
 * strings and undefined object fields are dropped, as JSON.stringify would do.
 */
export const canonicalJson = (value: unknown): string =>
  JSON.stringify(normalize(value)) ?? "null";

const normalize = (value: unknown): unknown => {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((entry) => normalize(entry ?? null));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
        .map((key) => [key, normalize((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
};
