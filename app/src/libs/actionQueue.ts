import { and, asc, eq, gte, isNull, ne, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { ActionQueueType, UserStatName } from "@/drizzle/constants";
import {
  ACTION_QUEUE_BASE_SLOTS,
  ACTION_QUEUE_FED_GOLD_EXTRA,
  ACTION_QUEUE_FED_NORMAL_EXTRA,
  ACTION_QUEUE_FED_SILVER_EXTRA,
  CLAN_BOOST_MAX_LEVEL,
  CLAN_BOOST_PERCENT_PER_LEVEL,
  CONSUMABLE_CRAFTING_TIMES_MINS,
  CRAFTING_TIMES_MINS,
  JUTSU_LEVEL_CAP,
  JUTSU_MAX_BARRIER_EQUIPPED,
  JUTSU_MAX_EVENT_EQUIPPED,
  JUTSU_MAX_PIERCE_EQUIPPED,
  JUTSU_MAX_RESIDUAL_EQUIPPED,
  JUTSU_MAX_STUN_EQUIPPED,
  MAP_WAKE_ISLAND_SECTOR,
} from "@/drizzle/constants";
import type { UserData } from "@/drizzle/schema";
import { actionQueue, userData, userItem, userJutsu } from "@/drizzle/schema";
import {
  calculateItemConsumption,
  getCraftingRank,
  getTotalItemQuantity,
} from "@/libs/crafting";
import { filterQuestTrackersForDbPersist, getNewTrackers } from "@/libs/quest";
import {
  calcJutsuEquipLimit,
  calcJutsuTrainCost,
  calcJutsuTrainTime,
  canTrainJutsu,
  canUseJutsu,
} from "@/libs/train";
import { calcIsInVillage } from "@/libs/travel";
import { fetchStudents } from "@/routers/sensei";
import {
  fetchItemWithCraftingRequirements,
  fetchUserItems,
} from "@/server/api/routers/item";
import { fetchJutsu, fetchUserJutsus } from "@/server/api/routers/jutsu";
import { fetchUpdatedUser } from "@/server/api/routers/profile";
import type { DrizzleClient } from "@/server/db";
import {
  claimUserSnapshot,
  updateUserItemQuantityAtomically,
} from "@/server/utils/concurrency";
import { getUserFederalStatus } from "@/utils/paypal";
import { canChangeContent } from "@/utils/permissions";
import { getShrineBoost } from "@/utils/village";

type ExecuteResult = { success: boolean; message: string };

export const getActionQueueSlotLimit = (
  user: Pick<UserData, "staffAccount" | "federalStatus">,
) => {
  const status = getUserFederalStatus(user);
  let extra = 0;
  switch (status) {
    case "NORMAL":
      extra = ACTION_QUEUE_FED_NORMAL_EXTRA;
      break;
    case "SILVER":
      extra = ACTION_QUEUE_FED_SILVER_EXTRA;
      break;
    case "GOLD":
      extra = ACTION_QUEUE_FED_GOLD_EXTRA;
      break;
  }
  return ACTION_QUEUE_BASE_SLOTS + extra;
};

export const fetchUserActionQueue = async (client: DrizzleClient, userId: string) => {
  return client.query.actionQueue.findMany({
    where: eq(actionQueue.userId, userId),
    orderBy: [asc(actionQueue.queueType), asc(actionQueue.position)],
  });
};

export const countUserActionQueue = async (client: DrizzleClient, userId: string) => {
  const entries = await fetchUserActionQueue(client, userId);
  return entries.length;
};

export const getNextQueuePosition = async (
  client: DrizzleClient,
  userId: string,
  queueType: ActionQueueType,
) => {
  const entries = await client.query.actionQueue.findMany({
    where: and(eq(actionQueue.userId, userId), eq(actionQueue.queueType, queueType)),
    columns: { position: true },
    orderBy: [asc(actionQueue.position)],
  });
  if (entries.length === 0) return 0;
  return Math.max(...entries.map((e) => e.position)) + 1;
};

export const removeActionQueueEntry = async (
  client: DrizzleClient,
  userId: string,
  id: string,
) => {
  await client
    .delete(actionQueue)
    .where(and(eq(actionQueue.id, id), eq(actionQueue.userId, userId)));
};

export const computeProjectedJutsuTrainingLevel = (
  userJutsus: Awaited<ReturnType<typeof fetchUserJutsus>>,
  jutsuId: string,
  sameJutsuQueuedBefore: number,
) => {
  const userJutsu = userJutsus.find((j) => j.jutsuId === jutsuId);
  const baseLevel = userJutsu?.level ?? 0;
  return baseLevel + sameJutsuQueuedBefore;
};

export const executeJutsuTraining = async (props: {
  client: DrizzleClient;
  userId: string;
  jutsuId: string;
  trainingLevel?: number;
  requireNoActiveTraining?: boolean;
  skipMoneyDeduction?: boolean;
}): Promise<ExecuteResult & { data?: { money: number } }> => {
  const {
    client,
    userId,
    jutsuId,
    trainingLevel,
    requireNoActiveTraining = true,
    skipMoneyDeduction = false,
  } = props;

  const [data, info, userjutsus, students] = await Promise.all([
    fetchUpdatedUser({ client, userId }),
    fetchJutsu(client, jutsuId),
    fetchUserJutsus(client, userId),
    fetchStudents(client, userId),
  ]);
  const { user } = data;
  if (!user) return { success: false, message: "User not found" };
  if (!info) return { success: false, message: "Jutsu not found" };

  const userjutsuObj = userjutsus.find((j) => j.jutsuId === jutsuId);
  const equippedJutsus = userjutsus.filter((uj) => uj.equipped);
  const curEquip = equippedJutsus.length;
  const maxEquip = calcJutsuEquipLimit(user);
  const residualJutsus = equippedJutsus.filter((uj) =>
    uj.jutsu.effects.some((e) => "residualModifier" in e && e.residualModifier),
  );
  const pierceJutsus = equippedJutsus.filter((uj) =>
    uj.jutsu.effects.some((e) => e.type === "pierce"),
  );
  const eventJutsus = equippedJutsus.filter((uj) => uj.jutsu.jutsuType === "EVENT");
  const barrierJutsus = equippedJutsus.filter((uj) =>
    uj.jutsu.effects.some((e) => e.type === "barrier"),
  );
  const stunJutsus = equippedJutsus.filter((uj) =>
    uj.jutsu.effects.some((e) => e.type === "stun"),
  );

  if (!canTrainJutsu(info, user) && !info.parentJutsuId)
    return { success: false, message: "Jutsu not for you" };
  if (info.parentJutsuId && !userjutsuObj)
    return {
      success: false,
      message: "Evolution jutsus can only be obtained by evolving the parent jutsu",
    };
  if (info.parentJutsuId && userjutsuObj && !canUseJutsu(info, user))
    return { success: false, message: "Jutsu not for you" };
  if (
    userjutsus.some(
      (j) => j.jutsu.parentJutsuId === jutsuId || j.parentJutsuParentId === jutsuId,
    )
  )
    return { success: false, message: "You have already evolved this jutsu" };
  if (user.status !== "AWAKE") return { success: false, message: "Must be awake" };

  const level = trainingLevel ?? (userjutsuObj ? userjutsuObj.level : 0);
  if (level >= JUTSU_LEVEL_CAP) {
    return { success: false, message: "Jutsu is already at max level" };
  }
  if (info.hidden && !canChangeContent(user.role)) {
    return { success: false, message: "Jutsu is hidden, cannot be trained" };
  }
  if (
    requireNoActiveTraining &&
    userjutsus.find((j) => j.finishTraining && j.finishTraining > new Date())
  ) {
    return { success: false, message: "You are already training a jutsu" };
  }

  const trainTime = calcJutsuTrainTime(info, level, user);
  const trainCost = calcJutsuTrainCost(info, level, user, students);

  let questDataFull = user.questData ?? [];
  if (!userjutsuObj) {
    const { trackers } = getNewTrackers(user, [
      { task: "jutsus_mastered", increment: 1 },
    ]);
    questDataFull = trackers;
  }
  const questDataForDb = filterQuestTrackersForDbPersist(questDataFull, user);

  if (!skipMoneyDeduction) {
    const moneyUpdate = await client
      .update(userData)
      .set({
        money: sql`${userData.money} - ${trainCost}`,
        questData: questDataForDb,
      })
      .where(and(eq(userData.userId, userId), gte(userData.money, trainCost)));
    if (moneyUpdate.rowsAffected !== 1) {
      return { success: false, message: "You don't have enough money" };
    }
  } else if (!userjutsuObj) {
    await client
      .update(userData)
      .set({ questData: questDataForDb })
      .where(eq(userData.userId, userId));
  }

  if (userjutsuObj) {
    await client
      .update(userJutsu)
      .set({
        level: sql`${userJutsu.level} + 1`,
        finishTraining: new Date(Date.now() + trainTime),
        updatedAt: new Date(),
      })
      .where(and(eq(userJutsu.id, userjutsuObj.id), eq(userJutsu.userId, userId)));
  } else {
    const jutsuHasResidual = info.effects.some(
      (e) => "residualModifier" in e && e.residualModifier,
    );
    const jutsuHasPierce = info.effects.some((e) => e.type === "pierce");
    const jutsuIsEvent = info.jutsuType === "EVENT";
    const jutsuHasBarrier = info.effects.some((e) => e.type === "barrier");
    const jutsuHasStun = info.effects.some((e) => e.type === "stun");

    const canAutoEquip =
      curEquip < maxEquip &&
      (!jutsuHasResidual || residualJutsus.length < JUTSU_MAX_RESIDUAL_EQUIPPED) &&
      (!jutsuHasPierce || pierceJutsus.length < JUTSU_MAX_PIERCE_EQUIPPED) &&
      (!jutsuIsEvent || eventJutsus.length < JUTSU_MAX_EVENT_EQUIPPED) &&
      (!jutsuHasBarrier || barrierJutsus.length < JUTSU_MAX_BARRIER_EQUIPPED) &&
      (!jutsuHasStun || stunJutsus.length < JUTSU_MAX_STUN_EQUIPPED);

    await client
      .insert(userJutsu)
      .values({
        id: nanoid(),
        userId,
        jutsuId,
        finishTraining: new Date(Date.now() + trainTime),
        equipped: canAutoEquip,
      })
      .onDuplicateKeyUpdate({ set: { id: sql`id` } });
  }

  return {
    success: true,
    message: `You started training: ${info.name}`,
    data: { money: skipMoneyDeduction ? user.money : user.money - trainCost },
  };
};

export type QueuedMaterialRefund = {
  userItemId: string;
  itemId: string;
  consumeQuantity: number;
  quantityAfterPayment: number;
};

export const payCraftMaterialsUpfront = async (props: {
  client: DrizzleClient;
  userId: string;
  user: NonNullable<Awaited<ReturnType<typeof fetchUpdatedUser>>["user"]>;
  itemWithRequirements: NonNullable<
    Awaited<ReturnType<typeof fetchItemWithCraftingRequirements>>
  >;
  useritems: Awaited<ReturnType<typeof fetchUserItems>>;
  quantity: number;
}): Promise<{ success: true; refunds: QueuedMaterialRefund[] } | ExecuteResult> => {
  const { client, userId, user, itemWithRequirements, useritems, quantity } = props;

  const allConsumptions = [];
  for (const requirement of itemWithRequirements.craftingRequirements) {
    const requiredQuantity = requirement.quantity * quantity;
    const consumption = calculateItemConsumption(
      useritems,
      requirement.requirementItemId,
      requiredQuantity,
    );
    if (!consumption.hasEnough) {
      const itemName = requirement.requirementItem?.name || "Unknown item";
      return { success: false, message: `Insufficient ${itemName} for crafting` };
    }
    allConsumptions.push(...consumption.consumptions);
  }

  const craftClaimResult = await claimUserSnapshot({
    client,
    userId,
    updatedAt: user.updatedAt,
    where: [
      eq(userData.status, "AWAKE"),
      or(isNull(userData.sector), ne(userData.sector, MAP_WAKE_ISLAND_SECTOR)),
    ],
  });
  if (!craftClaimResult.success) {
    return {
      success: false,
      message: "Could not queue crafting — state changed, please try again",
    };
  }

  const materialUpdates = await Promise.all(
    allConsumptions.map((consumption) =>
      updateUserItemQuantityAtomically({
        client,
        userId,
        userItemId: consumption.userItemId,
        expectedQuantity: consumption.consumeQuantity + consumption.newQuantity,
        nextQuantity: consumption.newQuantity,
      }),
    ),
  );
  if (!materialUpdates.every(Boolean)) {
    return {
      success: false,
      message: "Could not queue crafting — materials changed, please try again",
    };
  }

  const userItemById = new Map(useritems.map((item) => [item.id, item]));
  const refunds: QueuedMaterialRefund[] = allConsumptions.map((consumption) => ({
    userItemId: consumption.userItemId,
    itemId: userItemById.get(consumption.userItemId)!.itemId,
    consumeQuantity: consumption.consumeQuantity,
    quantityAfterPayment: consumption.newQuantity,
  }));

  return { success: true, refunds };
};

export const refundQueuedCraftMaterials = async (
  client: DrizzleClient,
  userId: string,
  refunds: QueuedMaterialRefund[],
): Promise<boolean> => {
  for (const refund of refunds) {
    const restored = await client
      .update(userItem)
      .set({ quantity: sql`${userItem.quantity} + ${refund.consumeQuantity}` })
      .where(
        and(
          eq(userItem.id, refund.userItemId),
          eq(userItem.userId, userId),
          eq(userItem.quantity, refund.quantityAfterPayment),
        ),
      );
    if (restored.rowsAffected === 1) continue;

    const existing = await client.query.userItem.findFirst({
      where: and(eq(userItem.id, refund.userItemId), eq(userItem.userId, userId)),
    });
    if (existing) return false;

    const inserted = await client.insert(userItem).values({
      id: refund.userItemId,
      userId,
      itemId: refund.itemId,
      quantity: refund.consumeQuantity,
    });
    if (inserted.rowsAffected !== 1) return false;
  }
  return true;
};

export const removeActionQueueEntryWithRefund = async (
  client: DrizzleClient,
  userId: string,
  id: string,
): Promise<{
  found: boolean;
  refundedMoney: number;
  refundedMaterials: boolean;
  materialsRefundFailed: boolean;
}> => {
  const entry = await client.query.actionQueue.findFirst({
    where: and(eq(actionQueue.id, id), eq(actionQueue.userId, userId)),
  });
  if (!entry) {
    return {
      found: false,
      refundedMoney: 0,
      refundedMaterials: false,
      materialsRefundFailed: false,
    };
  }

  const refundedMoney = entry.moneyCost ?? 0;
  const materialRefunds = entry.queuedMaterialRefunds ?? [];

  if (materialRefunds.length > 0) {
    const ok = await refundQueuedCraftMaterials(client, userId, materialRefunds);
    if (!ok) {
      return {
        found: true,
        refundedMoney: 0,
        refundedMaterials: false,
        materialsRefundFailed: true,
      };
    }
  }

  if (refundedMoney > 0) {
    await client
      .update(userData)
      .set({ money: sql`${userData.money} + ${refundedMoney}` })
      .where(eq(userData.userId, userId));
  }

  await client
    .delete(actionQueue)
    .where(and(eq(actionQueue.id, id), eq(actionQueue.userId, userId)));

  return {
    found: true,
    refundedMoney,
    refundedMaterials: materialRefunds.length > 0,
    materialsRefundFailed: false,
  };
};

export const executeStatTraining = async (props: {
  client: DrizzleClient;
  userId: string;
  stat: UserStatName;
  requireNoActiveTraining?: boolean;
}): Promise<ExecuteResult> => {
  const { client, userId, stat, requireNoActiveTraining = true } = props;
  const { user } = await fetchUpdatedUser({
    client,
    userId,
    forceRegen: true,
  });
  if (!user) return { success: false, message: "User not found" };

  const inVillage = calcIsInVillage({ x: user.longitude, y: user.latitude });
  if (user.status !== "AWAKE")
    return { success: false, message: "Must be awake to train" };
  if (!user.isOutlaw) {
    if (!inVillage) return { success: false, message: "Must be in your own village" };
    if (user.sector !== user.village?.sector)
      return { success: false, message: "Wrong sector" };
  }
  if (requireNoActiveTraining && user.currentlyTraining) {
    return { success: false, message: "You are already training" };
  }

  const result = await client
    .update(userData)
    .set({ trainingStartedAt: new Date(), currentlyTraining: stat })
    .where(
      and(
        eq(userData.userId, userId),
        isNull(userData.currentlyTraining),
        eq(userData.status, "AWAKE"),
      ),
    );
  if (result.rowsAffected === 0) {
    return { success: false, message: "You are already training" };
  }
  return { success: true, message: "Started training" };
};

export const executeCraftItem = async (props: {
  client: DrizzleClient;
  userId: string;
  itemId: string;
  quantity: number;
  requireNoActiveCraft?: boolean;
  skipMaterialDeduction?: boolean;
}): Promise<ExecuteResult> => {
  const {
    client,
    userId,
    itemId,
    quantity,
    requireNoActiveCraft = true,
    skipMaterialDeduction = false,
  } = props;

  const [{ user }, itemWithRequirements, useritems] = await Promise.all([
    fetchUpdatedUser({ client, userId }),
    fetchItemWithCraftingRequirements(client, itemId),
    fetchUserItems(client, userId),
  ]);

  const currentlyCrafting = useritems.find(
    (item) => item.craftingFinishedAt && item.craftingFinishedAt > new Date(),
  );

  if (!user) return { success: false, message: "User not found" };
  if (user.status !== "AWAKE") return { success: false, message: "User is not awake" };
  if (user.sector === MAP_WAKE_ISLAND_SECTOR) {
    return { success: false, message: "Cannot craft items on Wake Island" };
  }
  if (user.occupation !== "CRAFTING") {
    return {
      success: false,
      message: "You must have the Crafting occupation to craft items",
    };
  }
  if (!itemWithRequirements) return { success: false, message: "Item not found" };
  if (requireNoActiveCraft && currentlyCrafting) {
    return {
      success: false,
      message: "You are already crafting an item. Please wait for it to finish.",
    };
  }
  if (itemWithRequirements.hidden) {
    return { success: false, message: "This item is hidden and cannot be crafted" };
  }
  if (!itemWithRequirements.canBeCrafted) {
    return { success: false, message: "This item is not craftable" };
  }
  if (itemWithRequirements.craftingRequirements.length === 0) {
    return {
      success: false,
      message: "This item cannot be crafted (no requirements defined)",
    };
  }

  const userCraftingRank = getCraftingRank(user.craftingExperience);
  const rankCraftingTime =
    CRAFTING_TIMES_MINS[userCraftingRank][itemWithRequirements.rarity];
  const craftingTime =
    itemWithRequirements.itemType === "CONSUMABLE"
      ? CONSUMABLE_CRAFTING_TIMES_MINS[itemWithRequirements.rarity]
      : rankCraftingTime;
  if (rankCraftingTime === 0) {
    return { success: false, message: "Your crafting rank is too low for this item" };
  }

  if (!skipMaterialDeduction) {
    for (const requirement of itemWithRequirements.craftingRequirements) {
      const totalQuantity = getTotalItemQuantity(
        useritems,
        requirement.requirementItemId,
      );
      const requiredQuantity = requirement.quantity * quantity;
      if (totalQuantity < requiredQuantity) {
        const itemName = requirement.requirementItem?.name || "Unknown item";
        return {
          success: false,
          message: `You need ${requiredQuantity} ${itemName} (you have ${totalQuantity})`,
        };
      }
    }
  }

  const sectors = user.village?.sectors?.length || 0;
  const shrineBoost = getShrineBoost(sectors, "Crafting", user.village);
  const shrineBoostFactor = shrineBoost ? 1 - shrineBoost : 1;
  const clanCraftingTimeBoostCap =
    (CLAN_BOOST_MAX_LEVEL * CLAN_BOOST_PERCENT_PER_LEVEL) / 100;
  const clanCraftingTimeBoost = user.isOutlaw
    ? 0
    : Math.min((user.clan?.craftingTimeBoost ?? 0) / 100, clanCraftingTimeBoostCap);
  const clanCraftingTimeFactor = 1 - clanCraftingTimeBoost;
  const craftSeconds = Math.round(
    craftingTime * 60 * shrineBoostFactor * clanCraftingTimeFactor * quantity,
  );
  const finishTime = new Date(Date.now() + craftSeconds * 1000);

  const craftClaimResult = await claimUserSnapshot({
    client,
    userId,
    updatedAt: user.updatedAt,
    where: [
      eq(userData.status, "AWAKE"),
      or(isNull(userData.sector), ne(userData.sector, MAP_WAKE_ISLAND_SECTOR)),
    ],
  });
  if (!craftClaimResult.success) {
    return {
      success: false,
      message: "Could not start crafting — state changed, please try again",
    };
  }

  if (!skipMaterialDeduction) {
    const allConsumptions = [];
    for (const requirement of itemWithRequirements.craftingRequirements) {
      const requiredQuantity = requirement.quantity * quantity;
      const consumption = calculateItemConsumption(
        useritems,
        requirement.requirementItemId,
        requiredQuantity,
      );
      if (!consumption.hasEnough) {
        const itemName = requirement.requirementItem?.name || "Unknown item";
        return { success: false, message: `Insufficient ${itemName} for crafting` };
      }
      allConsumptions.push(...consumption.consumptions);
    }

    const materialUpdates = await Promise.all(
      allConsumptions.map((consumption) =>
        updateUserItemQuantityAtomically({
          client,
          userId,
          userItemId: consumption.userItemId,
          expectedQuantity: consumption.consumeQuantity + consumption.newQuantity,
          nextQuantity: consumption.newQuantity,
        }),
      ),
    );
    if (!materialUpdates.every(Boolean)) {
      return {
        success: false,
        message: "Could not start crafting — materials changed, please try again",
      };
    }
  }

  const craftingItemInserts = [];
  if (itemWithRequirements.stackSize === 1) {
    for (let i = 0; i < quantity; i++) {
      craftingItemInserts.push(
        client.insert(userItem).values({
          id: nanoid(),
          userId,
          itemId,
          quantity: 1,
          craftingFinishedAt: finishTime,
        }),
      );
    }
  } else {
    let remainingQuantity = quantity;
    while (remainingQuantity > 0) {
      const stackQuantity = Math.min(remainingQuantity, itemWithRequirements.stackSize);
      craftingItemInserts.push(
        client.insert(userItem).values({
          id: nanoid(),
          userId,
          itemId,
          quantity: stackQuantity,
          craftingFinishedAt: finishTime,
        }),
      );
      remainingQuantity -= stackQuantity;
    }
  }

  const clanCraftingExpBoost = user.isOutlaw
    ? 0
    : (user.clan?.craftingExpBoost ?? 0) / 100;
  const baseExpGain = (itemWithRequirements.craftingExperience ?? 0) * quantity;
  const expGain = Math.floor(baseExpGain * (1 + clanCraftingExpBoost));
  const { trackers } = getNewTrackers(user, [
    { task: "crafting_experience_gained", increment: expGain },
  ]);
  const questDataForDb = filterQuestTrackersForDbPersist(trackers, user);
  const expUpdate = client
    .update(userData)
    .set({
      craftingExperience: sql`${userData.craftingExperience} + ${expGain}`,
      questData: questDataForDb,
    })
    .where(
      and(
        eq(userData.userId, userId),
        eq(userData.status, "AWAKE"),
        or(isNull(userData.sector), ne(userData.sector, MAP_WAKE_ISLAND_SECTOR)),
      ),
    );

  const [, expResult] = await Promise.all([
    Promise.all(craftingItemInserts),
    expUpdate,
  ]);
  if (!expResult || expResult.rowsAffected !== 1) {
    return {
      success: false,
      message: "Could not start crafting — you must be awake and not on Wake Island",
    };
  }

  return {
    success: true,
    message: `Started crafting ${quantity}x ${itemWithRequirements.name}`,
  };
};

const hasActiveJutsuTraining = (
  userJutsus: Awaited<ReturnType<typeof fetchUserJutsus>>,
) => userJutsus.some((j) => j.finishTraining && j.finishTraining > new Date());

const hasActiveCraft = (userItems: Awaited<ReturnType<typeof fetchUserItems>>) =>
  userItems.some(
    (item) => item.craftingFinishedAt && item.craftingFinishedAt > new Date(),
  );

export const processActionQueues = async (props: {
  client: DrizzleClient;
  userId: string;
}): Promise<string[]> => {
  const { client, userId } = props;
  const messages: string[] = [];

  const processType = async (queueType: ActionQueueType) => {
    while (true) {
      const [{ user }, queue, userJutsus, userItems] = await Promise.all([
        fetchUpdatedUser({ client, userId }),
        fetchUserActionQueue(client, userId),
        fetchUserJutsus(client, userId),
        fetchUserItems(client, userId),
      ]);
      if (!user || user.status !== "AWAKE") break;

      const next = queue.find((entry) => entry.queueType === queueType);
      if (!next) break;

      if (queueType === "JUTSU") {
        if (hasActiveJutsuTraining(userJutsus)) break;
        const result = await executeJutsuTraining({
          client,
          userId,
          jutsuId: next.jutsuId!,
          trainingLevel: next.targetLevel ?? undefined,
          requireNoActiveTraining: true,
          skipMoneyDeduction: (next.moneyCost ?? 0) > 0,
        });
        if (!result.success) break;
        await removeActionQueueEntry(client, userId, next.id);
        messages.push(result.message);
        continue;
      }

      if (queueType === "STAT") {
        if (user.currentlyTraining) break;
        const result = await executeStatTraining({
          client,
          userId,
          stat: next.stat!,
          requireNoActiveTraining: true,
        });
        if (!result.success) break;
        await removeActionQueueEntry(client, userId, next.id);
        messages.push(result.message);
        continue;
      }

      if (queueType === "CRAFT") {
        if (hasActiveCraft(userItems)) break;
        const result = await executeCraftItem({
          client,
          userId,
          itemId: next.itemId!,
          quantity: next.quantity,
          requireNoActiveCraft: true,
          skipMaterialDeduction: (next.queuedMaterialRefunds?.length ?? 0) > 0,
        });
        if (!result.success) break;
        await removeActionQueueEntry(client, userId, next.id);
        messages.push(result.message);
      }
    }
  };

  await processType("JUTSU");
  await processType("STAT");
  await processType("CRAFT");

  return messages;
};
