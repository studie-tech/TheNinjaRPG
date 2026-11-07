import {
  KAGE_CHALLENGER_DAILY_LIMIT,
  KAGE_CHALLENGER_WEEKLY_LIMIT,
  KAGE_DEFENSE_CHECK_IN_MINUTES,
  KAGE_DEFENSE_GRACE_MINUTES,
  KAGE_DEFENSE_MAX_NO_SHOWS,
  KAGE_DEFENSE_NOTICE_HOURS,
  KAGE_DEFENSE_PUBLIC_SYNC_SECONDS,
  KAGE_DEFENSE_SETUP_HOURS,
  KAGE_DEFENSE_SLOT_MINUTES,
} from "@/drizzle/constants";
import type { KageDefendedChallenge } from "@/drizzle/schema";
import { setKageCandidateToJonin } from "@/queries/kage";
import {
  findVillageForLoadKageDefense,
  findVillageForReadKageDefensePublic,
  incrementKageScheduleVersion,
  insertActionLogForRemoveAbsentKage,
  insertNotificationForRemoveAbsentKage,
  listKageDefendedChallengesForAssignKageMatches,
  listUserDataForRemoveAbsentKage,
  listWarForLoadKageDefense,
  saveKageSchedule,
  selectKageDefendedChallengesForLoadKageDefense,
  selectKageDefendedChallengesForReadKageDefensePublic,
  selectKageDefendedChallengesForReadKageDefensePublic2,
  selectVillageForMaintainKageDefenses,
  updateKageDefendedChallengesForAssignKageMatches,
  updateKageDefendedChallengesForRemoveAbsentKage,
  updateKageDefendedChallengesForResetMatch,
  updateKageDefendedChallengesForSyncLockedKageDefense,
  updateKageDefendedChallengesForSyncLockedKageDefense2,
  updateKageDefendedChallengesForSyncLockedKageDefense3,
  updateKageDefendedChallengesForSyncLockedKageDefense4,
  updateKageDefendedChallengesForSyncLockedKageDefense5,
  updateKageDefendedChallengesForSyncLockedKageDefense6,
  updateKageDefendedChallengesForSyncLockedKageDefense7,
  updateUserDataForRemoveAbsentKage2,
  updateVillageForMaintainKageDefenses,
  updateVillageForRemoveAbsentKage,
} from "@/queries/kageDefense";
import { errorResponse } from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
import { queryInTransaction } from "@/server/utils/concurrency";
import { retryOnDeadlock } from "@/server/utils/mysqlErrors";
import {
  getKageEligibility,
  getKageSlots,
  initialKageSetupDeadline,
  kageTenureStart,
} from "@/utils/kage";
import { periodStart, secondsFromDate } from "@/utils/time";
import type { KageDefenseSchedule } from "@/validators/kage";

/** States that retain a challenger's unique active entry and FIFO queue position. */
export const activeKageMatchStatuses = [
  "QUEUED",
  "SCHEDULED",
  "STARTING",
  "BATTLE",
] as const;

/**
 * Serialize changes to a village's schedule, queue and leadership using its existing row.
 * A single guarded update cannot calculate FIFO assignments and commit their queue rows
 * with attendance strikes or a new tenure. Callbacks must use the supplied client;
 * combat preload stays outside this transaction and revalidates at its atomic launch.
 * Returns null when the village does not support title defenses.
 */
export const withKageDefense = async <T>(
  client: DrizzleClient,
  villageId: string,
  callback: (tx: DrizzleClient, hall: KageDefenseHall) => Promise<T>,
) =>
  retryOnDeadlock(() =>
    client.transaction(async (tx) => {
      await incrementKageScheduleVersion(tx, villageId);
      const hall = await loadKageDefense(tx, villageId);
      if (hall?.village.type !== "VILLAGE") return null;
      return callback(tx, hall);
    }),
  );

/** `withKageDefense` for procedures, answering a missing hall with an error response. */
export const withKageHall = async <T>(
  client: DrizzleClient,
  villageId: string,
  callback: (tx: DrizzleClient, hall: KageDefenseHall) => Promise<T>,
) =>
  (await withKageDefense(client, villageId, callback)) ??
  errorResponse("Village not found");

/** Load a tenure-consistent working snapshot after acquiring the village row lock. */
const loadKageDefense = async (client: DrizzleClient, villageId: string) => {
  const now = new Date();
  const [v, rows, wars] = await queryInTransaction([
    findVillageForLoadKageDefense(client, villageId),
    selectKageDefendedChallengesForLoadKageDefense(
      client,
      villageId,
      activeKageMatchStatuses,
    ),
    listWarForLoadKageDefense(client, villageId),
  ]);
  if (!v) return null;
  const sameTenure =
    v.kageSchedule?.kageId === v.kageId &&
    v.kageSchedule?.tenure === v.leaderUpdatedAt.toISOString();
  const state: KageDefenseSchedule =
    sameTenure && v.kageSchedule
      ? { ...v.kageSchedule }
      : {
          kageId: v.kageId,
          tenure: v.leaderUpdatedAt.toISOString(),
          windows: [],
          publishedAt: null,
          missedStarts: 0,
          paused: false,
          observedAt: kageTenureStart(v).toISOString(),
        };
  // An NPC incumbent cannot publish a schedule. Public daily windows let villagers contest it.
  if (v.kage?.isAi && !state.publishedAt) {
    state.windows = Array.from({ length: 7 }, (_, day) => ({ day, hour: 12 }));
    state.publishedAt = now.toISOString();
  }
  const paused = wars.some((w) => w.status === "ACTIVE");
  // An idle observation can race a war's commit; either boundary reveals a missed pause.
  const observedAt = new Date(state.observedAt);
  const warInterrupted = wars.some(
    (w) => w.startedAt > observedAt || (w.endedAt && w.endedAt > observedAt),
  );
  const lastWarEndedAt = wars.reduce<Date | null>(
    (latest, w) => (w.endedAt && (!latest || w.endedAt > latest) ? w.endedAt : latest),
    null,
  );
  return {
    village: v,
    rows,
    state,
    now,
    paused,
    warInterrupted,
    lastWarEndedAt,
    resetAssignments: !sameTenure || paused || state.paused || warInterrupted,
  };
};
/** Mutable snapshot shared by reconciliation and assignments within one village transaction. */
export type KageDefenseHall = NonNullable<Awaited<ReturnType<typeof loadKageDefense>>>;

/** Reconcile deadlines and assign waiting matches in one village transaction. */
export const syncKageDefense = (client: DrizzleClient, villageId: string) =>
  withKageDefense(client, villageId, syncLockedKageDefense);

/**
 * Recover interruptions, settle attendance and assign the queue under an existing lock.
 * Updates the working snapshot alongside writes; false means leadership changed and
 * callers must stop using the old tenure. Never call with an autocommit client.
 */
export const syncLockedKageDefense = async (
  client: DrizzleClient,
  hall: KageDefenseHall,
) => {
  const { now, state, village: v } = hall;
  const priorObservation = new Date(state.observedAt);
  const missedObservation =
    now.getTime() - priorObservation.getTime() > KAGE_DEFENSE_GRACE_MINUTES * 60_000;
  if (advanceSetupDeadline(hall, priorObservation, missedObservation)) {
    await removeAbsentKage(client, hall);
    return false;
  }
  for (const row of hall.rows) {
    const m = row.match;
    if (m.status === "BATTLE" || m.status === "STARTING") {
      // Terminal combat deletes its battle and records completion atomically; a missing
      // battle with an active receipt therefore represents an interrupted launch/result.
      if (!row.liveBattleId) {
        const resolved = await updateKageDefendedChallengesForSyncLockedKageDefense(
          client,
          now,
          { id: m.id, status: m.status },
        );
        if (resolved.rowsAffected) m.status = "CANCELLED";
      }
      continue;
    }
    if (getKageEligibility(row.user, v.id) || row.user.userId === v.kageId) {
      await updateKageDefendedChallengesForSyncLockedKageDefense2(client, now, m);
      m.status = "CANCELLED";
      continue;
    }
    if (hall.resetAssignments) {
      await resetMatch(client, hall, m, "Schedule renewed; queue priority retained");
      continue;
    }
    if (m.status !== "SCHEDULED" || !m.scheduledAt) continue;
    if (
      (m.hospitalDeferred ||
        now.getTime() >=
          m.scheduledAt.getTime() - KAGE_DEFENSE_CHECK_IN_MINUTES * 60_000) &&
      (row.user.status === "HOSPITALIZED" || v.kage?.status === "HOSPITALIZED")
    ) {
      await updateKageDefendedChallengesForSyncLockedKageDefense3(client, m);
      m.hospitalDeferred = true;
      continue;
    }
    if (m.hospitalDeferred) {
      // Resume with a fresh check-in window and move overlapping followers without
      // changing FIFO priority or spending either participant's voluntary reschedule.
      m.scheduledAt = secondsFromDate(KAGE_DEFENSE_CHECK_IN_MINUTES * 60, now);
      m.hospitalDeferred = false;
      m.checkedInAt = null;
      const index = hall.rows.indexOf(row);
      const blockedUntil = secondsFromDate(
        KAGE_DEFENSE_SLOT_MINUTES * 60,
        m.scheduledAt,
      );
      for (const later of hall.rows.slice(index + 1)) {
        if (
          later.match.status === "SCHEDULED" &&
          later.match.scheduledAt &&
          later.match.scheduledAt < blockedUntil
        ) {
          await resetMatch(
            client,
            hall,
            later.match,
            "Match moved after a hospital deferral; priority retained",
          );
          later.match.notBefore = new Date(
            Math.max(later.match.notBefore.getTime(), blockedUntil.getTime()),
          );
          await updateKageDefendedChallengesForSyncLockedKageDefense4(client, later);
        }
      }

      await updateKageDefendedChallengesForSyncLockedKageDefense5(client, {
        scheduledAt: m.scheduledAt,
        id: m.id,
      });
    }
    if (now.getTime() <= m.scheduledAt.getTime() + KAGE_DEFENSE_GRACE_MINUTES * 60_000)
      continue;
    if (
      v.kage?.status === "BATTLE" &&
      hall.rows.some((r) => r.match.id !== m.id && r.match.status === "BATTLE")
    ) {
      await resetMatch(
        client,
        hall,
        m,
        "Another title defense is still in progress; queue priority retained",
      );
      continue;
    }
    // NPC defenses are challenger-started, so an unstarted NPC match never strikes the incumbent.
    if (
      missedObservation ||
      !m.checkedInAt ||
      row.user.status !== "AWAKE" ||
      v.kage?.isAi
    ) {
      if (missedObservation)
        await resetMatch(
          client,
          hall,
          m,
          "Attendance deadline reset after a service interruption",
        );
      else {
        m.status = "FORFEITED";
        await updateKageDefendedChallengesForSyncLockedKageDefense6(client, now, m);
      }
    } else {
      state.missedStarts += 1;
      m.status = "FORFEITED";
      await updateKageDefendedChallengesForSyncLockedKageDefense7(client, now, m);
      if (state.missedStarts >= KAGE_DEFENSE_MAX_NO_SHOWS) {
        await removeAbsentKage(client, hall);
        return false;
      }
    }
  }
  state.paused = hall.paused;
  state.observedAt = now.toISOString();
  pruneInstantChallenge(hall);
  if (!hall.paused && state.windows.length && v.kageId)
    await assignKageMatches(client, hall);
  await saveKageSchedule(client, hall);
  return true;
};

/** Move the publication deadline for interruptions; true when the incumbent has missed it. */
const advanceSetupDeadline = (
  hall: KageDefenseHall,
  priorObservation: Date,
  missedObservation: boolean,
) => {
  const { now, state, village: v } = hall;
  state.setupDueAt ??= initialKageSetupDeadline(v).toISOString();
  // The publication deadline freezes while war or service interruptions prevent participation.
  if (
    !state.publishedAt &&
    (hall.paused || state.paused || hall.warInterrupted || missedObservation)
  ) {
    state.setupDueAt = new Date(
      new Date(state.setupDueAt).getTime() +
        Math.max(0, now.getTime() - priorObservation.getTime()),
    ).toISOString();
  }
  // A war consumes the incumbent's attention, so a full setup window follows its end.
  if (!state.publishedAt && hall.lastWarEndedAt) {
    const postWarDeadline = secondsFromDate(
      KAGE_DEFENSE_SETUP_HOURS * 3600,
      hall.lastWarEndedAt,
    );
    if (postWarDeadline > new Date(state.setupDueAt))
      state.setupDueAt = postWarDeadline.toISOString();
  }
  return (
    !!v.kage &&
    !v.kage.isAi &&
    !state.publishedAt &&
    now >= new Date(state.setupDueAt) &&
    !hall.paused
  );
};

/**
 * Revoke an invitation when its appointment or mode changes. Expiry never changes
 * attendance, queue priority or the original match's reschedule allowance.
 */
const pruneInstantChallenge = (hall: KageDefenseHall) => {
  const { now, state } = hall;
  const invitation = state.instantChallenge;
  if (
    invitation &&
    (hall.resetAssignments ||
      now >= new Date(invitation.expiresAt) ||
      !hall.rows.some(
        ({ match }) =>
          match.id === invitation.matchId &&
          match.status === "SCHEDULED" &&
          !match.hospitalDeferred &&
          match.scheduledAt?.toISOString() === invitation.scheduledAt &&
          (match.aiRequested && match.aiAccepted) === invitation.ai,
      ))
  )
    delete state.instantChallenge;
};

/** Requeue with fresh notice and consent while retaining FIFO priority and reschedule usage. */
const resetMatch = async (
  client: DrizzleClient,
  hall: KageDefenseHall,
  m: KageDefendedChallenge,
  outcome: string,
) => {
  const update = {
    status: "QUEUED" as const,
    scheduledAt: null,
    checkedInAt: null,
    hospitalDeferred: false,
    kageId: hall.village.kageId,
    tenure: hall.village.leaderUpdatedAt,
    aiAccepted: false,
    notBefore: secondsFromDate(KAGE_DEFENSE_NOTICE_HOURS * 3600, hall.now),
    outcome,
  };
  Object.assign(m, update);
  await updateKageDefendedChallengesForResetMatch(client, update, m);
};

/**
 * Assign published UTC slots in FIFO order under the village lock, preserving valid slots.
 * Started matches alone consume calendar limits; queue changes and schedule JSON commit together.
 */
export const assignKageMatches = async (
  client: DrizzleClient,
  hall: KageDefenseHall,
) => {
  const pending = hall.rows.filter(
    ({ match: m }) => m.status === "QUEUED" || m.status === "SCHEDULED",
  );
  if (!pending.length) return;
  let history: KageDefendedChallenge[] | undefined;
  const occupied = new Set(
    hall.rows
      .filter(
        ({ match: m }) =>
          m.scheduledAt && (m.status === "BATTLE" || m.status === "STARTING"),
      )
      .map(({ match: m }) => m.scheduledAt?.getTime()),
  );
  let after: Date | null = null;
  for (const { match: m } of pending) {
    if (m.status === "SCHEDULED" && m.scheduledAt) {
      if (!after || m.scheduledAt >= after) {
        after = secondsFromDate(KAGE_DEFENSE_SLOT_MINUTES * 60, m.scheduledAt);
        continue;
      }
      await resetMatch(
        client,
        hall,
        m,
        "Earlier queue entry was reassigned; priority retained",
      );
    }
    // Preserved appointments need no calendar-limit history; share one read for new slots.
    history ??= await listKageDefendedChallengesForAssignKageMatches(
      client,
      pending,
      hall,
    );
    const challengerHistory = history.filter((h) => h.userId === m.userId);
    const slots = getKageSlots(
      hall.state.windows,
      new Date(
        Math.max(
          after?.getTime() ?? hall.now.getTime(),
          m.notBefore.getTime(),
          hall.now.getTime(),
        ),
      ),
      pending.length * 7 + 14,
    );
    const assigned = slots.find(
      (date) =>
        !occupied.has(date.getTime()) &&
        withinKageChallengeLimits(challengerHistory, date),
    );
    if (!assigned) continue;
    const update = {
      status: "SCHEDULED" as const,
      scheduledAt: assigned,
      kageId: hall.village.kageId,
      tenure: hall.village.leaderUpdatedAt,
    };
    Object.assign(m, update);
    occupied.add(assigned.getTime());
    after = secondsFromDate(KAGE_DEFENSE_SLOT_MINUTES * 60, assigned);
    await updateKageDefendedChallengesForAssignKageMatches(client, update, m);
  }
};

/** Whether another start fits the UTC day and Monday-based week containing the proposed time. */
export const withinKageChallengeLimits = (
  matches: Pick<KageDefendedChallenge, "startedAt">[],
  now: Date,
) => {
  const day = periodStart("daily", now),
    week = periodStart("weekly", now);
  const countSince = (start: Date) =>
    matches.filter((m) => m.startedAt && m.startedAt >= start && m.startedAt <= now)
      .length;
  return (
    countSince(day) < KAGE_CHALLENGER_DAILY_LIMIT &&
    countSince(week) < KAGE_CHALLENGER_WEEKLY_LIMIT
  );
};

/**
 * Replace an absent incumbent with an eligible elder, or leave a public vacancy.
 * Rank, tenure, waiting assignments, the staff audit row and the announcement change
 * together in the caller's village transaction, so retries cannot duplicate them.
 */
const removeAbsentKage = async (client: DrizzleClient, hall: KageDefenseHall) => {
  const { now, village: v } = hall;
  const candidates = await listUserDataForRemoveAbsentKage(client, v);
  const replacement = candidates.find(
    (u) => u.userId !== v.kageId && (u.isAi || !getKageEligibility(u, v.id)),
  );
  const removedUsername = v.kage?.username ?? v.kageId;
  const removal = {
    removedUserId: v.kageId,
    removedUsername,
    removedAt: now.toISOString(),
    reason: hall.state.publishedAt
      ? `Kage removed after ${KAGE_DEFENSE_MAX_NO_SHOWS} missed attended defenses`
      : `Kage removed for not publishing a defense schedule within ${KAGE_DEFENSE_SETUP_HOURS} hours`,
  };
  // An appointed elder starts a fresh tenure that still shows why the title changed hands.
  const nextSchedule: KageDefenseSchedule = {
    kageId: replacement?.userId ?? "",
    tenure: now.toISOString(),
    windows: [],
    publishedAt: null,
    missedStarts: 0,
    paused: false,
    observedAt: now.toISOString(),
    ...(replacement
      ? { predecessor: removal }
      : { vacancy: { removedUserId: removal.removedUserId, reason: removal.reason } }),
  };
  const succession = await updateVillageForRemoveAbsentKage(
    client,
    replacement,
    now,
    nextSchedule,
    v,
  );
  if (!succession.rowsAffected) return;
  if (replacement?.rank === "ELDER" && !replacement.isAi)
    await setKageCandidateToJonin(client, replacement);
  await updateKageDefendedChallengesForRemoveAbsentKage(client, now, v);
  const successor = replacement
    ? `${replacement.username} of the Elder Council is now Kage.`
    : "Elders may nominate an eligible successor at Town Hall.";
  await insertActionLogForRemoveAbsentKage(
    client,
    v,
    removedUsername,
    removal,
    hall,
    replacement,
  );
  // Publish one system announcement; unread counters determine who receives it.
  await insertNotificationForRemoveAbsentKage(
    client,
    removedUsername,
    v,
    removal,
    successor,
  );
  await updateUserDataForRemoveAbsentKage2(client, v, replacement);
};

/** Reuse fresh public state, reconciling stale deadlines or unassigned challengers before display. */
export const getKageDefensePublic = async (
  client: DrizzleClient,
  villageId: string,
) => {
  const current = await readKageDefensePublic(client, villageId);
  if (!current) return null;
  const state = current.schedule;
  // Fresh polls reuse persisted state. Stale reads still recover interruptions before display.
  if (
    state &&
    state.kageId === current.kageId &&
    new Date(state.observedAt) >
      secondsFromDate(-KAGE_DEFENSE_PUBLIC_SYNC_SECONDS, new Date()) &&
    !(
      state.windows.length &&
      !state.paused &&
      current.queue.some((m) => m.status === "QUEUED")
    )
  )
    return current;
  await syncKageDefense(client, villageId);
  return readKageDefensePublic(client, villageId);
};

/** Read the public schedule, FIFO queue and bounded outcome history in parallel. */
const readKageDefensePublic = async (client: DrizzleClient, villageId: string) => {
  const [v, queue, history] = await Promise.all([
    findVillageForReadKageDefensePublic(client, villageId),
    selectKageDefendedChallengesForReadKageDefensePublic(
      client,
      villageId,
      activeKageMatchStatuses,
    ),
    selectKageDefendedChallengesForReadKageDefensePublic2(client, villageId),
  ]);
  if (!v) return null;
  return {
    kage: v.kage,
    kageId: v.kageId,
    schedule: v.kageSchedule,
    setupDeadline: v.kageSchedule?.setupDueAt
      ? new Date(v.kageSchedule.setupDueAt)
      : initialKageSetupDeadline(v),
    queue,
    history,
  };
};

/**
 * Keep idle tenures observed without loading combatants or opening transactions.
 * Active matches, expired setup deadlines and interrupted observations retain full
 * reconciliation. The version/tenure guard lets concurrent queue or leadership
 * changes win without overwriting their schedule; the next tick observes them.
 */
export const maintainKageDefenses = async (client: DrizzleClient) => {
  const now = new Date();
  const uninterruptedSince = secondsFromDate(-KAGE_DEFENSE_GRACE_MINUTES * 60, now);
  const villages = await selectVillageForMaintainKageDefenses(
    client,
    activeKageMatchStatuses,
    uninterruptedSince,
  );
  await Promise.all(
    villages.map(async (v) => {
      const state = v.state;
      if (
        !state ||
        state.kageId !== v.kageId ||
        state.tenure !== v.leaderUpdatedAt.toISOString() ||
        !state.setupDueAt ||
        state.paused ||
        v.hasMatches ||
        v.hasWar ||
        !(new Date(state.observedAt) >= uninterruptedSince) ||
        (!state.publishedAt && v.kageId && !(now < new Date(state.setupDueAt)))
      ) {
        await syncKageDefense(client, v.id);
        return;
      }
      await updateVillageForMaintainKageDefenses(client, state, now, v);
    }),
  );
};
