import * as Sentry from "@sentry/nextjs";
import { and, eq, isNull, type SQL, sql } from "drizzle-orm";
import { after } from "next/server";
import {
  getActionRecoveryActivity,
  getActionRecoveryUpdate,
} from "@/deltas/actionReadiness";
import { CombatStatNames, MasteryNames, REGEN_SECONDS } from "@/drizzle/constants";
import { type GameSetting, type UserData, userData } from "@/drizzle/schema";
import {
  AUTO_CHECKOUT_MESSAGE,
  AUTO_WAKE_MESSAGE,
  actionStatusMessage,
} from "@/libs/actionReadiness";
import { calcHealCost, calcHealFinish } from "@/libs/hospital";
import { petExperienceGainSql } from "@/libs/pets/experience";
import { calcActiveUserRegen, calcMaxEnergy } from "@/libs/profile";
import { filterQuestTrackersForDbPersist, getNewTrackers } from "@/libs/quest";
import { getTimedRegenerationGain } from "@/libs/timedBuffs";
import { regenerationBuffs } from "@/libs/titles";
import { applyMasteryTrainingGains, settleQueuedTraining } from "@/libs/train";
import { insertTrainingLogForInitiateBattle } from "@/queries/combat";
import type { UserWithRelations } from "@/server/api/routers/profile";
import type { DrizzleClient } from "@/server/db";
import {
  elementalSnapshotConditions,
  masteryGainUpdates,
} from "@/server/utils/masteryProgression";
import { pushActivityUpdate } from "@/server/utils/push/liveActivity";
import { getUserRegenerationGain } from "@/server/utils/regeneration";
import { getStrucBoost } from "@/utils/village";
import type { UserRecovery, UserRecoveryActivity } from "@/validators/base";
import type { UserCachePatch } from "@/validators/userCache";

/** Recovery columns and predicates composed into an endpoint's existing account write. */
export type ActionReadinessWrite = {
  set: Partial<{ [K in keyof UserData]: UserData[K] | SQL }>;
  where: SQL | undefined;
};

/** An uncommitted recovery plan; callers report its notice only after the guarded write succeeds. */
export type ActionReadiness<T extends UserData = UserData> = ActionReadinessWrite & {
  initial: T;
  user: T;
  notice?: string;
  error?: string;
  /** Completed queue work is logged after the guarded recovery commits. */
  trainingLogs?: Parameters<typeof insertTrainingLogForInitiateBattle>[1];
  /** Stable recovery-only cache fields, captured before the endpoint mutates its actor. */
  userRecovery?: UserRecovery;
};

/**
 * Validate an already-loaded actor and project recovery without database access.
 * Endpoints merge set/where into their account claim, with their final activity status taking precedence.
 * Hydrated profiles retain their accrued regeneration rate; loaded settings settle regeneration and queued training.
 * Use the complete action/profile snapshot: equipment and active skills affect Energy,
 * and queued training needs quest relations. Missing relations are not fetched here.
 */
export const prepareActionReadiness = <T extends UserData>(
  initial: T,
  settings: GameSetting[],
  now = new Date(),
): ActionReadiness<T> => {
  const related = initial as T &
    Parameters<typeof calcActiveUserRegen>[0] & {
      regenerationWithoutTimedBuffs?: number;
      queue?: NonNullable<UserWithRelations>["queue"];
    };
  const structures = related.village?.structures;
  const unchanged = {
    initial,
    user: initial,
    set: {},
    where: eq(userData.status, initial.status),
  };
  if (initial.status === "AWAKE") return unchanged;
  if (initial.isBanned) return { ...unchanged, error: "You are banned." };
  const wakes = initial.status === "ASLEEP" && initial.autoWakeUp;
  const checksOut =
    initial.status === "HOSPITALIZED" &&
    (calcHealCost(initial) === 0 ||
      calcHealFinish({
        user: initial,
        boost: getStrucBoost("hospitalSpeedupPerLvl", structures),
      }) <= now);
  if ((!wakes && !checksOut) || initial.battleId)
    return { ...unchanged, error: actionStatusMessage(initial.status) };

  const regeneration =
    related.regenerationWithoutTimedBuffs ??
    calcActiveUserRegen(related, settings, false);
  const maxEnergy = calcMaxEnergy(related);
  const gain = getUserRegenerationGain(
    { ...related, regenerationWithoutTimedBuffs: regeneration },
    now,
  );
  const ticks = Math.max(
    0,
    Math.floor((now.getTime() - initial.regenAt.getTime()) / (REGEN_SECONDS * 1000)),
  );
  const set: ActionReadinessWrite["set"] = {
    status: "AWAKE",
    ...(checksOut ? { warTornRespawn: false } : {}),
    curHealth: checksOut
      ? initial.maxHealth
      : Math.round(Math.min(initial.maxHealth, initial.curHealth + gain)),
    ...(wakes
      ? {
          curChakra: Math.round(Math.min(initial.maxChakra, initial.curChakra + gain)),
          curStamina: Math.round(
            Math.min(initial.maxStamina, initial.curStamina + gain),
          ),
        }
      : {}),
    curEnergy: Math.min(maxEnergy, initial.curEnergy + gain),
    maxEnergy,
    regenAt: checksOut
      ? now
      : new Date(initial.regenAt.getTime() + ticks * REGEN_SECONDS * 1000),
  };
  const user = { ...initial, ...set } as T;
  const trainingGuards: (SQL | undefined)[] = [];
  const trainingLogs: NonNullable<ActionReadiness["trainingLogs"]> = [];
  if (wakes && related.queue) {
    // Consume loaded queue heads with the same guarded write as recovery; waking never refunds queued Energy.
    const queued = settleQueuedTraining(
      {
        ...related,
        status: "AWAKE",
        regeneration,
        maxEnergy,
      } as unknown as NonNullable<UserWithRelations>,
      related.queue,
      settings,
      ticks,
      now,
      (from, to) =>
        getTimedRegenerationGain(
          regeneration,
          regenerationBuffs(related),
          new Date(initial.regenAt.getTime() + from * REGEN_SECONDS * 1000),
          to - from,
          REGEN_SECONDS,
        ),
    );
    const tasks: Parameters<typeof getNewTrackers>[1] = [];
    if (queued.energy) {
      trainingGuards.push(
        eq(userData.sector, initial.sector),
        eq(userData.longitude, initial.longitude),
        eq(userData.latitude, initial.latitude),
        eq(userData.rank, initial.rank),
        eq(userData.isOutlaw, initial.isOutlaw),
      );
      const amount = queued.energy.completed.reduce(
        (sum, entry) => sum + entry.amount,
        0,
      );
      user.curEnergy = queued.energy.curEnergy;
      user.energyQueueHead = queued.energy.head;
      user.experience = Math.round(initial.experience + amount);
      Object.assign(set, {
        curEnergy: user.curEnergy,
        energyQueueHead: user.energyQueueHead,
        experience: sql`${userData.experience} + ${amount}`,
        petExperience: petExperienceGainSql(amount),
      });
      for (const stat of CombatStatNames) {
        const gain = queued.energy.gains[stat] ?? 0;
        if (gain) {
          user[stat] += gain;
          set[stat] = sql`${userData[stat]} + ${gain}`;
        }
      }
      if (amount > 0) tasks.push({ task: "stats_trained", increment: amount });
      trainingLogs.push(
        ...queued.energy.completed.map((entry) => ({
          userId: initial.userId,
          stat: entry.stat,
          amount: entry.amount,
          speed: initial.trainingSpeed,
          trainingFinishedAt: now,
        })),
      );
    }
    if (queued.mastery) {
      const gains = applyMasteryTrainingGains(initial, queued.mastery.gains);
      Object.assign(user, gains, queued.mastery.update);
      Object.assign(
        set,
        queued.mastery.update,
        masteryGainUpdates(queued.mastery.gains),
        { elementalMastery: user.elementalMastery },
      );
      trainingGuards.push(
        ...elementalSnapshotConditions(initial),
        ...MasteryNames.map((stat) => eq(userData[stat], initial[stat])),
        sql`${userData.masteryRanks} = CAST(${JSON.stringify(initial.masteryRanks)} AS JSON)`,
        initial.currentlyTrainingMastery
          ? eq(userData.currentlyTrainingMastery, initial.currentlyTrainingMastery)
          : isNull(userData.currentlyTrainingMastery),
        initial.masteryTrainingStartedAt
          ? eq(userData.masteryTrainingStartedAt, initial.masteryTrainingStartedAt)
          : isNull(userData.masteryTrainingStartedAt),
        initial.currentlyTrainingElement
          ? eq(userData.currentlyTrainingElement, initial.currentlyTrainingElement)
          : isNull(userData.currentlyTrainingElement),
        initial.elementalTrainingStartedAt
          ? eq(userData.elementalTrainingStartedAt, initial.elementalTrainingStartedAt)
          : isNull(userData.elementalTrainingStartedAt),
      );
      trainingLogs.push(
        ...queued.mastery.completed.map((entry) => ({
          userId: initial.userId,
          stat: entry.stat,
          amount: entry.amount,
          speed: entry.speed,
          trainingFinishedAt: entry.finishedAt,
        })),
      );
      user.maxEnergy = calcMaxEnergy(user as typeof related);
      set.maxEnergy = user.maxEnergy;
      const minutes = queued.mastery.completed.reduce(
        (sum, entry) => sum + entry.minutes,
        0,
      );
      if (minutes > 0) tasks.push({ task: "minutes_training", increment: minutes });
    }
    if (tasks.length) {
      user.questData = filterQuestTrackersForDbPersist(
        getNewTrackers(user as unknown as NonNullable<UserWithRelations>, tasks)
          .trackers,
        user as unknown as NonNullable<UserWithRelations>,
      );
      set.questData = user.questData;
    }
  }
  const userRecovery = getActionRecoveryUpdate(
    initial,
    user,
    Object.keys(set) as (keyof UserData)[],
    settings,
    now,
  );
  if (userRecovery.userPatch) {
    // Feature builders consume the recovered actor too; keep their derived values on the same awake baseline.
    Object.assign(user, {
      baseRegeneration:
        (related as typeof related & { baseRegeneration?: number }).baseRegeneration ??
        initial.regeneration,
      regeneration: userRecovery.userPatch.regeneration,
      regenerationWithoutTimedBuffs:
        userRecovery.userPatch.regenerationWithoutTimedBuffs,
      effectiveMasteries: userRecovery.userPatch.effectiveMasteries,
    });
  }
  return {
    initial,
    user,
    set,
    where: and(
      eq(userData.status, initial.status),
      eq(userData.updatedAt, initial.updatedAt),
      eq(userData.regenAt, initial.regenAt),
      eq(userData.isBanned, false),
      isNull(userData.battleId),
      wakes ? eq(userData.autoWakeUp, true) : undefined,
      initial.villageId
        ? eq(userData.villageId, initial.villageId)
        : isNull(userData.villageId),
      ...trainingGuards,
    ),
    trainingLogs,
    userRecovery,
    notice: wakes ? AUTO_WAKE_MESSAGE : AUTO_CHECKOUT_MESSAGE,
  };
};

/**
 * Attach confirmed recovery to the endpoint outcome and optionally defer its history/activity publication.
 * Call only after the account write succeeds; deferred work adds no database phase to the mutation response.
 * Supply the client for a full committed plan to publish training logs and end hospital activity.
 * Notice-only wrappers omit it when the inner action already publishes recovery.
 * Supply final activity when it differs from the saved actor or the action's public patch.
 * Supply null when compensation loses its activity guard: retain only recovery identity,
 * withholding cache fields without introducing an eager profile refresh.
 */
export const actionReadinessResponse = <T extends { message?: string }>(
  response: T,
  readiness:
    | Pick<
        ActionReadiness,
        "notice" | "trainingLogs" | "initial" | "user" | "userRecovery"
      >
    | Pick<ActionReadiness, "notice">
    | undefined,
  client?: DrizzleClient,
  activity?: UserRecoveryActivity | null,
): T & { actionNotice?: string; userRecovery?: UserRecovery } => {
  if (!readiness?.notice) return response;
  if (client && "initial" in readiness && "user" in readiness) {
    const confirmed = readiness;
    after(async () => {
      try {
        await Promise.all([
          "trainingLogs" in confirmed && confirmed.trainingLogs?.length
            ? insertTrainingLogForInitiateBattle(client, confirmed.trainingLogs)
            : undefined,
          confirmed.initial.status === "HOSPITALIZED"
            ? pushActivityUpdate(
                client,
                [confirmed.initial.userId],
                "hospital",
                { title: "Recovered", endsAt: new Date() },
                "end",
              )
            : undefined,
        ]);
      } catch (error) {
        // Recovery is committed; publication failure must not turn the action into a rejection.
        Sentry.captureException(error, {
          tags: { source: "actionReadiness.publication" },
        });
      }
    });
  }
  return {
    ...response,
    message:
      response.message && response.message !== "OK"
        ? response.message.includes(readiness.notice)
          ? response.message
          : `${response.message} ${readiness.notice}`
        : readiness.notice,
    actionNotice: readiness.notice,
    ...("userRecovery" in readiness || activity === null
      ? {
          userRecovery:
            activity === null
              ? "initial" in readiness
                ? { userId: readiness.initial.userId, requiresUserRefresh: true }
                : undefined
              : "userRecovery" in readiness && readiness.userRecovery
                ? {
                    ...readiness.userRecovery,
                    activity: getActionRecoveryActivity(
                      readiness.user,
                      "userPatch" in response
                        ? (response.userPatch as UserCachePatch | undefined)
                        : undefined,
                      activity ??
                        ("userRecovery" in response
                          ? (response.userRecovery as UserRecovery | undefined)
                              ?.activity
                          : undefined),
                    ),
                  }
                : undefined,
        }
      : {}),
  };
};
