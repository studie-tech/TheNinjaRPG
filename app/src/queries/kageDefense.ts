import { clampActionLogText } from "@/utils/actionLog";
/**
 * Database access for kage defense; authorization and transaction scopes stay in callers.
 */

import { and, asc, desc, eq, exists, gte, inArray, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  KAGE_DEFENSE_GRACE_MINUTES,
  KAGE_DEFENSE_NOTICE_HOURS,
  TERR_BOT_ID,
} from "@/drizzle/constants";
import {
  actionLog,
  battle,
  kageDefendedChallenges,
  notification,
  userData,
  village,
  war,
} from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
import type { KageDefenseHall } from "@/server/utils/kage";
import { periodStart, secondsFromDate } from "@/utils/time";
import type { KageDefenseSchedule } from "@/validators/kage";

/** Build the `kageDefendedChallenges` insert for `joinDefenseQueue`. */
export const insertKageDefendedChallengesForJoinDefenseQueue = (
  client: Pick<DrizzleClient, "insert">,
  input: { villageId: string; aiRequested: false | true },
  ctx: { userId: string },
  hall: { village: { kageId: string; leaderUpdatedAt: Date }; now: Date },
) =>
  client.insert(kageDefendedChallenges).values({
    id: nanoid(),
    villageId: input.villageId,
    userId: ctx.userId,
    kageId: hall.village.kageId,
    tenure: hall.village.leaderUpdatedAt,
    aiRequested: input.aiRequested,
    notBefore: secondsFromDate(KAGE_DEFENSE_NOTICE_HOURS * 3600, hall.now),
  });

/** Build the `kageDefendedChallenges` lookup for `withdrawDefense`, using predicates on `id`. */
export const findKageDefendedChallengesForWithdrawDefense = (
  client: Pick<DrizzleClient, "query">,
  input: { id: string },
) =>
  client.query.kageDefendedChallenges.findFirst({
    where: eq(kageDefendedChallenges.id, input.id),
  });

/** Execute the database statement for `withdrawDefense`. */
export const executeResultForWithdrawDefense = (
  client: Pick<DrizzleClient, "execute">,
  match: { villageId: string },
  input: { id: string },
  ctx: { userId: string },
) =>
  client.execute(sql`
          UPDATE ${village}
          STRAIGHT_JOIN ${kageDefendedChallenges} ON ${kageDefendedChallenges.villageId} = ${village.id}
          SET ${village.kageScheduleVersion} = ${village.kageScheduleVersion} + 1,
              ${kageDefendedChallenges.status} = 'CANCELLED',
              ${kageDefendedChallenges.resolvedAt} = ${new Date()},
              ${kageDefendedChallenges.outcome} = 'Challenger withdrew; no prestige charged'
          WHERE ${village.id} = ${match.villageId}
            AND ${village.type} = 'VILLAGE'
            AND ${kageDefendedChallenges.id} = ${input.id}
            AND ${kageDefendedChallenges.userId} = ${ctx.userId}
            AND ${kageDefendedChallenges.status} IN ('QUEUED', 'SCHEDULED')
        `);

/** Build the `village` lookup for `withdrawDefense`, selecting only `type`, using predicates on `id`. */
export const findVillageForWithdrawDefense = (
  client: Pick<DrizzleClient, "query">,
  match: { villageId: string },
) =>
  client.query.village.findFirst({
    columns: { type: true },
    where: eq(village.id, match.villageId),
  });

/** Return matches to the queue, clearing their slot until `notBefore`. */
export const requeueKageDefendedChallenges = (
  client: Pick<DrizzleClient, "update">,
  ids: string[],
  values: { notBefore: Date; outcome?: string },
) =>
  client
    .update(kageDefendedChallenges)
    .set({ status: "QUEUED", scheduledAt: null, checkedInAt: null, ...values })
    .where(inArray(kageDefendedChallenges.id, ids));

/** Build the `kageDefendedChallenges` update for `rescheduleDefense`, setting `rescheduled`, using predicates on `id`. */
export const updateKageDefendedChallengesForRescheduleDefense2 = (
  client: Pick<DrizzleClient, "update">,
  input: { id: string },
) =>
  client
    .update(kageDefendedChallenges)
    .set({ rescheduled: true })
    .where(eq(kageDefendedChallenges.id, input.id));

/** Execute the database statement for `setDefenseAi`. */
export const executeResultForSetDefenseAi = (
  client: Pick<DrizzleClient, "execute">,
  ctx: { userId: string },
  input: { consent: false | true; id: string },
  match: { villageId: string },
) =>
  client.execute(sql`
          UPDATE ${village}
          STRAIGHT_JOIN ${kageDefendedChallenges} ON ${kageDefendedChallenges.villageId} = ${village.id}
          SET ${village.kageScheduleVersion} = ${village.kageScheduleVersion} + 1,
              ${kageDefendedChallenges.aiRequested} = IF(${village.kageId} = ${ctx.userId}, ${kageDefendedChallenges.aiRequested}, ${input.consent}),
              ${kageDefendedChallenges.aiAccepted} = IF(${village.kageId} = ${ctx.userId}, ${input.consent}, FALSE)
          WHERE ${village.id} = ${match.villageId}
            AND ${village.type} = 'VILLAGE'
            AND ${kageDefendedChallenges.id} = ${input.id}
            AND ${kageDefendedChallenges.status} IN ('QUEUED', 'SCHEDULED')
            AND (
              (${village.kageId} = ${ctx.userId} AND (${!input.consent} OR ${kageDefendedChallenges.aiRequested} = TRUE))
              OR (${kageDefendedChallenges.userId} = ${ctx.userId} AND ${village.kageId} != ${ctx.userId})
            )
        `);

/** Build the `village` lookup for `setDefenseAi`, selecting only `type` and `kageId`, using predicates on `id`. */
export const findVillageForSetDefenseAi = (
  client: Pick<DrizzleClient, "query">,
  match: { villageId: string },
) =>
  client.query.village.findFirst({
    columns: { type: true, kageId: true },
    where: eq(village.id, match.villageId),
  });

/** Build the `kageDefendedChallenges` update for `checkInDefense`, setting `checkedInAt`, using predicates on `id`. */
export const updateKageDefendedChallengesForCheckInDefense = (
  client: Pick<DrizzleClient, "update">,
  hall: { now: Date },
  input: { id: string },
) =>
  client
    .update(kageDefendedChallenges)
    .set({ checkedInAt: hall.now })
    .where(eq(kageDefendedChallenges.id, input.id));

/** Execute the database statement for `requestInstantDefense`. */
export const executeResultForRequestInstantDefense = (
  client: Pick<DrizzleClient, "execute">,
  invitation: NonNullable<KageDefenseSchedule["instantChallenge"]>,
  match: { villageId: string; aiRequested: false | true; aiAccepted: false | true },
  ctx: { userId: string },
  tenure: Date,
  input: { id: string },
  scheduledAt: Date,
  now: Date,
) =>
  client.execute(sql`
          UPDATE ${village}
          STRAIGHT_JOIN ${kageDefendedChallenges} ON ${kageDefendedChallenges.villageId} = ${village.id}
          INNER JOIN ${userData} ON ${userData.userId} = ${village.kageId}
          SET ${village.kageScheduleVersion} = ${village.kageScheduleVersion} + 1,
              ${village.kageSchedule} = JSON_SET(${village.kageSchedule}, '$.instantChallenge', JSON_EXTRACT(${JSON.stringify(invitation)}, '$'))
          WHERE ${village.id} = ${match.villageId}
            AND ${village.type} = 'VILLAGE'
            AND ${village.kageId} = ${ctx.userId}
            AND ${eq(village.leaderUpdatedAt, tenure)}
            AND JSON_UNQUOTE(JSON_EXTRACT(${village.kageSchedule}, '$.kageId')) = ${ctx.userId}
            AND JSON_UNQUOTE(JSON_EXTRACT(${village.kageSchedule}, '$.tenure')) = ${tenure.toISOString()}
            AND JSON_UNQUOTE(JSON_EXTRACT(${village.kageSchedule}, '$.paused')) = 'false'
            AND ${userData.status} = 'AWAKE' AND ${userData.isAi} = FALSE
            AND ${kageDefendedChallenges.id} = ${input.id}
            AND ${kageDefendedChallenges.status} = 'SCHEDULED'
            AND ${kageDefendedChallenges.kageId} = ${ctx.userId}
            AND ${eq(kageDefendedChallenges.tenure, tenure)}
            AND ${eq(kageDefendedChallenges.scheduledAt, scheduledAt)}
            AND ${kageDefendedChallenges.scheduledAt} >= ${secondsFromDate(-KAGE_DEFENSE_GRACE_MINUTES * 60, now)}
            AND ${kageDefendedChallenges.hospitalDeferred} = FALSE
            AND ${kageDefendedChallenges.aiRequested} = ${match.aiRequested}
            AND ${kageDefendedChallenges.aiAccepted} = ${match.aiAccepted}
            AND (JSON_EXTRACT(${village.kageSchedule}, '$.instantChallenge') IS NULL
              OR JSON_UNQUOTE(JSON_EXTRACT(${village.kageSchedule}, '$.instantChallenge.expiresAt')) <= ${now.toISOString()})
            AND NOT EXISTS (SELECT 1 FROM ${war}
              WHERE ${war.type} = 'VILLAGE_WAR' AND ${war.status} = 'ACTIVE'
                AND (${war.attackerVillageId} = ${village.id} OR ${war.defenderVillageId} = ${village.id}))
        `);

/** Execute the database statement for `dismissInstantDefense`. */
export const executeResultForDismissInstantDefense = (
  client: Pick<DrizzleClient, "execute">,
  match: { villageId: string },
  input: { id: string; instantRequestId: string },
  ctx: { userId: string },
) =>
  client.execute(sql`
          UPDATE ${village}
          STRAIGHT_JOIN ${kageDefendedChallenges} ON ${kageDefendedChallenges.villageId} = ${village.id}
          SET ${village.kageScheduleVersion} = ${village.kageScheduleVersion} + 1,
              ${village.kageSchedule} = JSON_REMOVE(${village.kageSchedule}, '$.instantChallenge')
          WHERE ${village.id} = ${match.villageId}
            AND ${village.type} = 'VILLAGE'
            AND ${kageDefendedChallenges.id} = ${input.id}
            AND (${village.kageId} = ${ctx.userId} OR ${kageDefendedChallenges.userId} = ${ctx.userId})
            AND JSON_UNQUOTE(JSON_EXTRACT(${village.kageSchedule}, '$.instantChallenge.id')) = ${input.instantRequestId}
            AND JSON_UNQUOTE(JSON_EXTRACT(${village.kageSchedule}, '$.instantChallenge.matchId')) = ${input.id}
        `);

/** Build the `kageDefendedChallenges` listing for `startDefense`, using predicates on `userId`. */
export const listKageDefendedChallengesForStartDefense = (
  client: Pick<DrizzleClient, "query">,
  m: { userId: string },
) =>
  client.query.kageDefendedChallenges.findMany({
    where: eq(kageDefendedChallenges.userId, m.userId),
  });

/** Build the `village` lookup for `loadKageDefense`, using predicates on `id`. */
export const findVillageForLoadKageDefense = (
  client: Pick<DrizzleClient, "query">,
  villageId: string,
) =>
  client.query.village.findFirst({
    where: eq(village.id, villageId),
    with: { kage: true },
  });

/** Build the `kageDefendedChallenges` selection for `loadKageDefense`, using predicates on `villageId` and `status`. */
export const selectKageDefendedChallengesForLoadKageDefense = (
  client: Pick<DrizzleClient, "select">,
  villageId: string,
  activeKageMatchStatuses: readonly ["QUEUED", "SCHEDULED", "STARTING", "BATTLE"],
) =>
  client
    .select({
      match: kageDefendedChallenges,
      user: userData,
      liveBattleId: battle.id,
    })
    .from(kageDefendedChallenges)
    .innerJoin(userData, eq(kageDefendedChallenges.userId, userData.userId))
    .leftJoin(battle, eq(kageDefendedChallenges.battleId, battle.id))
    .where(
      and(
        eq(kageDefendedChallenges.villageId, villageId),
        inArray(kageDefendedChallenges.status, activeKageMatchStatuses),
      ),
    )
    .orderBy(asc(kageDefendedChallenges.createdAt), asc(kageDefendedChallenges.id));

/** Build the `war` listing for `loadKageDefense`, using predicates on `type`, `attackerVillageId`, `defenderVillageId`. */
export const listWarForLoadKageDefense = (
  client: Pick<DrizzleClient, "query">,
  villageId: string,
) =>
  client.query.war.findMany({
    columns: { id: true, status: true, startedAt: true, endedAt: true },
    where: villageWarWhere(villageId),
  });

/** Persist schedule JSON only for the tenure loaded under the village lock. */
export const saveKageSchedule = (client: DrizzleClient, hall: KageDefenseHall) =>
  client
    .update(village)
    .set({ kageSchedule: hall.state })
    .where(
      and(
        eq(village.id, hall.village.id),
        eq(village.kageId, hall.village.kageId),
        eq(village.leaderUpdatedAt, hall.village.leaderUpdatedAt),
      ),
    );

/** Build the `kageDefendedChallenges` update for `syncLockedKageDefense`, using predicates on `id` and `status`. */
export const updateKageDefendedChallengesForSyncLockedKageDefense = (
  client: Pick<DrizzleClient, "update">,
  now: Date,
  m: { id: string; status: "STARTING" | "BATTLE" },
) =>
  client
    .update(kageDefendedChallenges)
    .set({
      status: "CANCELLED",
      resolvedAt: now,
      // Neutral system recovery releases the start-based daily and weekly allowance.
      startedAt: null,
      outcome: "Battle ended without a recorded result; no prestige charged",
    })
    .where(
      and(
        eq(kageDefendedChallenges.id, m.id),
        eq(kageDefendedChallenges.status, m.status),
      ),
    );

/** Build the `kageDefendedChallenges` update for `syncLockedKageDefense`, using predicates on `id`. */
export const updateKageDefendedChallengesForSyncLockedKageDefense2 = (
  client: Pick<DrizzleClient, "update">,
  now: Date,
  m: { id: string },
) =>
  client
    .update(kageDefendedChallenges)
    .set({
      status: "CANCELLED",
      resolvedAt: now,
      outcome: "Challenger no longer eligible",
    })
    .where(eq(kageDefendedChallenges.id, m.id));

/**
 * Build the `kageDefendedChallenges` update for `syncLockedKageDefense`, setting
 * `hospitalDeferred` and `checkedInAt`, using predicates on `id`.
 */
export const updateKageDefendedChallengesForSyncLockedKageDefense3 = (
  client: Pick<DrizzleClient, "update">,
  m: { id: string },
) =>
  client
    .update(kageDefendedChallenges)
    .set({ hospitalDeferred: true, checkedInAt: null })
    .where(eq(kageDefendedChallenges.id, m.id));

/** Build the `kageDefendedChallenges` update for `syncLockedKageDefense`, setting `notBefore`, using predicates on `id`. */
export const updateKageDefendedChallengesForSyncLockedKageDefense4 = (
  client: Pick<DrizzleClient, "update">,
  later: { match: { notBefore: Date; id: string } },
) =>
  client
    .update(kageDefendedChallenges)
    .set({ notBefore: later.match.notBefore })
    .where(eq(kageDefendedChallenges.id, later.match.id));

/** Build the `kageDefendedChallenges` update for `syncLockedKageDefense`, using predicates on `id`. */
export const updateKageDefendedChallengesForSyncLockedKageDefense5 = (
  client: Pick<DrizzleClient, "update">,
  m: { scheduledAt: Date; id: string },
) =>
  client
    .update(kageDefendedChallenges)
    .set({ scheduledAt: m.scheduledAt, hospitalDeferred: false, checkedInAt: null })
    .where(eq(kageDefendedChallenges.id, m.id));

/** Build the `kageDefendedChallenges` update for `syncLockedKageDefense`, using predicates on `id`. */
export const updateKageDefendedChallengesForSyncLockedKageDefense6 = (
  client: Pick<DrizzleClient, "update">,
  now: Date,
  m: { id: string },
) =>
  client
    .update(kageDefendedChallenges)
    .set({
      status: "FORFEITED",
      resolvedAt: now,
      outcome: "Challenger absent or unavailable; no prestige charged",
    })
    .where(eq(kageDefendedChallenges.id, m.id));

/** Build the `kageDefendedChallenges` update for `syncLockedKageDefense`, using predicates on `id`. */
export const updateKageDefendedChallengesForSyncLockedKageDefense7 = (
  client: Pick<DrizzleClient, "update">,
  now: Date,
  m: { id: string },
) =>
  client
    .update(kageDefendedChallenges)
    .set({
      status: "FORFEITED",
      resolvedAt: now,
      outcome: "Kage did not start the attended match; attendance strike recorded",
    })
    .where(eq(kageDefendedChallenges.id, m.id));

/** Build the `kageDefendedChallenges` update for `resetMatch`, using predicates on `id`. */
export const updateKageDefendedChallengesForResetMatch = (
  client: Pick<DrizzleClient, "update">,
  update: Pick<
    import("@/drizzle/schema").KageDefendedChallenge,
    "kageId" | "notBefore" | "hospitalDeferred" | "aiAccepted"
  > & {
    status: "QUEUED";
    scheduledAt: null;
    checkedInAt: null;
    tenure: Date;
    outcome: string;
  },
  m: { id: string },
) =>
  client
    .update(kageDefendedChallenges)
    .set(update)
    .where(eq(kageDefendedChallenges.id, m.id));

/** Build the `kageDefendedChallenges` listing for `assignKageMatches`, using predicates on `userId` and `startedAt`. */
export const listKageDefendedChallengesForAssignKageMatches = (
  client: Pick<DrizzleClient, "query">,
  pending: { match: { userId: string } }[],
  hall: { now: Date },
) =>
  client.query.kageDefendedChallenges.findMany({
    where: and(
      inArray(
        kageDefendedChallenges.userId,
        pending.map((r) => r.match.userId),
      ),
      gte(kageDefendedChallenges.startedAt, periodStart("weekly", hall.now)),
    ),
  });

/** Build the `kageDefendedChallenges` update for `assignKageMatches`, using predicates on `id`. */
export const updateKageDefendedChallengesForAssignKageMatches = (
  client: Pick<DrizzleClient, "update">,
  update: { status: "SCHEDULED"; scheduledAt: Date; kageId: string; tenure: Date },
  m: { id: string },
) =>
  client
    .update(kageDefendedChallenges)
    .set(update)
    .where(eq(kageDefendedChallenges.id, m.id));

/** Build the `userData` listing for `removeAbsentKage`, using predicates on `villageId` and `rank`. */
export const listUserDataForRemoveAbsentKage = (
  client: Pick<DrizzleClient, "query">,
  v: { id: string },
) =>
  client.query.userData.findMany({
    where: and(eq(userData.villageId, v.id), eq(userData.rank, "ELDER")),
    orderBy: [asc(userData.isAi), asc(userData.userId)],
  });

/** Build the `village` update for `removeAbsentKage`, using predicates on `id`, `kageId`, `leaderUpdatedAt`. */
export const updateVillageForRemoveAbsentKage = (
  client: Pick<DrizzleClient, "update">,
  replacement: { userId: undefined | string } | undefined,
  now: Date,
  nextSchedule: import("@/validators/kage").KageDefenseSchedule,
  v: { id: string; kageId: string; leaderUpdatedAt: Date },
) =>
  client
    .update(village)
    .set({
      kageId: replacement?.userId ?? "",
      leaderUpdatedAt: now,
      kageSchedule: nextSchedule,
    })
    .where(
      and(
        eq(village.id, v.id),
        eq(village.kageId, v.kageId),
        eq(village.leaderUpdatedAt, v.leaderUpdatedAt),
      ),
    );

/** Build the `kageDefendedChallenges` update for `removeAbsentKage`, using predicates on `villageId` and `status`. */
export const updateKageDefendedChallengesForRemoveAbsentKage = (
  client: Pick<DrizzleClient, "update">,
  now: Date,
  v: { id: string },
) =>
  client
    .update(kageDefendedChallenges)
    .set({
      status: "QUEUED",
      scheduledAt: null,
      checkedInAt: null,
      aiAccepted: false,
      notBefore: secondsFromDate(KAGE_DEFENSE_NOTICE_HOURS * 3600, now),
      outcome: "Kage removed for attendance or missing schedule; priority retained",
    })
    .where(
      and(
        eq(kageDefendedChallenges.villageId, v.id),
        inArray(kageDefendedChallenges.status, ["QUEUED", "SCHEDULED"]),
      ),
    );

/** Build the `actionLog` insert for `removeAbsentKage`. */
export const insertActionLogForRemoveAbsentKage = (
  client: Pick<DrizzleClient, "insert">,
  v: { kageId: string; id: string; name: string; leaderUpdatedAt: Date },
  removedUsername: string,
  removal: { reason: string },
  hall: {
    state: {
      publishedAt: null | string;
      missedStarts: number;
      setupDueAt?: undefined | string;
    };
  },
  replacement: undefined | import("@/drizzle/schema").UserData,
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: v.kageId,
    tableName: "village",
    relatedId: v.id,
    relatedMsg: clampActionLogText(`${removedUsername} removed as Kage of ${v.name}`),
    changes: [
      `Removed Kage: ${removedUsername} (${v.kageId})`,
      `Reason: ${removal.reason}`,
      `Tenure started: ${v.leaderUpdatedAt.toISOString()}`,
      hall.state.publishedAt
        ? `Missed attended defenses: ${hall.state.missedStarts}`
        : `Schedule deadline: ${hall.state.setupDueAt ?? "unknown"}`,
      replacement
        ? `Replacement: ${replacement.username} (${replacement.userId})`
        : "Replacement: none; village left vacant",
    ],
  });

/** Build the `notification` insert for `removeAbsentKage`. */
export const insertNotificationForRemoveAbsentKage = (
  client: Pick<DrizzleClient, "insert">,
  removedUsername: string,
  v: { name: string },
  removal: { reason: string },
  successor: string,
) =>
  client.insert(notification).values({
    userId: TERR_BOT_ID,
    content: `${removedUsername} was removed as Kage of ${v.name} ${removal.reason.replace(/^Kage removed /, "")}. ${successor}`,
  });

/** Build the `userData` update for `removeAbsentKage`, setting `unreadNotifications`, using predicates on `userId`. */
export const updateUserDataForRemoveAbsentKage2 = (
  client: Pick<DrizzleClient, "update">,
  v: { kageId: string },
  replacement: undefined | import("@/drizzle/schema").UserData,
) =>
  client
    .update(userData)
    .set({ unreadNotifications: sql`${userData.unreadNotifications} + 1` })
    .where(
      inArray(
        userData.userId,
        [v.kageId, replacement && !replacement.isAi ? replacement.userId : ""].filter(
          Boolean,
        ),
      ),
    );

/** Build the `village` lookup for `readKageDefensePublic`, using predicates on `id`. */
export const findVillageForReadKageDefensePublic = (
  client: Pick<DrizzleClient, "query">,
  villageId: string,
) =>
  client.query.village.findFirst({
    where: eq(village.id, villageId),
    with: { kage: { columns: { userId: true, username: true, isAi: true } } },
  });

/**
 * Build the `kageDefendedChallenges` selection for `readKageDefensePublic`, using
 * predicates on `villageId` and `status`.
 */
export const selectKageDefendedChallengesForReadKageDefensePublic = (
  client: Pick<DrizzleClient, "select">,
  villageId: string,
  activeKageMatchStatuses: readonly ["QUEUED", "SCHEDULED", "STARTING", "BATTLE"],
) =>
  client
    .select({
      id: kageDefendedChallenges.id,
      challengerId: kageDefendedChallenges.userId,
      username: userData.username,
      status: kageDefendedChallenges.status,
      scheduledAt: kageDefendedChallenges.scheduledAt,
      checkedInAt: kageDefendedChallenges.checkedInAt,
      rescheduled: kageDefendedChallenges.rescheduled,
      aiRequested: kageDefendedChallenges.aiRequested,
      aiAccepted: kageDefendedChallenges.aiAccepted,
      hospitalDeferred: kageDefendedChallenges.hospitalDeferred,
      battleId: kageDefendedChallenges.battleId,
    })
    .from(kageDefendedChallenges)
    .innerJoin(userData, eq(userData.userId, kageDefendedChallenges.userId))
    .where(
      and(
        eq(kageDefendedChallenges.villageId, villageId),
        inArray(kageDefendedChallenges.status, activeKageMatchStatuses),
      ),
    )
    .orderBy(asc(kageDefendedChallenges.createdAt), asc(kageDefendedChallenges.id));

/**
 * Build the `kageDefendedChallenges` selection for `readKageDefensePublic`, using
 * predicates on `villageId` and `status`.
 */
export const selectKageDefendedChallengesForReadKageDefensePublic2 = (
  client: Pick<DrizzleClient, "select">,
  villageId: string,
) =>
  client
    .select({
      id: kageDefendedChallenges.id,
      challengerId: kageDefendedChallenges.userId,
      outcome: kageDefendedChallenges.outcome,
      resolvedAt: kageDefendedChallenges.resolvedAt,
    })
    .from(kageDefendedChallenges)
    .where(
      and(
        eq(kageDefendedChallenges.villageId, villageId),
        inArray(kageDefendedChallenges.status, ["COMPLETED", "CANCELLED", "FORFEITED"]),
      ),
    )
    .orderBy(desc(kageDefendedChallenges.resolvedAt))
    .limit(10);

/** Build the `village` selection for `maintainKageDefenses`, including predicates on `type`, `villageId`, `id`. */
export const selectVillageForMaintainKageDefenses = (
  client: Pick<DrizzleClient, "select">,
  activeKageMatchStatuses: readonly ["QUEUED", "SCHEDULED", "STARTING", "BATTLE"],
  uninterruptedSince: Date,
) =>
  client
    .select({
      id: village.id,
      kageId: village.kageId,
      leaderUpdatedAt: village.leaderUpdatedAt,
      version: village.kageScheduleVersion,
      state: village.kageSchedule,
      hasMatches: exists(
        client
          .select({ id: kageDefendedChallenges.id })
          .from(kageDefendedChallenges)
          .where(
            and(
              eq(kageDefendedChallenges.villageId, village.id),
              inArray(kageDefendedChallenges.status, activeKageMatchStatuses),
            ),
          ),
      ).mapWith(Boolean),
      hasWar: exists(
        client
          .select({ id: war.id })
          .from(war)
          .where(
            and(
              villageWarWhere(village.id),
              or(eq(war.status, "ACTIVE"), gte(war.startedAt, uninterruptedSince)),
            ),
          ),
      ).mapWith(Boolean),
    })
    .from(village)
    .where(eq(village.type, "VILLAGE"));

/**
 * Build the `village` update for `maintainKageDefenses`, setting `kageSchedule` and
 * `kageScheduleVersion`, including predicates on `id`, `kageScheduleVersion`,
 * `kageId`.
 */
export const updateVillageForMaintainKageDefenses = (
  client: Pick<DrizzleClient, "update">,
  state: import("@/validators/kage").KageDefenseSchedule,
  now: Date,
  v: { id: string; version: number; kageId: string; leaderUpdatedAt: Date },
) =>
  client
    .update(village)
    .set({
      kageSchedule: { ...state, observedAt: now.toISOString() },
      kageScheduleVersion: sql`${village.kageScheduleVersion} + 1`,
    })
    .where(
      and(
        eq(village.id, v.id),
        eq(village.kageScheduleVersion, v.version),
        eq(village.kageId, v.kageId),
        eq(village.leaderUpdatedAt, v.leaderUpdatedAt),
      ),
    );

/** Build an atomic increment of a village’s Kage defense schedule version. */
export const incrementKageScheduleVersion = (
  client: Pick<DrizzleClient, "update">,
  villageId: string,
) =>
  client
    .update(village)
    .set({ kageScheduleVersion: sql`${village.kageScheduleVersion} + 1` })
    .where(eq(village.id, villageId));

/** A VILLAGE_WAR the village fights on either side; takes a bound id or a joined column. */
const villageWarWhere = (villageId: string | typeof village.id) =>
  and(
    eq(war.type, "VILLAGE_WAR"),
    or(eq(war.attackerVillageId, villageId), eq(war.defenderVillageId, villageId)),
  );
