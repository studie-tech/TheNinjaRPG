import { sql } from "drizzle-orm";
import type { AnyMySqlColumn } from "drizzle-orm/mysql-core";

/**
 * A hash of every column of a definition table but its `live` ones. Any write to those
 * columns changes it, whichever path makes the write (editor, gameplay, migration or
 * console), so it identifies the content a cached definition holds.
 */
export const revisionSql =
  <Columns extends Record<string, AnyMySqlColumn>>(
    columns: Columns,
    live: Partial<Record<keyof Columns, true>>,
  ) =>
  (table: Columns) =>
    sql<string>`SHA2(JSON_ARRAY(${sql.join(
      Object.keys(columns)
        .filter((key) => !(key in live))
        .map((key) => table[key]),
      sql`, `,
    )}), 256)`;
