import { and, eq, getTableColumns, is, SQL, sql } from "drizzle-orm";
import { userData } from "@/drizzle/schema";
import { nextSnapshotSql } from "@/queries/concurrency";
import { findUserDataForQueryUpdatedUser } from "@/queries/profile";
import type { DrizzleClient } from "@/server/db";
import type {
  ActionReadiness,
  ActionReadinessWrite,
} from "@/server/utils/actionReadiness";

/** Build recovery for actions with no account write; callers await it in their existing mutation phase. */
export const updateUserForActionReadiness = (
  client: Pick<DrizzleClient, "update">,
  readiness: ActionReadiness,
  updatedAt?: Date,
) =>
  readiness.notice
    ? client
        .update(userData)
        .set({
          ...readiness.set,
          updatedAt: updatedAt ?? nextSnapshotSql(userData.updatedAt),
        })
        .where(and(eq(userData.userId, readiness.initial.userId), readiness.where))
    : Promise.resolve({ rowsAffected: 1 });

/**
 * Emit recovery assignments for a guarded joined update, omitting status by default.
 * Callers omit any other activity or pool fields they own. Each assignment ends with
 * a comma so the endpoint's remaining SET assignments can follow the fragment.
 */
export const actionReadinessSqlSet = (
  readiness?: ActionReadinessWrite,
  omit: readonly string[] = ["status"],
) => {
  const columns = getTableColumns(userData);
  const assignments = Object.entries(readiness?.set ?? {}).flatMap(([key, value]) => {
    const column = columns[key as keyof typeof columns];
    return column && !omit.includes(key)
      ? [sql`${column} = ${is(value, SQL) ? value : sql.param(value, column)},`]
      : [];
  });
  return sql.join(assignments, sql` `);
};

/** Load an action actor with the existing profile snapshot query, without running hydration or settlement reads. */
export const fetchActionUser = async (client: DrizzleClient, userId: string) => {
  const user = await findUserDataForQueryUpdatedUser(client, userId);
  if (!user) throw new Error("User not found");
  return user;
};
