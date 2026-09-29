import type { ContentProposalMediaKind } from "@/drizzle/constants";

/**
 * Dotted paths into an entity's editable fields: "description", "effects.0.power",
 * "content.objectives.2.description". The first segment is always a top-level field.
 */
export const pathSegments = (path: string) => path.split(".");

export const topLevelField = (path: string) => pathSegments(path)[0] ?? path;

const FORBIDDEN_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);

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
 * silently pad an effect list with holes.
 */
export const setAtPath = <T>(root: T, path: string, value: unknown): T => {
  const segments = pathSegments(path);
  if (segments.some((segment) => FORBIDDEN_SEGMENTS.has(segment))) {
    throw new Error(`Path ${path} is not allowed`);
  }
  const write = (node: unknown, index: number): unknown => {
    const segment = segments[index] as string;
    const last = index === segments.length - 1;
    if (Array.isArray(node)) {
      if (!/^\d+$/.test(segment)) throw new Error(`Path ${path}: expected an index`);
      const position = Number(segment);
      if (position > node.length) throw new Error(`Path ${path}: index out of range`);
      const copy = [...node];
      copy[position] = last ? value : write(node[position] ?? {}, index + 1);
      return copy;
    }
    if (node === null || typeof node !== "object") {
      throw new Error(`Path ${path}: cannot write inside a non-object`);
    }
    const copy = { ...(node as Record<string, unknown>) };
    copy[segment] = last ? value : write(copy[segment], index + 1);
    return copy;
  };
  return write(root, 0) as T;
};

/** Fields that hold media of each kind: asset ids for sounds and animations, URLs for images. */
const MEDIA_FIELDS: Record<ContentProposalMediaKind, readonly string[]> = {
  SFX: ["appearSfx", "disappearSfx"],
  ANIMATION: ["appearAnimation", "staticAnimation", "disappearAnimation"],
  IMAGE: ["image", "avatar"],
};

/** Whether `path` names a field a media candidate of `kind` may fill. */
export const isMediaPath = (kind: ContentProposalMediaKind, path: string) => {
  const last = pathSegments(path).pop() ?? "";
  return MEDIA_FIELDS[kind].includes(last);
};
