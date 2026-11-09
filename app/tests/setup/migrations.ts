import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect } from "bun:test";
import mysql from "mysql2/promise";

type MigrationQuery = <T extends mysql.QueryResult = mysql.QueryResult>(
  statement: string,
  values?: unknown[],
) => Promise<[T, mysql.FieldPacket[]]>;

/** Migration SQL, which runs as one multi-statement query and must stay free of breakpoints. */
export const readMigration = async (file: string) => {
  const migration = await readFile(`drizzle/migrations/${file}`, "utf8");
  expect(migration).not.toContain("--> statement-breakpoint");
  return migration;
};

/**
 * Run a migration test against randomly prefixed copies of tables from one schema snapshot.
 * `baseline` tables start from the snapshot, `created` tables are the ones the migration adds, and
 * `query` rewrites every listed name so migration SQL runs unchanged; the copies are always dropped.
 */
export const withMigrationSandbox = async (
  {
    snapshot,
    baseline,
    created = [],
    secondaryIndexes = false,
  }: {
    snapshot: string;
    baseline: string[];
    created?: string[];
    secondaryIndexes?: boolean;
  },
  run: (sandbox: {
    query: MigrationQuery;
    tables: Record<string, SnapshotTable>;
  }) => Promise<void>,
) => {
  const connection = await mysql.createConnection({
    uri: process.env.TEST_MYSQL_URL,
    multipleStatements: true,
  });
  const prefix = `m_${randomUUID().replaceAll("-", "")}_`;
  const names = [...baseline, ...created];
  const tableNames = new RegExp(`\\b(${names.join("|")})\\b`, "g");
  const query: MigrationQuery = (statement, values) =>
    connection.query(statement.replace(tableNames, `${prefix}$1`), values);
  try {
    const { tables } = JSON.parse(
      await readFile(`drizzle/migrations/meta/${snapshot}_snapshot.json`, "utf8"),
    ) as { tables: Record<string, SnapshotTable> };
    for (const name of baseline) {
      const table = tables[name];
      if (!table) throw new Error(`${name} missing from the ${snapshot} snapshot`);
      await query(baselineTableSql(table));
      if (!secondaryIndexes) continue;
      for (const index of Object.values(table.indexes).filter(
        (entry) => !entry.isUnique,
      )) {
        await query(
          `CREATE INDEX ${quoteIdentifier(index.name)} ON ${name} (${index.columns.map(quoteIdentifier).join(", ")})`,
        );
      }
    }
    await run({ query, tables });
  } finally {
    await connection.query(
      `DROP TABLE IF EXISTS ${names.map((name) => quoteIdentifier(prefix + name)).join(", ")}`,
    );
    await connection.end();
  }
};

/** Reconstructs a pre-migration table from its snapshot for isolated migration validation. */
export const baselineTableSql = (table: SnapshotTable) => {
  const definitions = Object.values(table.columns).map(
    (column) =>
      `${quoteIdentifier(column.name)} ${column.type}${column.generated ? ` GENERATED ALWAYS AS (${column.generated.as}) ${column.generated.type.toUpperCase()}` : ""}${column.notNull ? " NOT NULL" : ""}${column.default !== undefined ? ` DEFAULT ${String(column.default).replaceAll("\\'", "'")}` : ""}`,
  );
  for (const key of Object.values(table.compositePrimaryKeys)) {
    definitions.push(`PRIMARY KEY (${key.columns.map(quoteIdentifier).join(", ")})`);
  }
  for (const index of Object.values(table.indexes).filter((index) => index.isUnique)) {
    definitions.push(
      `UNIQUE KEY ${quoteIdentifier(index.name)} (${index.columns.map(quoteIdentifier).join(", ")})`,
    );
  }
  for (const constraint of Object.values(table.uniqueConstraints ?? {})) {
    definitions.push(
      `UNIQUE KEY ${quoteIdentifier(constraint.name)} (${constraint.columns.map(quoteIdentifier).join(", ")})`,
    );
  }
  return `CREATE TABLE ${quoteIdentifier(table.name)} (${definitions.join(", ")})`;
};

/** Quote a MySQL fixture identifier, including any embedded backticks. */
export const quoteIdentifier = (name: string) => `\`${name.replaceAll("`", "``")}\``;

export type SnapshotTable = {
  name: string;
  columns: Record<
    string,
    {
      name: string;
      type: string;
      notNull: boolean;
      default?: unknown;
      generated?: { as: string; type: "stored" | "virtual" };
    }
  >;
  compositePrimaryKeys: Record<string, { columns: string[] }>;
  indexes: Record<string, { name: string; columns: string[]; isUnique: boolean }>;
  uniqueConstraints?: Record<string, { name: string; columns: string[] }>;
};
