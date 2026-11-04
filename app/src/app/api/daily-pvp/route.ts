import { and, eq, lt } from "drizzle-orm";
import { userData } from "@/drizzle/schema";
import {
  getGameSetting,
  handleEndpointError,
  lockWithDailyTimer,
} from "@/libs/gamesettings";
import { updateAnbuSquadForDecayClansAndAnbu } from "@/queries/anbu";
import { updateClanForDecayClansAndAnbu } from "@/queries/clan";
import { updateGameSettingForDecayClansAndAnbu } from "@/queries/gamesettings";
import {
  selectUserDataForDecayPlayerPvpExperience,
  updateUserDataForDecayPlayerPvpExperience,
} from "@/queries/pvprank";
import { drizzleDB } from "@/server/db";
import { authenticateCronRequest } from "@/server/utils/cron";
import { retryOnDeadlock } from "@/server/utils/mysqlErrors";
import { periodStart } from "@/utils/time";

const ENDPOINT_NAME = "daily-pvp";

/**
 * Marker for the clan and ANBU decay. Its time is moved to the start of the day in the
 * same transaction as the decay itself, so a retried run (the endpoint timer is released
 * on failure) cannot apply the boost/pvpActivity decay a second time.
 */
const GROUP_DECAY_MARKER = "daily-pvp-group-decay";

/** Players decayed per statement; keeps each statement's row locks short. */
const USER_DECAY_BATCH_SIZE = 1000;

export async function GET(request: Request) {
  const authError = authenticateCronRequest(request);
  if (authError) return authError;

  // Check timer
  const timerCheck = await lockWithDailyTimer(drizzleDB, ENDPOINT_NAME);
  if (!timerCheck.isNewDay && timerCheck.response) return timerCheck.response;

  // Perform work. Every step is guarded per day, so a retry after a partial failure
  // only finishes what is left. Steps run one after another rather than in parallel.
  try {
    const dayStart = periodStart("daily", new Date());
    await decayClansAndAnbu(dayStart);
    await decayPlayerPvpExperience(dayStart);
    return Response.json(`OK`);
  } catch (cause) {
    // Rollback
    await timerCheck.release();
    return await handleEndpointError(cause);
  }
}

/** Daily clan boost and clan/ANBU pvpActivity decay, applied at most once per day. */
const decayClansAndAnbu = async (dayStart: Date) => {
  const marker = await getGameSetting(drizzleDB, GROUP_DECAY_MARKER);
  if (marker.time >= dayStart) return;
  await retryOnDeadlock(() =>
    drizzleDB.transaction(async (tx) => {
      const claim = await updateGameSettingForDecayClansAndAnbu(tx, dayStart, marker);
      if (claim.rowsAffected !== 1) return;
      await updateAnbuSquadForDecayClansAndAnbu(tx);
      await updateClanForDecayClansAndAnbu(tx);
    }),
  );
};

/**
 * Daily player PvP XP decay, guarded per player by pvpExperienceDecayAt. One bulk
 * UPDATE over every player locked ~48k rows (there is no index on the guard column)
 * and lost a deadlock against live player writes, so the candidates are read first
 * and decayed in primary-key batches that each lock only their own rows.
 */
const decayPlayerPvpExperience = async (dayStart: Date) => {
  const pending = and(
    eq(userData.isAi, false),
    lt(userData.pvpExperienceDecayAt, dayStart),
  );
  const candidates = await selectUserDataForDecayPlayerPvpExperience(
    drizzleDB,
    pending,
  );
  const userIds = candidates.map((c) => c.userId);
  for (let i = 0; i < userIds.length; i += USER_DECAY_BATCH_SIZE) {
    const batch = userIds.slice(i, i + USER_DECAY_BATCH_SIZE);
    // Leave updatedAt alone: it doubles as last activity (online counts, cleanup,
    // sector lists), and no snapshot claim writes these columns as absolute values.
    await retryOnDeadlock(() =>
      updateUserDataForDecayPlayerPvpExperience(drizzleDB, dayStart, batch, pending),
    );
  }
};
