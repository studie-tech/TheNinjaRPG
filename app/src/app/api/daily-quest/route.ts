import { and, eq, gte, or, sql } from "drizzle-orm";
import { type UserRank, VILLAGE_SYNDICATE_ID } from "@/drizzle/constants";
import { questHistory, userData } from "@/drizzle/schema";
import { lockWithDailyTimer, runClaimedCron } from "@/libs/gamesettings";
import { getQuestMaxLevel } from "@/libs/quest/availability";
import { availableQuestLetterRanks } from "@/libs/train";
import {
  listQuestForGET,
  selectUserDataForGET,
  updateQuestHistoryForGET,
} from "@/queries/quests";
import { listVillagesWithStructures } from "@/queries/village";
import { drizzleDB } from "@/server/db";
import { authenticateCronRequest } from "@/server/utils/cron";
import { retryOnDeadlock } from "@/server/utils/mysqlErrors";
import { upsertQuestEntries } from "@/server/utils/questAssignment";
import { shuffle } from "@/utils/array";
import { periodStart, secondsFromNow } from "@/utils/time";

const ENDPOINT_NAME = "daily-quest";

export const maxDuration = 300;

/** Work budget per invocation, leaving headroom under maxDuration to record the resume marker. */
const RUN_BUDGET_MS = 240_000;

/**
 * Accounts updated within this window receive a daily. Matches the window used when a quest is
 * turned into an event; anyone returning later gets a daily from the next midnight run on.
 */
const ACTIVE_WINDOW_SECONDS = 60 * 60 * 24 * 7;

/** Timer value marking a run that closed the dailies but did not finish assigning them. */
const RESUME_PENDING = 1;

export async function GET(request: Request) {
  const authError = authenticateCronRequest(request);
  if (authError) return authError;

  // Check timer
  const timerCheck = await lockWithDailyTimer(drizzleDB, ENDPOINT_NAME);
  return runClaimedCron(timerCheck, "/api/daily-quest", async () => {
    const deadline = Date.now() + RUN_BUDGET_MS;
    const dayStart = periodStart("daily", new Date());
    // An interrupted run rolls the timer back to the instant before its own day with
    // RESUME_PENDING, so only a tick on that same day resumes; any later day starts over.
    const resumeMarker = new Date(dayStart.getTime() - 1);
    const isResume =
      timerCheck.prevValue === RESUME_PENDING &&
      timerCheck.prevTime.getTime() === resumeMarker.getTime();
    const activeSince = secondsFromNow(-ACTIVE_WINDOW_SECONDS);

    // Reset all current dailies and load the independent assignment inputs together. A resumed
    // run skips the close: it would shut the dailies this day's earlier invocation handed out.
    const [dailies, villages, userRankPerVillageLevel] = await Promise.all([
      listQuestForGET(drizzleDB),
      listVillagesWithStructures(drizzleDB),
      selectUserDataForGET(drizzleDB, activeSince),
      // Guarded and idempotent, so a deadlock with the other midnight crons just reruns it.
      // Only open attempts (no endAt) are closed; earlier days' closed rows keep their endAt.
      isResume ? undefined : retryOnDeadlock(() => updateQuestHistoryForGET(drizzleDB)),
    ]);

    // Book-keeping to do upsert afterwards more efficiently
    const memory: {
      quest: (typeof dailies)[number];
      size: number;
      combos: {
        rank: UserRank;
        villageId: string;
        level: number;
      }[];
    }[] = [];

    // For each user rank+village+level combo, get a random daily quest
    for (const config of userRankPerVillageLevel) {
      const { rank, villageId, level, count } = config;
      const village = villages.find((v) => v.id === villageId);
      const questRanks = availableQuestLetterRanks(rank);
      if (village && questRanks.length > 0) {
        const requiredVillage =
          village.type === "OUTLAW" ? VILLAGE_SYNDICATE_ID : village.id;
        const newDaily = shuffle(dailies).find(
          (q) =>
            questRanks.includes(q.questRank) &&
            (!q.requiredVillage || q.requiredVillage === requiredVillage) &&
            q.requiredLevel <= level &&
            getQuestMaxLevel(q) >= level,
        );
        if (newDaily) {
          const entry = memory.find((m) => m.quest.id === newDaily.id);
          if (!entry) {
            memory.push({
              quest: newDaily,
              size: count,
              combos: [{ rank, villageId: village.id, level }],
            });
          } else {
            entry.size += count;
            entry.combos.push({ rank, villageId: village.id, level });
          }
        }
      }
    }

    // Players who already received a daily this day (from an interrupted earlier invocation)
    // are skipped, so a resume never reopens or re-rolls a daily that is already in play. A
    // daily this run's close just shut (completed 0, ended) does not count as received.
    const assignedToday = sql`EXISTS (
      SELECT 1 FROM ${questHistory} AS assignedDaily
      WHERE assignedDaily.userId = ${userData.userId}
        AND assignedDaily.questType = 'daily'
        AND assignedDaily.startedAt >= ${dayStart}
        AND (assignedDaily.completed > 0 OR assignedDaily.endedAt IS NULL)
    )`;

    // Do upsertions for each quest. Each combo selects only the players it was counted from
    // (non-AI, active, that exact level): matching the quest's whole level range instead would
    // also hand it to every other level in the range, each of which had a daily of its own
    // picked. Smallest quests go first so one very large bracket cannot use up the budget
    // before the others are assigned. A failure rolls the timer back, and the next cron tick in
    // hour 0 reruns the whole reset, which closes whatever this run reopened and reassigns from
    // scratch; running out of budget instead leaves a resume marker for the next tick.
    memory.sort((a, b) => a.size - b.size);
    for (const m of memory) {
      const finished =
        Date.now() < deadline &&
        (await upsertQuestEntries(
          drizzleDB,
          m.quest,
          and(
            eq(userData.isAi, false),
            gte(userData.updatedAt, activeSince),
            sql`NOT ${assignedToday}`,
            or(
              ...m.combos.map((c) =>
                and(
                  eq(userData.rank, c.rank),
                  eq(userData.villageId, c.villageId),
                  eq(userData.level, c.level),
                ),
              ),
            ),
          ),
          deadline,
        ));
      if (!finished) {
        await timerCheck.update(RESUME_PENDING, resumeMarker);
        return Response.json("Partially assigned; resuming on the next tick", {
          status: 202,
        });
      }
    }

    return Response.json(`OK`);
  });
}
