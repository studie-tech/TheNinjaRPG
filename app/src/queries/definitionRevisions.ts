/**
 * Content revisions of definition tables, read in place of whole rows by player reads
 * whose definitions come from `createDefinitionCache`.
 */

import { getTableColumns, type SQL, sql, type Table } from "drizzle-orm";
import type { AnyMySqlColumn } from "drizzle-orm/mysql-core";

/**
 * A hash of every column of `table` but its `live` ones. Any write to those columns
 * changes it, whichever path makes the write (editor, gameplay, migration or console),
 * so it identifies the content a cached definition holds. `columns` may belong to an
 * alias of the table, as relational `extras` receive.
 */
export const revisionSql = <T extends Table>(
  table: T,
  live: Partial<Record<keyof T["_"]["columns"], true>> = { id: true } as never,
) => {
  const keys = Object.keys(getTableColumns(table)).filter((key) => !(key in live));
  return (columns: Record<string, unknown> = getTableColumns(table)): SQL<string> =>
    sql<string>`SHA2(JSON_ARRAY(${sql.join(
      keys.map((key) => columns[key] as AnyMySqlColumn),
      sql`, `,
    )}), 256)`;
};
