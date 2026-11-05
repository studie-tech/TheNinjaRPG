import { timingSafeEqual } from "node:crypto";

/**
 * Compare a secret without leaking where it differs. `timingSafeEqual` throws on a byte
 * length mismatch, so lengths are compared first. Equal empty strings match, so callers
 * keep their own guard against a missing secret.
 */
export const constantTimeEquals = (a: string, b: string): boolean => {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
};
