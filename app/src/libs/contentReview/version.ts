import { createHash } from "node:crypto";
import { canonicalJson } from "@/utils/canonicalJson";

/** Whether two values are equal once canonicalized. */
export const sameValue = (a: unknown, b: unknown) =>
  canonicalJson(a) === canonicalJson(b);

/**
 * Version of an entity: the first 16 hex characters of sha256 over its editable fields.
 * Counters and timestamps are not editable fields, so only real content edits change it.
 */
export const contentVersion = (editable: Record<string, unknown>) =>
  createHash("sha256").update(canonicalJson(editable)).digest("hex").slice(0, 16);

/**
 * Version of an entity that does not exist. No content hashes to it, so a suggestion resting
 * on a deleted entity never matches the live version.
 */
export const MISSING_VERSION = "0000000000000000";
