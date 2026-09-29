import { createHash } from "node:crypto";

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

/** Whether two values are equal once canonicalized. */
export const sameValue = (a: unknown, b: unknown) =>
  canonicalJson(a) === canonicalJson(b);

/**
 * Version of an entity: the first 16 hex characters of sha256 over its editable fields.
 * Counters and timestamps are not editable fields, so only real content edits change it.
 */
export const contentVersion = (editable: Record<string, unknown>) =>
  createHash("sha256").update(canonicalJson(editable)).digest("hex").slice(0, 16);

/** Version recorded for an entity that no longer exists. */
export const MISSING_VERSION = "0000000000000000";
