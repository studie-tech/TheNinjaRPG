import type { ContentProposalMediaKind } from "@/drizzle/constants";

/**
 * Top-level field a path starts in. Paths are dotted into an entity's editable fields:
 * "description", "effects.0.power", "content.objectives.2.description".
 */
export const topLevelField = (path: string) => pathSegments(path)[0] ?? path;

/** Value at `path`, or undefined when any segment is missing. */
export const getAtPath = (root: unknown, path: string): unknown => {
  let node = root;
  for (const segment of pathSegments(path)) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[segment];
  }
  return node;
};

/**
 * Copy of `root` with `value` written at `path`. Only containers along the path are copied.
 * Array indices must address an existing element or the next free slot, so a typo cannot
 * silently pad an effect list with holes. Throws when the path cannot be written.
 */
export const setAtPath = <T>(root: T, path: string, value: unknown): T => {
  const segments = pathSegments(path);
  if (segments.some((segment) => FORBIDDEN_SEGMENTS.has(segment))) {
    throw new Error(`Path ${path} is not allowed`);
  }
  const write = (node: unknown, index: number): unknown => {
    const segment = segments[index] as string;
    const isLast = index === segments.length - 1;
    if (Array.isArray(node)) {
      if (!/^\d+$/.test(segment)) throw new Error(`Path ${path}: expected an index`);
      const position = Number(segment);
      if (position > node.length) throw new Error(`Path ${path}: index out of range`);
      const copy = [...node];
      copy[position] = isLast ? value : write(node[position] ?? {}, index + 1);
      return copy;
    }
    if (node === null || typeof node !== "object") {
      throw new Error(`Path ${path}: cannot write inside a non-object`);
    }
    const copy = { ...(node as Record<string, unknown>) };
    copy[segment] = isLast ? value : write(copy[segment], index + 1);
    return copy;
  };
  return write(root, 0) as T;
};

/** Whether `path` names a field a media candidate of `kind` may fill. */
export const isMediaPath = (kind: ContentProposalMediaKind, path: string) => {
  const last = pathSegments(path).pop() ?? "";
  return MEDIA_FIELDS[kind].includes(last);
};

const pathSegments = (path: string) => path.split(".");

/** Segments that would write into an object's prototype instead of the object. */
const FORBIDDEN_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);

/** Fields that hold each media kind: asset ids for sounds and animations, URLs for images. */
const MEDIA_FIELDS: Record<ContentProposalMediaKind, readonly string[]> = {
  SFX: ["appearSfx", "disappearSfx"],
  ANIMATION: ["appearAnimation", "staticAnimation", "disappearAnimation"],
  IMAGE: ["image", "avatar"],
};
