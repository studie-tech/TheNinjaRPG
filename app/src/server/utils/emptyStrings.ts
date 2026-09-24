import { getTableColumns, type Table } from "drizzle-orm";
import { setValueOnObj } from "@/utils/typeutils";

/**
 * Reset all empty-string fields on an object back to null, undoing what
 * `setNullsToEmptyStrings` does for forms before the data is written back.
 *
 * Pass the drizzle table the object is written to so that NOT NULL columns are
 * left alone: those reject SQL NULL, and an empty string is the intended
 * "no value" for them (e.g. `Item.battleDescription`, which defaults to '').
 */
export const setEmptyStringsToNulls = (
  object: Record<string, unknown> | undefined | null,
  table?: Table,
) => {
  if (object) {
    const columns = table ? getTableColumns(table) : undefined;
    let propertyKey: keyof typeof object;
    for (propertyKey in object) {
      if (object[propertyKey] !== "") continue;
      if (columns?.[propertyKey]?.notNull) continue;
      setValueOnObj(object, propertyKey, null);
    }
  }
};
