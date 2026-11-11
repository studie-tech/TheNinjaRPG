import { detailedDiff } from "deep-object-diff";
import { flattenLeaves } from "@/utils/wordDiff";

/**
 * Calculates the difference between two objects using the `detailedDiff` function.
 * Abstracted out into a wrapper such that we can easily swap out the diffing library.
 *
 * @param oldContent - The old content object.
 * @param newContent - The new content object.
 * @returns The detailed difference between the old and new content objects.
 */
export const calculateContentDiff = (oldContent: object, newContent: object) => {
  const diff = detailedDiff(oldContent, newContent);
  const result: string[] = [];
  if (Object.keys(diff.added).length > 0) {
    result.push(`Added: ${JSON.stringify(diff.added)}`);
  }
  if (Object.keys(diff.deleted).length > 0) {
    result.push(`Deleted: ${JSON.stringify(diff.deleted)}`);
  }
  if (Object.keys(diff.updated).length > 0) {
    result.push(`Updated: ${JSON.stringify(diff.updated)}`);
  }
  return result;
};

/**
 * Field-level reading of one `calculateContentDiff` line for display: the kind of change
 * and each changed field path with its new value. Deleted fields carry no value, since
 * the stored diff drops them. Returns `null` for any other log text, which callers show
 * as written.
 */
export const parseContentChange = (change: string): ParsedContentChange | null => {
  const match = /^(Added|Deleted|Updated): (.*)$/s.exec(change);
  if (!match?.[1] || match[2] === undefined) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[2]);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const kind = match[1] as ParsedContentChange["kind"];
  const fields = [...flattenLeaves(parsed)].map(([path, value]) => ({
    path: path || "(root)",
    value: kind === "Deleted" ? undefined : formatChangeValue(value),
  }));
  return { kind, fields };
};

const formatChangeValue = (value: unknown) =>
  typeof value === "string" ? value : JSON.stringify(value);

export type ParsedContentChange = {
  kind: "Added" | "Deleted" | "Updated";
  fields: { path: string; value: string | undefined }[];
};
