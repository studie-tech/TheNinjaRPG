import type { UserQueueState } from "@/delta/profile";
import { getGlobalGameSettingNotification } from "@/libs/gameSettingBoost";
import { calcActiveUserRegen } from "@/libs/profile";
import { hasEnergyQueue } from "@/libs/queue";

export const getSetEventGameSettingUserUpdate = ({
  inputSetting,
  user,
  changedSettings,
  setting,
}: {
  inputSetting:
    | "trainingGainMultiplier"
    | "regenGainMultiplier"
    | "battleExpMultiplier"
    | "missionExpMultiplier"
    | "jutsuExpMultiplier"
    | "itemExpMultiplier";
  user: Parameters<typeof calcActiveUserRegen>[0];
  changedSettings: {
    id: string;
    name: string;
    value: number;
    time: Date;
  }[];
  setting: {
    name:
      | "trainingGainMultiplier"
      | "regenGainMultiplier"
      | "battleExpMultiplier"
      | "missionExpMultiplier"
      | "jutsuExpMultiplier"
      | "itemExpMultiplier";
    value: number;
    time: Date;
  };
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
