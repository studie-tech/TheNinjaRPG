import type { UserQueueState } from "@/deltas/profile";
import type { GameSetting } from "@/drizzle/schema";
import type { EventGameSettingName } from "@/libs/gameSettingBoost";
import { getGlobalGameSettingNotification } from "@/libs/gameSettingBoost";
import { calcActiveUserRegen } from "@/libs/profile";
import { hasEnergyQueue } from "@/libs/queue";

/**
 * Refresh the changed global-boost notice and recompute cached regeneration when its
 * multiplier changes.
 */
export const getSetEventGameSettingUserUpdate = ({
  inputSetting,
  user,
  changedSettings,
  setting,
}: {
  inputSetting: EventGameSettingName;
  user: Parameters<typeof calcActiveUserRegen>[0];
  changedSettings: GameSetting[];
  setting: Pick<GameSetting, "value" | "time"> & { name: EventGameSettingName };
}) => ({
  userPatch:
    inputSetting === "regenGainMultiplier"
      ? {
          regeneration: calcActiveUserRegen(user, changedSettings),
          regenerationWithoutTimedBuffs: calcActiveUserRegen(
            user,
            changedSettings,
            false,
          ),
        }
      : {},
  userNotifications: {
    globalBoost: {
      setting: inputSetting,
      notice: getGlobalGameSettingNotification(inputSetting, setting),
    },
  },
});

/**
 * Project only a fully confirmed integer money award that includes the caller and has no
 * queued energy work. Reputation grants and other uncertain award effects require
 * reconciliation.
 */
export const getAwardReputationUserUpdate = ({
  inputReputationAmount,
  inputUserIds,
  ctxUserId,
  admin,
  creditedRowsAffected,
  usersLength,
  inputMoneyAmount,
}: {
  inputReputationAmount: number | undefined;
  inputUserIds: string[];
  ctxUserId: string;
  admin: UserQueueState;
  creditedRowsAffected: number;
  usersLength: number;
  inputMoneyAmount: number | undefined;
}) => ({
  userDelta:
    !inputReputationAmount &&
    inputUserIds.includes(ctxUserId) &&
    !hasEnergyQueue(admin) &&
    creditedRowsAffected === usersLength &&
    Number.isInteger(inputMoneyAmount ?? 0)
      ? { money: inputMoneyAmount ?? 0 }
      : undefined,
});
