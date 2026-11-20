import { getTableColumns, inArray, sql } from "drizzle-orm";
import type { AnyMySqlColumn } from "drizzle-orm/mysql-core";
import { quest } from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";

type QuestColumns = (typeof quest)["_"]["columns"];

/** Quest columns combat writes during a raid; revision reads take them live. */
const raidStateColumns = {
  id: true,
  raidBossCurrentHealth: true,
  raidStartedAt: true,
  raidEndsAt: true,
  raidCaptureDeadline: true,
  raidGracePeriodEnd: true,
} as const;

/**
 * A hash of every quest column but the live raid state. Any write to the definition
 * changes it, whichever path makes the write (editor, migration or console), so it
 * identifies the content a cached definition holds.
 */
const questRevisionSql = (table: QuestColumns) =>
  sql<string>`SHA2(JSON_ARRAY(${sql.join(
    Object.entries(getTableColumns(quest))
      .filter(([key]) => !(key in raidStateColumns))
      .map(([key]) => table[key as keyof QuestColumns] as AnyMySqlColumn),
    sql`, `,
  )}), 256)`;

/** The quest relation of a history read that resolves definitions by revision. */
export const questRevisionRelation = {
  columns: raidStateColumns,
  extras: (table: QuestColumns) => ({
    revision: questRevisionSql(table).as("revision"),
  }),
};

/** The quest columns of a select that resolves definitions by revision. */
export const questRevisionColumns = {
  id: quest.id,
  raidBossCurrentHealth: quest.raidBossCurrentHealth,
  raidStartedAt: quest.raidStartedAt,
  raidEndsAt: quest.raidEndsAt,
  raidCaptureDeadline: quest.raidCaptureDeadline,
  raidGracePeriodEnd: quest.raidGracePeriodEnd,
  revision: questRevisionSql(quest),
} satisfies Record<keyof typeof raidStateColumns | "revision", unknown>;

/** Build the `quest` selection of complete definitions and their revisions. */
export const selectQuestRevisionDefinitions = (
  client: Pick<DrizzleClient, "select">,
  questIds: string[],
) =>
  client
    .select({ definition: quest, revision: questRevisionSql(quest) })
    .from(quest)
    .where(inArray(quest.id, questIds));
