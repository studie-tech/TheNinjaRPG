import * as Sentry from "@sentry/nextjs";
import { and, eq, isNull } from "drizzle-orm";
import { after } from "next/server";
import { userData } from "@/drizzle/schema";
import {
  AUTO_CHECKOUT_MESSAGE,
  AUTO_WAKE_MESSAGE,
  actionStatusMessage,
} from "@/libs/actionReadiness";
import { calcHealCost, calcHealFinish } from "@/libs/hospital";
import { getServerPusher, updateUserOnMap } from "@/libs/pusher";
import { wakeUserForAction } from "@/queries/home";
import { updateUserDataForNpcHeal } from "@/queries/hospital";
import { fetchStructures } from "@/queries/village";
import { fetchUpdatedUser } from "@/routers/profile";
import type { DrizzleClient } from "@/server/db";
import { pushActivityUpdate } from "@/server/utils/push/liveActivity";
import { userRegenerationGainSql } from "@/server/utils/regeneration";
import { getStrucBoost } from "@/utils/village";

/** Settle sleep recovery or free hospital checkout before the requested action runs. */
export const prepareCharacterForAction = async (
  client: DrizzleClient,
  userId: string,
  initial: { status: string; villageId: string | null },
) => {
  const [{ user }, structures] = await Promise.all([
    fetchUpdatedUser({
      client,
      userId,
      forceRegen: true,
      includeNotifications: false,
      rejectIsolatedPyramid: true,
    }),
    initial.status === "HOSPITALIZED" && initial.villageId
      ? fetchStructures(client, initial.villageId)
      : [],
  ]);
  if (!user || user.isBanned) return { error: "Your character is unavailable." };
  let notice: string;
  if (user.status === "AWAKE") return {};
  if (user.status === "ASLEEP" && user.autoWakeUp) {
    const result = await wakeUserForAction(client, user);
    if (!result.rowsAffected)
      return { error: "Your status or preference changed. Please try again." };
    notice = AUTO_WAKE_MESSAGE;
  } else if (user.status === "HOSPITALIZED") {
    if (user.villageId !== initial.villageId)
      return { error: "Your village changed. Please try again." };
    const now = new Date();
    const boost = getStrucBoost("hospitalSpeedupPerLvl", structures);
    if (calcHealFinish({ user, boost }) > now && calcHealCost(user) > 0) {
      return { error: actionStatusMessage(user.status) };
    }
    const result = await updateUserDataForNpcHeal(
      client,
      user,
      userRegenerationGainSql(user, userData.regenAt, now),
      now,
      { userId },
      and(
        eq(userData.updatedAt, user.updatedAt),
        eq(userData.regenAt, user.regenAt),
        eq(userData.isBanned, false),
        isNull(userData.battleId),
      ),
    );
    if (!result.rowsAffected)
      return { error: "Your status changed. Please try again." };
    user.curHealth = user.maxHealth;
    notice = AUTO_CHECKOUT_MESSAGE;
    after(() =>
      pushActivityUpdate(
        client,
        [userId],
        "hospital",
        { title: "Recovered", endsAt: now },
        "end",
      ),
    );
  } else {
    return { error: actionStatusMessage(user.status) };
  }
  // Publish only a committed transition. The action owns any later activity transition.
  await updateUserOnMap(getServerPusher(), user.sector, {
    ...user,
    status: "AWAKE",
  }).catch((error: unknown) => {
    // Recovery has committed; presence delivery must not prevent the requested action.
    Sentry.captureException(error, { tags: { source: "actionReadiness.presence" } });
  });
  return { notice };
};
