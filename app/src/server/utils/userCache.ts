import * as Sentry from "@sentry/nextjs";
import { and, eq, gt, ne } from "drizzle-orm";
import type { UserData } from "@/drizzle/schema";
import { userData, userItem, userSkill } from "@/drizzle/schema";
import { effectiveMasteries } from "@/libs/mastery";
import { calcMaxEnergy } from "@/libs/profile";
import type { DrizzleClient } from "@/server/db";

type UserBalanceField = "money" | "bank" | "reputationPoints" | "seichiSilver";

/** Read only balances changed by the mutation, without loading profile relations. */
export const fetchUserBalances = async (
  client: DrizzleClient,
  userId: string,
  fields: readonly UserBalanceField[] = [
    "money",
    "bank",
    "reputationPoints",
    "seichiSilver",
  ],
): Promise<Partial<Pick<UserData, UserBalanceField>> | undefined> => {
  const user = await client.query.userData
    .findFirst({
      columns: {
        money: fields.includes("money"),
        bank: fields.includes("bank"),
        reputationPoints: fields.includes("reputationPoints"),
        seichiSilver: fields.includes("seichiSilver"),
        energyTrainingQueue: true,
      },
      where: eq(userData.userId, userId),
    })
    .catch(handleUserCacheReadError);
  if (!user || user.energyTrainingQueue?.length) return;
  const { energyTrainingQueue: _queue, ...balances } = user;
  return balances;
};

export const fetchUserBloodright = async (client: DrizzleClient, userId: string) => {
  return await client.query.userData
    .findFirst({
      columns: {
        bloodright: true,
        bloodrightSpent: true,
        monthlySkillResets: true,
        seichiSilver: true,
        reputationPoints: true,
      },
      where: eq(userData.userId, userId),
    })
    .catch(handleUserCacheReadError);
};

/** Refresh worn gear and the values derived from it without quest or notification work. */
export const fetchUserEquipment = async (client: DrizzleClient, userId: string) => {
  const user = await client.query.userData
    .findFirst({
      columns: {
        money: true,
        bank: true,
        reputationPoints: true,
        seichiSilver: true,
        curEnergy: true,
        curHealth: true,
        curChakra: true,
        curStamina: true,
        regenAt: true,
        energyTrainingQueue: true,
        itemLoadout: true,
        level: true,
        rank: true,
        isAi: true,
        bloodlineId: true,
        ninjutsuMastery: true,
        genjutsuMastery: true,
        taijutsuMastery: true,
        bukijutsuMastery: true,
        bloodlineMastery: true,
        sageMastery: true,
      },
      where: eq(userData.userId, userId),
      with: {
        bloodline: { columns: { effects: true } },
        userSkills: {
          where: eq(userSkill.activated, true),
          with: { skill: { columns: { target: true, effects: true } } },
        },
        items: {
          where: and(ne(userItem.equipped, "NONE"), gt(userItem.quantity, 0)),
          with: { item: true, imbuements: { with: { item: true } } },
        },
      },
    })
    .catch(handleUserCacheReadError);
  if (!user || user.energyTrainingQueue?.length) return;
  return {
    money: user.money,
    bank: user.bank,
    reputationPoints: user.reputationPoints,
    seichiSilver: user.seichiSilver,
    curEnergy: user.curEnergy,
    curHealth: user.curHealth,
    curChakra: user.curChakra,
    curStamina: user.curStamina,
    regenAt: user.regenAt,
    itemLoadout: user.itemLoadout,
    items: user.items,
    maxEnergy: calcMaxEnergy(user),
    effectiveMasteries: effectiveMasteries(user),
  };
};

/** Cache reads follow committed writes; failure falls back to the normal profile refresh. */
export const handleUserCacheReadError = (error: unknown): undefined => {
  Sentry.captureException(error, {
    level: "warning",
    tags: { source: "userCacheRead" },
  });
  return undefined;
};
