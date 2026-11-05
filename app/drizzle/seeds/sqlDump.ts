import { sql } from "drizzle-orm";
import { promises as fs } from "fs";
import type { DrizzleClient } from "@/server/db";

/**
 * Run a checked-in SQL dump from `data/` one statement at a time. Statements end with a
 * semicolon at the end of a line, so semicolons inside JSON values stay intact.
 */
export const executeSqlDump = async (client: DrizzleClient, file: string) => {
  const dump = await fs.readFile(`${process.cwd()}/data/${file}`, "utf8");
  for (const statement of dump.split(/;\s*$/m)) {
    if (statement.trim()) await client.execute(sql.raw(`${statement.trim()};`));
  }
};
