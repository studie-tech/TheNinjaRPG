/**
 * Database access for cleaner; authorization and transaction scopes stay in callers.
 */
import {
  and,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  like,
  lt,
  lte,
  notExists,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import type { AnyMySqlColumn, MySqlTable, TableConfig } from "drizzle-orm/mysql-core";
import { MODERATION_SCAN_RETENTION_DAYS } from "@/drizzle/constants";
import {
  anbuSquad,
  automatedModeration,
  battle,
  battleAction,
  battleHistory,
  captcha,
  clan,
  conversation,
  conversationComment,
  dailyBankInterest,
  dataBattleAction,
  forumPost,
  historicalAvatar,
  historicalIp,
  huntingSession,
  moderationScan,
  mpvpBattleQueue,
  mpvpBattleUser,
  questHistory,
  rankedPvpQueue,
  trainingLog,
  userActivityEvent,
  userData,
  userLiveActivity,
  userNindo,
  userRequest,
  village,
  warAlly,
  warKill,
} from "@/drizzle/schema";
import { combatEnergyRecoverySql } from "@/libs/combat/database";
import { withoutDungeonReservation } from "@/queries/dungeonReservation";
import type { DrizzleClient } from "@/server/db";
import { resumeBracketImmunitySql } from "@/server/utils/objectiveWar";
import { secondsFromNow } from "@/utils/time";

/** Build the `battle` deletion for `GET`, using predicates on `updatedAt`. */
export const deleteBattleForGET = (
  client: Pick<DrizzleClient, "delete">,
  rangeCleanupBatchSize: 10000,
) =>
  client
    .delete(battle)
    .where(lt(battle.updatedAt, sql`CURRENT_TIMESTAMP(3) - INTERVAL 1 DAY`))
    .orderBy(battle.updatedAt)
    .limit(rangeCleanupBatchSize);

/**
 * Build the `huntingSession` update for `GET`, setting `battleId` and `version`, using
 * predicates on `battleId` and `id`.
 */
export const updateHuntingSessionForGET = (
  client: Pick<DrizzleClient, "update" | "select">,
) =>
  client
    .update(huntingSession)
    .set({ battleId: null, version: sql`${huntingSession.version} + 1` })
    .where(
      and(
        isNotNull(huntingSession.battleId),
        notExists(
          client
            .select({ id: battle.id })
            .from(battle)
            .where(eq(battle.id, huntingSession.battleId)),
        ),
      ),
    );

/** Build the `userData` update for `GET`, using predicates on `battleId` and `id`. */
export const updateUserDataForGET = (
  client: Pick<DrizzleClient, "update" | "select">,
) =>
  client
    .update(userData)
    .set({
      // Missing battle metadata falls back to base Energy recovery.
      curEnergy: sql`CASE WHEN ${userData.status} = 'BATTLE' THEN ${combatEnergyRecoverySql()} ELSE ${userData.curEnergy} END`,
      regenAt: sql`CASE WHEN ${userData.status} = 'BATTLE' THEN NOW(3) ELSE ${userData.regenAt} END`,
      updatedAt: sql`GREATEST(NOW(3), TIMESTAMPADD(MICROSECOND, 1000, ${userData.updatedAt}))`,
      bracketImmunityLiftedUntil: resumeBracketImmunitySql(),
      bracketImmunityPausedAt: null,
      battleId: null,
      status: sql`CASE WHEN EXISTS (SELECT 1 FROM ${questHistory} WHERE ${questHistory.userId} = ${userData.userId} AND ${questHistory.isolated} = TRUE AND ${questHistory.completed} = 0 AND ${questHistory.endAt} IS NULL) THEN 'BATTLE' ELSE 'AWAKE' END`,
      travelFinishAt: null,
    })
    .where(
      and(
        isNotNull(userData.battleId),
        notExists(
          client
            .select({ id: battle.id })
            .from(battle)
            .where(eq(battle.id, userData.battleId)),
        ),
      ),
    );

/** Build the `userLiveActivity` deletion for `GET`, using predicates on `endsAt`. */
export const deleteUserLiveActivityForGET = (
  client: Pick<DrizzleClient, "delete">,
  oneDay: number,
) =>
  client
    .delete(userLiveActivity)
    .where(lt(userLiveActivity.endsAt, new Date(Date.now() - oneDay)));

/** Build the `battleAction` deletion for `GET`, using predicates on `updatedAt`. */
export const deleteBattleActionForGET = (
  client: Pick<DrizzleClient, "delete">,
  backlogCleanupBatchSize: 10000,
) =>
  client
    .delete(battleAction)
    .where(lt(battleAction.updatedAt, sql`DATE_SUB(NOW(), INTERVAL 72 HOUR)`))
    .orderBy(battleAction.updatedAt)
    .limit(backlogCleanupBatchSize);

/** Execute the database statement for `GET`. */
export const executeRowsForGET = (
  client: Pick<DrizzleClient, "execute">,
  pvpTypes: readonly [
    "SPARRING",
    "CLAN_BATTLE",
    "TOURNAMENT",
    "RANKED_SPARRING",
    "KAGE_PVP",
    "COMBAT",
    "RANKED_PVP",
  ],
  cleanupBatchSize: 1000,
) =>
  client.execute(
    sql`DELETE target
          FROM (
            SELECT id FROM (
              SELECT STRAIGHT_JOIN source.id
              FROM ${battleAction} source
              FORCE INDEX (BattleAction_updatedAt_battleId_idx)
              LEFT JOIN ${battleHistory} h ON source.battleId = h.battleId
              LEFT JOIN ${battle} b ON source.battleId = b.id
              WHERE source.updatedAt >= DATE_SUB(NOW(), INTERVAL 72 HOUR)
              AND source.updatedAt < DATE_SUB(NOW(), INTERVAL 12 HOUR)
              AND (
                (
                  h.battleId IS NULL
                  AND b.id IS NULL
                )
                OR (
                  h.battleId IS NOT NULL
                  AND (
                    h.battleType NOT IN (${sql.join(
                      pvpTypes.map((t) => sql`${t}`),
                      sql`, `,
                    )})
                    OR h.battleType IS NULL
                  )
                )
              )
              ORDER BY source.updatedAt
              LIMIT ${cleanupBatchSize}
            ) limited
          ) expired
          STRAIGHT_JOIN ${battleAction} target FORCE INDEX (PRIMARY)
            ON target.id = expired.id`,
  );

/** Execute the database statement for `GET`. */
export const executeRowsForGET2 = (
  client: Pick<DrizzleClient, "execute">,
  pvpTypes: readonly [
    "SPARRING",
    "CLAN_BATTLE",
    "TOURNAMENT",
    "RANKED_SPARRING",
    "KAGE_PVP",
    "COMBAT",
    "RANKED_PVP",
  ],
  cleanupBatchSize: 1000,
) =>
  client.execute(
    sql`DELETE target
          FROM (
            SELECT id FROM (
              SELECT source.id
              FROM ${battleHistory} source
              FORCE INDEX (BattleHistory_createdAt_idx)
              WHERE source.createdAt < DATE_SUB(NOW(), INTERVAL 12 HOUR)
              AND (
                (
                  source.battleType IN (${sql.join(
                    pvpTypes.map((t) => sql`${t}`),
                    sql`, `,
                  )})
                  AND source.createdAt < DATE_SUB(NOW(), INTERVAL 72 HOUR)
                )
                OR source.battleType NOT IN (${sql.join(
                  pvpTypes.map((t) => sql`${t}`),
                  sql`, `,
                )})
                OR source.battleType IS NULL
              )
              AND NOT EXISTS (
                SELECT 1 FROM ${battleAction} a
                FORCE INDEX (BattleAction_round_key)
                WHERE a.battleId = source.battleId
              )
              ORDER BY source.createdAt
              LIMIT ${cleanupBatchSize}
            ) limited
          ) expired
          STRAIGHT_JOIN ${battleHistory} target FORCE INDEX (PRIMARY)
            ON target.id = expired.id`,
  );

/** Build the `conversation` deletion for `GET`, using predicates on `updatedAt`, `isPublic`, `isStaffAvailable`. */
export const deleteConversationForGET = (
  client: Pick<DrizzleClient, "delete">,
  oneDay: number,
) =>
  client
    .delete(conversation)
    .where(
      and(
        lte(conversation.updatedAt, new Date(Date.now() - oneDay * 14)),
        eq(conversation.isPublic, false),
        eq(conversation.isStaffAvailable, false),
      ),
    );

/** Execute the database statement for `GET`. */
export const executeRowsForGET3 = (client: Pick<DrizzleClient, "execute">) =>
  client.execute(
    sql`
        DELETE a FROM ${conversationComment} a
        INNER JOIN ${conversation} b ON a.conversationId = b.id
        WHERE a.createdAt < CURRENT_TIMESTAMP(3) - INTERVAL 14 DAY
          AND b.isStaffAvailable = false
          AND (b.isPublic = false OR b.title IS NULL OR b.title != 'Global')
      `,
  );

/** Execute the database statement for `GET`. */
export const executeRowsForGET4 = (client: Pick<DrizzleClient, "execute">) =>
  client.execute(
    sql`
        DELETE a FROM ${conversationComment} a
        INNER JOIN ${conversation} b ON a.conversationId = b.id
        WHERE b.isPublic AND b.title != 'Global' AND a.createdAt < CURRENT_TIMESTAMP(3) - INTERVAL 2 DAY AND b.isStaffAvailable = false`,
  );

/** Build the `historicalAvatar` deletion for `GET`, using predicates on `createdAt` and `avatar`. */
export const deleteHistoricalAvatarForGET = (client: Pick<DrizzleClient, "delete">) =>
  client
    .delete(historicalAvatar)
    .where(
      and(
        lt(historicalAvatar.createdAt, secondsFromNow(-3600 * 3)),
        isNull(historicalAvatar.avatar),
      ),
    );

/** Build the `userData` update for `GET`, setting `clanId`, using predicates on `clanId` and `id`. */
export const updateUserDataForGET2 = (
  client: Pick<DrizzleClient, "update" | "select">,
) =>
  client
    .update(userData)
    .set({ clanId: null })
    .where(
      and(
        isNotNull(userData.clanId),
        notExists(
          client.select({ id: clan.id }).from(clan).where(eq(clan.id, userData.clanId)),
        ),
      ),
    );

/** Build the `trainingLog` deletion for `GET`, using predicates on `trainingFinishedAt`. */
export const deleteTrainingLogForGET = (
  client: Pick<DrizzleClient, "delete">,
  rangeCleanupBatchSize: 10000,
) =>
  client
    .delete(trainingLog)
    .where(
      lt(trainingLog.trainingFinishedAt, sql`CURRENT_TIMESTAMP(3) - INTERVAL 7 DAY`),
    )
    .orderBy(trainingLog.trainingFinishedAt)
    .limit(rangeCleanupBatchSize);

/** Build the `mpvpBattleQueue` deletion for `GET`, using predicates on `createdAt`. */
export const deleteMpvpBattleQueueForGET = (
  client: Pick<DrizzleClient, "delete">,
  rangeCleanupBatchSize: 10000,
) =>
  client
    .delete(mpvpBattleQueue)
    .where(lt(mpvpBattleQueue.createdAt, sql`CURRENT_TIMESTAMP(3) - INTERVAL 7 DAY`))
    .orderBy(mpvpBattleQueue.createdAt)
    .limit(rangeCleanupBatchSize);

/** Build the `mpvpBattleQueue` selection for `GET`, using predicates on `id` and `clanBattleId`. */
export const selectMpvpBattleQueueForGET = (client: Pick<DrizzleClient, "select">) =>
  client
    .select({ id: mpvpBattleQueue.id })
    .from(mpvpBattleQueue)
    .where(eq(mpvpBattleQueue.id, mpvpBattleUser.clanBattleId))
    .limit(1);

/** Build the `userData` update for `GET`, setting `status`, including predicates on `status`, `id`, `userId`. */
export const updateUserDataForGET3 = (
  client: Pick<DrizzleClient, "update" | "select">,
) =>
  client
    .update(userData)
    .set({ status: "AWAKE" })
    .where(
      and(
        eq(userData.status, "QUEUED"),
        withoutDungeonReservation(),
        notExists(
          client
            .select({ id: mpvpBattleUser.id })
            .from(mpvpBattleUser)
            .where(eq(mpvpBattleUser.userId, userData.userId)),
        ),
        notExists(
          client
            .select({ id: rankedPvpQueue.id })
            .from(rankedPvpQueue)
            .where(
              and(
                eq(rankedPvpQueue.userId, userData.userId),
                eq(rankedPvpQueue.hasClaimed, true),
              ),
            ),
        ),
      ),
    );

/** Execute the database statement for `GET`. */
export const executeRowsForGET5 = (client: Pick<DrizzleClient, "execute">) =>
  client.execute(
    sql`UPDATE ${village} a SET a.populationCount = (SELECT COUNT(*) FROM ${userData} b WHERE b.villageId = a.id)`,
  );

/** Execute the database statement for `GET`. */
export const executeRowsForGET6 = (client: Pick<DrizzleClient, "execute">) =>
  client.execute(
    sql`UPDATE ${anbuSquad} a SET a.memberCount = (SELECT COUNT(*) FROM ${userData} b WHERE b.anbuId = a.id)`,
  );

/** Build the `captcha` deletion for `GET`, using predicates on `createdAt`. */
export const deleteCaptchaForGET = (
  client: Pick<DrizzleClient, "delete">,
  rangeCleanupBatchSize: 10000,
) =>
  client
    .delete(captcha)
    .where(lt(captcha.createdAt, sql`CURRENT_TIMESTAMP(3) - INTERVAL 30 DAY`))
    .orderBy(captcha.createdAt)
    .limit(rangeCleanupBatchSize);

/** Execute the database statement for `GET`. */
export const executeRowsForGET7 = (client: Pick<DrizzleClient, "execute">) =>
  client.execute(sql`
        DELETE r, wa FROM ${userRequest} r
        LEFT JOIN ${warAlly} wa ON wa.id = r.id AND wa.acceptedAt IS NULL
        WHERE r.createdAt < ${secondsFromNow(-3600 * 24)}
          AND NOT (r.type = 'HOME' AND r.status = 'ACCEPTED')
      `);

/** Execute the database statement for `GET`. */
export const executeRowsForGET8 = (client: Pick<DrizzleClient, "execute">) =>
  client.execute(
    sql`UPDATE ${userData} u INNER JOIN ${clan} c ON u.clanId = c.id SET u.villageId = c.villageId WHERE c.hasHideout = true AND u.villageId != c.villageId`,
  );

/** Execute the database statement for `GET`. */
export const executeRowsForGET9 = (client: Pick<DrizzleClient, "execute">) =>
  client.execute(
    sql`
            DELETE a FROM ${conversationComment} a
            INNER JOIN ${conversation} b ON a.conversationId = b.id
            WHERE b.isPublic AND b.title = 'Global'
              AND a.createdAt < CURRENT_TIMESTAMP(3) - INTERVAL 2 HOUR
          `,
  );

/** Execute the database statement for `GET`. */
export const executeRowsForGET10 = (client: Pick<DrizzleClient, "execute">) =>
  client.execute(
    sql`UPDATE ${userData} SET tavernMessages = FLOOR(tavernMessages * 0.95)`,
  );

/** Build the `automatedModeration` deletion for `GET`, using predicates on `createdAt`. */
export const deleteAutomatedModerationForGET = (
  client: Pick<DrizzleClient, "delete">,
  rangeCleanupBatchSize: 10000,
) =>
  client
    .delete(automatedModeration)
    .where(
      lt(automatedModeration.createdAt, sql`CURRENT_TIMESTAMP(3) - INTERVAL 3 MONTH`),
    )
    .orderBy(automatedModeration.createdAt)
    .limit(rangeCleanupBatchSize);

/** Build the `moderationScan` deletion for `GET`, using predicates on `createdAt`. */
export const deleteModerationScanForGET = (
  client: Pick<DrizzleClient, "delete">,
  rangeCleanupBatchSize: 10000,
) =>
  client
    .delete(moderationScan)
    .where(
      lt(
        moderationScan.createdAt,
        sql`CURRENT_TIMESTAMP(3) - INTERVAL ${MODERATION_SCAN_RETENTION_DAYS} DAY`,
      ),
    )
    .orderBy(moderationScan.createdAt)
    .limit(rangeCleanupBatchSize);

/** Build the `dailyBankInterest` deletion for `GET`, using predicates on `date`. */
export const deleteDailyBankInterestForGET = (
  client: Pick<DrizzleClient, "delete">,
  oldestDate: string,
  rangeCleanupBatchSize: 10000,
) =>
  client
    .delete(dailyBankInterest)
    .where(lt(dailyBankInterest.date, oldestDate))
    .orderBy(dailyBankInterest.date)
    .limit(rangeCleanupBatchSize);

/** Build the `dailyBankInterest` deletion for `GET`, using predicates on `claimed` and `updatedAt`. */
export const deleteDailyBankInterestForGET2 = (
  client: Pick<DrizzleClient, "delete">,
  rangeCleanupBatchSize: 10000,
) =>
  client
    .delete(dailyBankInterest)
    .where(
      and(
        eq(dailyBankInterest.claimed, true),
        lt(dailyBankInterest.updatedAt, sql`CURRENT_TIMESTAMP(3) - INTERVAL 2 DAY`),
      ),
    )
    .orderBy(dailyBankInterest.updatedAt)
    .limit(rangeCleanupBatchSize);

/** Build the `historicalIp` deletion for `GET`, using predicates on `usedAt`. */
export const deleteHistoricalIpForGET = (
  client: Pick<DrizzleClient, "delete">,
  rangeCleanupBatchSize: 10000,
) =>
  client
    .delete(historicalIp)
    .where(lt(historicalIp.usedAt, sql`CURRENT_TIMESTAMP(3) - INTERVAL 90 DAY`))
    .orderBy(historicalIp.usedAt)
    .limit(rangeCleanupBatchSize);

/** Build the `userActivityEvent` deletion for `GET`, using predicates on `createdAt`. */
export const deleteUserActivityEventForGET = (
  client: Pick<DrizzleClient, "delete">,
  rangeCleanupBatchSize: 10000,
) =>
  client
    .delete(userActivityEvent)
    .where(lt(userActivityEvent.createdAt, sql`CURRENT_TIMESTAMP(3) - INTERVAL 10 DAY`))
    .orderBy(userActivityEvent.createdAt)
    .limit(rangeCleanupBatchSize);

/** Build the `rankedPvpQueue` deletion for `GET`, using predicates on `createdAt`. */
export const deleteRankedPvpQueueForGET = (
  client: Pick<DrizzleClient, "delete">,
  rangeCleanupBatchSize: 10000,
) =>
  client
    .delete(rankedPvpQueue)
    .where(lt(rankedPvpQueue.createdAt, sql`CURRENT_TIMESTAMP(3) - INTERVAL 1 DAY`))
    .orderBy(rankedPvpQueue.createdAt)
    .limit(rangeCleanupBatchSize);

/** Build the `warKill` deletion for `GET`, using predicates on `killedAt`. */
export const deleteWarKillForGET = (
  client: Pick<DrizzleClient, "delete">,
  rangeCleanupBatchSize: 10000,
) =>
  client
    .delete(warKill)
    .where(lt(warKill.killedAt, sql`CURRENT_TIMESTAMP(3) - INTERVAL 30 DAY`))
    .orderBy(warKill.killedAt)
    .limit(rangeCleanupBatchSize);

/** Build the `dataBattleAction` deletion for `GET`, using predicates on `updatedAt`. */
export const deleteDataBattleActionForGET = (
  client: Pick<DrizzleClient, "delete">,
  rangeCleanupBatchSize: 10000,
) =>
  client
    .delete(dataBattleAction)
    .where(lt(dataBattleAction.updatedAt, sql`CURRENT_TIMESTAMP(3) - INTERVAL 30 DAY`))
    .orderBy(dataBattleAction.updatedAt)
    .limit(rangeCleanupBatchSize);

/** Build the `userNindo` listing for `GET`, using predicates on `content`. */
export const listUserNindoForGET = (client: Pick<DrizzleClient, "query">) =>
  client.query.userNindo.findMany({
    where: or(
      like(userNindo.content, "%http://%"),
      like(userNindo.content, "%https://%"),
    ),
  });

/** Build the `forumPost` listing for `listForumPostForGET`, using predicates on `content`. */
export const listForumPostForGET = (client: Pick<DrizzleClient, "query">) =>
  client.query.forumPost.findMany({
    where: or(
      like(forumPost.content, "%http://%"),
      like(forumPost.content, "%https://%"),
    ),
  });

/** Build the `table` update for `processContentUrls`, setting `content`, using the configured predicates. */
export const updateTableForProcessContentUrls = (
  client: Pick<DrizzleClient, "update">,
  table:
    | typeof import("@/drizzle/schema").forumPost
    | typeof import("@/drizzle/schema").userNindo,
  newContent: string,
  item: { id: string },
) => client.update(table).set({ content: newContent }).where(eq(table.id, item.id));

/** Build the `table` distinct selection for `deleteCleanupCandidates`, using the configured predicates. */
export const selectDistinctKeyForDeleteCleanupCandidates = (
  client: Pick<DrizzleClient, "selectDistinct">,
  key: Record<string, AnyMySqlColumn<{ data: string | number; notNull: true }>>,
  table: MySqlTable<TableConfig>,
  predicate: SQL<unknown>,
  previous: undefined | Record<string, string | number>,
  columns: [string, AnyMySqlColumn<{ data: string | number; notNull: true }>][],
  batchSize: number,
) =>
  client
    .selectDistinct(key)
    .from(table)
    .where(
      and(
        predicate,
        previous &&
          or(
            ...columns.map(([name, column], index) =>
              and(
                ...columns
                  .slice(0, index)
                  .map(([prefix, prefixColumn]) =>
                    eq(prefixColumn, cleanupKeyValue(previous, prefix)),
                  ),
                gt(column, cleanupKeyValue(previous, name)),
              ),
            ),
          ),
      ),
    )
    .orderBy(...columns.map(([, column]) => column))
    .limit(batchSize);

/**
 * Delete only the selected key batch while rechecking its predicate. Keep the
 * index/point-lookup strategy to bound scanned-row locks.
 */
export const executeStatementForDeleteCleanupCandidates = (
  client: Pick<DrizzleClient, "execute">,
  table: MySqlTable<TableConfig>,
  columns: [string, AnyMySqlColumn<{ data: string | number; notNull: true }>][],
  firstColumn: [string, AnyMySqlColumn<{ data: string | number; notNull: true }>],
  candidates: Record<string, string | number>[],
  predicate: SQL<unknown>,
  indexName: string,
) => {
  const [firstName, firstKey] = firstColumn;
  // Drizzle's DELETE builder cannot force an index. Scanned rows are locked
  // under REPEATABLE READ, including rows the predicate excludes.
  const selected =
    columns.length === 1
      ? inArray(
          firstKey,
          candidates.map((row) => cleanupKeyValue(row, firstName)),
        )
      : or(
          ...candidates.map((row) =>
            and(
              ...columns.map(([name, column]) =>
                eq(column, cleanupKeyValue(row, name)),
              ),
            ),
          ),
        );
  // FORCE INDEX still permits a full scan for a dense composite-key batch.
  // Drive those deletes from literal keys so each target access is a point lookup.
  const statement =
    columns.length > 1 && indexName === "PRIMARY"
      ? sql`DELETE /*+ SET_VAR(optimizer_switch='semijoin=off') */ ${table}
          FROM (${sql.join(
            candidates.map(
              (row) =>
                sql`SELECT ${sql.join(
                  columns.map(
                    ([name]) =>
                      sql`${cleanupKeyValue(row, name)} AS ${sql.identifier(name)}`,
                  ),
                  sql`, `,
                )}`,
            ),
            sql` UNION ALL `,
          )}) cleanup_keys
          STRAIGHT_JOIN ${table} FORCE INDEX (PRIMARY)
            ON ${and(...columns.map(([name, column]) => eq(column, sql`cleanup_keys.${sql.identifier(name)}`)))}
          WHERE ${predicate}`
      : sql`DELETE /*+ SET_VAR(optimizer_switch='semijoin=off') */ ${table}
          FROM ${table} FORCE INDEX (${sql.identifier(indexName)})
          WHERE ${and(selected, predicate)}`;
  return client.execute(statement);
};

/** Build the `parent` selection for `missing`, using the configured predicates. */
export const selectParentForMissing = (
  client: Pick<DrizzleClient, "select">,
  parentKey: AnyMySqlColumn,
  parent: MySqlTable<TableConfig>,
  childKey: AnyMySqlColumn,
) =>
  client.select({ id: parentKey }).from(parent).where(eq(parentKey, childKey)).limit(1);

/** Read one scalar cleanup key from a selected row; reject unsupported values before composing delete parameters. */
const cleanupKeyValue = (row: Record<string, string | number>, name: string) => {
  const value = row[name];
  if (value === undefined) throw new Error(`Missing cleanup key ${name}`);
  return value;
};
