import { detailedDiff } from "deep-object-diff";

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
