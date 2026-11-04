/**
 * Field paths of audit suggestions, for the CI scripts that run outside the app. Mirrors
 * setAtPath in app/src/libs/contentReview/paths.ts so verify mode only draws suggestions the
 * server can apply; app/tests/app/proposal-paths.test.ts keeps the two in agreement.
 */
const FORBIDDEN_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);

export const isSafePath = (fieldPath) =>
  !fieldPath.split(".").some((segment) => FORBIDDEN_SEGMENTS.has(segment));

/**
 * Set a dotted path in place. An array index must address an existing element or the next
 * free slot. Throws when the path cannot be written.
 */
export const setAtPath = (target, fieldPath, value) => {
  const keys = fieldPath.split(".");
  let node = target;
  for (const [index, key] of keys.entries()) {
    const isLast = index === keys.length - 1;
    if (Array.isArray(node)) {
      if (!/^\d+$/.test(key)) throw new Error(`Path ${fieldPath}: expected an index`);
      if (Number(key) > node.length) {
        throw new Error(`Path ${fieldPath}: index out of range`);
      }
      if (!isLast) node[key] ??= {};
    } else if (node === null || typeof node !== "object") {
      throw new Error(`Path ${fieldPath}: cannot write inside a non-object`);
    }
    if (isLast) node[key] = value;
    node = node[key];
  }
};
