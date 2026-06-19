import { and, asc, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  type ActivityQueueType,
  CLAN_BOOST_MAX_LEVEL,
  CLAN_BOOST_PERCENT_PER_LEVEL,
  CONSUMABLE_CRAFTING_TIMES_MINS,
  CRAFTING_TIMES_MINS,
  FED_GOLD_QUEUE_SLOTS,
  FED_NORMAL_QUEUE_SLOTS,
  FED_SILVER_QUEUE_SLOTS,
  JUTSU_LEVEL_CAP,
  JUTSU_MAX_BARRIER_EQUIPPED,
  JUTSU_MAX_EVENT_EQUIPPED,
  JUTSU_MAX_PIERCE_EQUIPPED,
  JUTSU_MAX_RESIDUAL_EQUIPPED,
  JUTSU_MAX_STUN_EQUIPPED,
  MAP_WAKE_ISLAND_SECTOR,
  MAX_DAILY_TRAININGS,
  QUEUE_BASE_SLOTS,
  type TrainingSpeed,
  type UserStatName,
} from "@/drizzle/constants";
import {
  type GameSetting,
  type Jutsu,
  type QueueMaterialRefund,
  trainingLog,
  type UserActivityQueue,
  type UserData,
  userActivityQueue,
  userData,
  userItem,
  userJutsu,
} from "@/drizzle/schema";
import { showTrainingCapcha } from "@/libs/captcha";
import {
  calculateItemConsumption,
  getCraftingRank,
  getTotalItemQuantity,
} from "@/libs/crafting";
import { getGameSettingBoost } from "@/libs/gamesettings";
import { getJutsuQueueCostBasis } from "@/libs/jutsu";
import { filterQuestTrackersForDbPersist, getNewTrackers } from "@/libs/quest";
import {
  calcJutsuEquipLimit,
  calcJutsuTrainCost,
  calcJutsuTrainTime,
  canTrainJutsu,
  canUseJutsu,
  energyPerSecond,
  trainEfficiency,
  trainingMultiplier,
  trainingSpeedSeconds,
} from "@/libs/train";
import { calcIsInVillage } from "@/libs/travel";
import {
  fetchItemWithCraftingRequirements,
  fetchUserItems,
} from "@/server/api/routers/item";
import { fetchJutsu, fetchUserJutsus } from "@/server/api/routers/jutsu";
import { fetchUpdatedUser, type UserWithRelations } from "@/server/api/routers/profile";
import { fetchStudents } from "@/server/api/routers/sensei";
import type { DrizzleClient } from "@/server/db";
import {
  claimUserSnapshot,
  updateUserItemQuantityAtomically,
} from "@/server/utils/concurrency";
import { isMysqlDuplicateKeyError } from "@/server/utils/mysqlErrors";
import { getUserFederalStatus } from "@/utils/paypal";
import { canChangeContent } from "@/utils/permissions";
import { getShrineBoost, getStrucBoost } from "@/utils/village";
import type { ActivityQueueEntry, ActivityQueueStatus } from "@/validators/queue";

const PROCESS_BATCH_LIMIT = 500;
const PROMOTE_CONCURRENCY = 25;

type ActiveUser = NonNullable<UserWithRelations>;

export const getMaxQueueSlots = (
  user: Pick<UserData, "staffAccount" | "federalStatus">,
) => {
  const status = getUserFederalStatus(user);
  switch (status) {
    case "NORMAL":
      return QUEUE_BASE_SLOTS + FED_NORMAL_QUEUE_SLOTS;
    case "SILVER":
      return QUEUE_BASE_SLOTS + FED_SILVER_QUEUE_SLOTS;
    case "GOLD":
      return QUEUE_BASE_SLOTS + FED_GOLD_QUEUE_SLOTS;
    default:
      return QUEUE_BASE_SLOTS;
  }
};

export const getMaxPipelineSlots = (
  user: Pick<UserData, "staffAccount" | "federalStatus">,
) => 1 + getMaxQueueSlots(user);

export const fetchQueuedEntries = async (
  client: DrizzleClient,
  userId: string,
  type: ActivityQueueType,
) => {
  return client.query.userActivityQueue.findMany({
    where: and(
      eq(userActivityQueue.userId, userId),
      eq(userActivityQueue.type, type),
      eq(userActivityQueue.status, "QUEUED"),
    ),
    orderBy: [asc(userActivityQueue.position), asc(userActivityQueue.createdAt)],
    with: {
      jutsu: { columns: { id: true, name: true } },
      item: { columns: { id: true, name: true } },
    },
  });
};

const countQueuedEntries = async (
  client: DrizzleClient,
  userId: string,
  type: ActivityQueueType,
) => {
  const [row] = await client
    .select({ count: sql<number>`count(*)` })
    .from(userActivityQueue)
    .where(
      and(
        eq(userActivityQueue.userId, userId),
        eq(userActivityQueue.type, type),
        eq(userActivityQueue.status, "QUEUED"),
      ),
    );
  return Number(row?.count ?? 0);
};

const fetchQueuedEntryOrder = async (
  client: DrizzleClient,
  userId: string,
  type: ActivityQueueType,
) => {
  return client.query.userActivityQueue.findMany({
    where: and(
      eq(userActivityQueue.userId, userId),
      eq(userActivityQueue.type, type),
      eq(userActivityQueue.status, "QUEUED"),
    ),
    orderBy: [asc(userActivityQueue.position), asc(userActivityQueue.createdAt)],
    columns: { id: true },
  });
};

const canCancelJutsuQueueEntry = (
  entry: UserActivityQueue,
  allQueued: UserActivityQueue[],
) => {
  const sameJutsu = allQueued.filter(
    (e) => e.jutsuId === entry.jutsuId && e.status === "QUEUED",
  );
  if (sameJutsu.length <= 1) return true;
  const maxTarget = Math.max(...sameJutsu.map((e) => e.targetLevel ?? 0));
  return (entry.targetLevel ?? 0) >= maxTarget;
};

const mapQueuedEntry = (
  entry: UserActivityQueue & {
    jutsu?: { name: string } | null;
    item?: { name: string } | null;
  },
  allQueued: UserActivityQueue[],
  type: ActivityQueueType,
): ActivityQueueEntry => ({
  id: entry.id,
  position: entry.position,
  stat: entry.stat,
  jutsuId: entry.jutsuId,
  jutsuName: entry.jutsu?.name ?? null,
  itemId: entry.itemId,
  itemName: entry.item?.name ?? null,
  quantity: entry.quantity,
  moneyPaid: entry.moneyPaid,
  costBasisLevel: entry.costBasisLevel,
  targetLevel: entry.targetLevel,
  trainTimeMs: entry.trainTimeMs,
  trainingSpeed: entry.trainingSpeed,
  craftSeconds: entry.craftSeconds,
  canCancel: type === "JUTSU" ? canCancelJutsuQueueEntry(entry, allQueued) : true,
});

const refundMaterials = async (
  client: DrizzleClient,
  userId: string,
  materials: QueueMaterialRefund[] | null | undefined,
) => {
  if (!materials?.length) return;
  await Promise.all(
    materials.map(async (material) => {
      const existing = await client.query.userItem.findFirst({
        where: and(eq(userItem.id, material.userItemId), eq(userItem.userId, userId)),
      });
      if (existing) {
        await client
          .update(userItem)
          .set({ quantity: sql`${userItem.quantity} + ${material.quantity}` })
          .where(
            and(eq(userItem.id, material.userItemId), eq(userItem.userId, userId)),
          );
      } else {
        await client.insert(userItem).values({
          id: nanoid(),
          userId,
          itemId: material.itemId,
          quantity: material.quantity,
        });
      }
    }),
  );
};

const refundQueueEntryPayment = async (
  client: DrizzleClient,
  entry: UserActivityQueue,
) => {
  if (entry.type === "CRAFT") {
    await refundMaterials(client, entry.userId, entry.materialsPaid);
  } else if (entry.type === "JUTSU" && entry.moneyPaid > 0) {
    await client
      .update(userData)
      .set({ money: sql`${userData.money} + ${entry.moneyPaid}` })
      .where(eq(userData.userId, entry.userId));
  }
};

/** Remove an unstartable queue entry and refund prepaid resources. */
const abortQueuedEntry = async (
  client: DrizzleClient,
  entry: UserActivityQueue,
): Promise<boolean> => {
  const cancelResult = await client
    .update(userActivityQueue)
    .set({ status: "CANCELLED", updatedAt: new Date() })
    .where(
      and(
        eq(userActivityQueue.id, entry.id),
        eq(userActivityQueue.userId, entry.userId),
        eq(userActivityQueue.status, "QUEUED"),
      ),
    );
  if (cancelResult.rowsAffected !== 1) return false;

  await refundQueueEntryPayment(client, entry);

  return true;
};

/** Side-effect failed after claim — revert COMPLETED back to CANCELLED and refund. */
const revertFailedQueueClaim = async (
  client: DrizzleClient,
  entry: UserActivityQueue,
): Promise<boolean> => {
  const revertResult = await client
    .update(userActivityQueue)
    .set({ status: "CANCELLED", updatedAt: new Date() })
    .where(
      and(
        eq(userActivityQueue.id, entry.id),
        eq(userActivityQueue.userId, entry.userId),
        eq(userActivityQueue.status, "COMPLETED"),
      ),
    );
  if (revertResult.rowsAffected !== 1) return false;

  await refundQueueEntryPayment(client, entry);
  return true;
};

const nextQueuePosition = async (
  client: DrizzleClient,
  userId: string,
  type: ActivityQueueType,
) => {
  const latest = await client.query.userActivityQueue.findFirst({
    where: and(eq(userActivityQueue.userId, userId), eq(userActivityQueue.type, type)),
    orderBy: [desc(userActivityQueue.position)],
    columns: { position: true },
  });
  return (latest?.position ?? 0) + 1;
};

const insertQueuedEntry = async (
  client: DrizzleClient,
  values: Omit<typeof userActivityQueue.$inferInsert, "id" | "position">,
): Promise<string> => {
  const entryId = nanoid();
  const maxAttempts = 3;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const position = await nextQueuePosition(client, values.userId, values.type);
    try {
      await client.insert(userActivityQueue).values({
        ...values,
        id: entryId,
        position,
      });
      return entryId;
    } catch (error) {
      if (!isMysqlDuplicateKeyError(error) || attempt === maxAttempts - 1) {
        throw error;
      }
    }
  }
  throw new Error("Failed to insert queue entry");
};

const queueFullMessage = (type: ActivityQueueType) => {
  switch (type) {
    case "STAT":
      return "Stat training queue is full";
    case "JUTSU":
      return "Jutsu training queue is full";
    case "CRAFT":
      return "Crafting queue is full";
  }
};

/** After insert, drop this entry if concurrent enqueues exceeded the slot cap. */
const verifyQueueSlotAfterInsert = async (
  client: DrizzleClient,
  userId: string,
  type: ActivityQueueType,
  entryId: string,
  maxQueued: number,
): Promise<boolean> => {
  const count = await countQueuedEntries(client, userId, type);
  if (count <= maxQueued) return true;

  const queued = await fetchQueuedEntryOrder(client, userId, type);
  const isOverflow = queued.slice(maxQueued).some((entry) => entry.id === entryId);
  if (!isOverflow) return true;

  const entry = await client.query.userActivityQueue.findFirst({
    where: and(
      eq(userActivityQueue.id, entryId),
      eq(userActivityQueue.userId, userId),
      eq(userActivityQueue.type, type),
      eq(userActivityQueue.status, "QUEUED"),
    ),
  });
  if (entry) {
    await abortQueuedEntry(client, entry);
  }
  return false;
};

const completeQueueEntry = async (client: DrizzleClient, entryId: string) => {
  const result = await client
    .update(userActivityQueue)
    .set({ status: "COMPLETED", updatedAt: new Date() })
    .where(
      and(eq(userActivityQueue.id, entryId), eq(userActivityQueue.status, "QUEUED")),
    );
  return result.rowsAffected === 1;
};

const assertCanEnqueue = (user: ActiveUser) => {
  if (user.status !== "AWAKE") return "Must be awake";
  if (!user.isOutlaw) {
    const inVillage = calcIsInVillage({ x: user.longitude, y: user.latitude });
    if (!inVillage) return "Must be in your own village";
    if (user.sector !== user.village?.sector) return "Wrong sector";
  }
  return null;
};

export type CompleteStatTrainingResult =
  | {
      success: true;
      trainingAmount: number;
      stat: UserStatName;
      questData: ReturnType<typeof getNewTrackers>["trackers"];
    }
  | { success: false; message: string };

export const completeStatTraining = async (
  client: DrizzleClient,
  user: ActiveUser,
  settings: GameSetting[],
  options?: { bypassCaptcha?: boolean; forceFullDuration?: boolean },
): Promise<CompleteStatTrainingResult> => {
  if (user.status !== "AWAKE") return { success: false, message: "Must be awake" };
  if (!user.trainingStartedAt || !user.currentlyTraining) {
    return { success: false, message: "Not currently training" };
  }

  const fullSeconds = trainingSpeedSeconds(user.trainingSpeed);
  const elapsedSeconds = (Date.now() - user.trainingStartedAt.getTime()) / 1000;
  const seconds =
    options?.forceFullDuration === true
      ? fullSeconds
      : Math.min(elapsedSeconds, fullSeconds);

  if (
    !options?.bypassCaptcha &&
    showTrainingCapcha(user) &&
    elapsedSeconds < fullSeconds
  ) {
    return { success: false, message: "Captcha required" };
  }

  const sectors = user.village?.sectors?.length ?? 0;
  const shrineBoost = getShrineBoost(sectors, "Training", user.village);
  const trainSetting = getGameSettingBoost("trainingGainMultiplier", settings);
  const warSetting = getGameSettingBoost(`war-${user.villageId}-train`, settings);
  const gameFactor = trainSetting?.value ?? 1;
  const warFactor = (100 + (warSetting?.value ?? 0)) / 100;
  const boost = getStrucBoost("trainBoostPerLvl", user.village?.structures) / 100;
  const clanBoost = user.isOutlaw ? 0 : (user.clan?.trainingBoost ?? 0) / 100;
  const factor = gameFactor * (1 + boost + clanBoost + shrineBoost) * warFactor;
  const energySpent = Math.min(
    Math.floor(energyPerSecond(user.trainingSpeed) * seconds),
    100,
  );
  const trainingAmount =
    factor * energySpent * trainEfficiency(user) * trainingMultiplier(user);
  const minutes = seconds / 60;

  const { trackers } = getNewTrackers(user, [
    { task: "stats_trained", increment: trainingAmount },
    { task: "minutes_training", increment: minutes },
  ]);
  const questDataForDb = filterQuestTrackersForDbPersist(trackers, user);
  const stat = user.currentlyTraining;

  const statUpdate =
    trainingAmount > 0
      ? {
          experience: sql`experience + ${trainingAmount}`,
          dailyTrainings: sql`dailyTrainings + 1`,
          strength:
            stat === "strength" ? sql`strength + ${trainingAmount}` : sql`strength`,
          intelligence:
            stat === "intelligence"
              ? sql`intelligence + ${trainingAmount}`
              : sql`intelligence`,
          willpower:
            stat === "willpower" ? sql`willpower + ${trainingAmount}` : sql`willpower`,
          speed: stat === "speed" ? sql`speed + ${trainingAmount}` : sql`speed`,
          ninjutsuOffence:
            stat === "ninjutsuOffence"
              ? sql`ninjutsuOffence + ${trainingAmount}`
              : sql`ninjutsuOffence`,
          ninjutsuDefence:
            stat === "ninjutsuDefence"
              ? sql`ninjutsuDefence + ${trainingAmount}`
              : sql`ninjutsuDefence`,
          genjutsuOffence:
            stat === "genjutsuOffence"
              ? sql`genjutsuOffence + ${trainingAmount}`
              : sql`genjutsuOffence`,
          genjutsuDefence:
            stat === "genjutsuDefence"
              ? sql`genjutsuDefence + ${trainingAmount}`
              : sql`genjutsuDefence`,
          taijutsuOffence:
            stat === "taijutsuOffence"
              ? sql`taijutsuOffence + ${trainingAmount}`
              : sql`taijutsuOffence`,
          taijutsuDefence:
            stat === "taijutsuDefence"
              ? sql`taijutsuDefence + ${trainingAmount}`
              : sql`taijutsuDefence`,
          bukijutsuDefence:
            stat === "bukijutsuDefence"
              ? sql`bukijutsuDefence + ${trainingAmount}`
              : sql`bukijutsuDefence`,
          bukijutsuOffence:
            stat === "bukijutsuOffence"
              ? sql`bukijutsuOffence + ${trainingAmount}`
              : sql`bukijutsuOffence`,
          questData: questDataForDb,
        }
      : {};

  const [result] = await Promise.all([
    client
      .update(userData)
      .set({
        trainingStartedAt: null,
        currentlyTraining: null,
        ...statUpdate,
      })
      .where(
        and(
          eq(userData.userId, user.userId),
          eq(userData.currentlyTraining, stat),
          eq(userData.status, "AWAKE"),
        ),
      ),
    ...(trainingAmount > 0
      ? [
          client.insert(trainingLog).values({
            userId: user.userId,
            amount: trainingAmount,
            stat,
            speed: user.trainingSpeed,
            trainingFinishedAt: new Date(),
          }),
        ]
      : []),
  ]);

  if (result.rowsAffected === 0) {
    return { success: false, message: "You are not training" };
  }

  return {
    success: true,
    trainingAmount,
    stat,
    questData: trackers,
  };
};

const startStatTrainingInternal = async (
  client: DrizzleClient,
  user: ActiveUser,
  stat: UserStatName,
) => {
  if (user.trainingSpeed !== "8hrs" && user.isBanned) {
    return {
      ok: false as const,
      message: "Only 8hrs training interval allowed when banned",
    };
  }
  if (user.dailyTrainings >= MAX_DAILY_TRAININGS) {
    return {
      ok: false as const,
      message: `Training more than ${MAX_DAILY_TRAININGS} times within 24 hours not allowed`,
    };
  }

  const data = { trainingStartedAt: new Date(), currentlyTraining: stat };
  const result = await client
    .update(userData)
    .set(data)
    .where(
      and(
        eq(userData.userId, user.userId),
        isNull(userData.currentlyTraining),
        eq(userData.status, "AWAKE"),
      ),
    );

  if (result.rowsAffected === 0) {
    return { ok: false as const, message: "You are already training" };
  }
  return { ok: true as const, data };
};

export const promoteStatQueue = async (
  client: DrizzleClient,
  userId: string,
): Promise<boolean> => {
  for (;;) {
    const [{ user }, queued] = await Promise.all([
      fetchUpdatedUser({ client, userId, forceRegen: true }),
      fetchQueuedEntries(client, userId, "STAT"),
    ]);
    if (!user || user.currentlyTraining || queued.length === 0) return false;
    if (user.dailyTrainings >= MAX_DAILY_TRAININGS) return false;

    const next = queued[0];
    if (!next) return false;

    if (!next.stat) {
      if (!(await abortQueuedEntry(client, next))) return false;
      continue;
    }

    const claimed = await completeQueueEntry(client, next.id);
    if (!claimed) continue;

    const start = await startStatTrainingInternal(client, user, next.stat);
    if (!start.ok) {
      if (!(await revertFailedQueueClaim(client, next))) return false;
      continue;
    }

    return true;
  }
};

export const tryCompleteExpiredStatTraining = async (
  client: DrizzleClient,
  userId: string,
) => {
  const { user, settings } = await fetchUpdatedUser({
    client,
    userId,
    forceRegen: true,
  });
  if (!user?.currentlyTraining || !user.trainingStartedAt) return false;

  const finishAt =
    user.trainingStartedAt.getTime() + trainingSpeedSeconds(user.trainingSpeed) * 1000;
  if (Date.now() < finishAt) return false;

  const result = await completeStatTraining(client, user, settings, {
    bypassCaptcha: true,
    forceFullDuration: true,
  });
  if (!result.success) return false;

  await promoteStatQueue(client, userId);
  return true;
};

export const enqueueStatTraining = async (
  client: DrizzleClient,
  userId: string,
  stat: UserStatName,
) => {
  const { user } = await fetchUpdatedUser({
    client,
    userId,
    forceRegen: true,
  });
  if (!user) return { success: false, message: "User not found" };

  const guard = assertCanEnqueue(user);
  if (guard) return { success: false, message: guard };

  if (!user.currentlyTraining) {
    const start = await startStatTrainingInternal(client, user, stat);
    if (!start.ok) return { success: false, message: start.message };
    return {
      success: true,
      message: "Started training",
      data: start.data,
    };
  }

  const maxQueued = getMaxQueueSlots(user);
  const queuedCount = await countQueuedEntries(client, userId, "STAT");
  if (queuedCount >= maxQueued) {
    return { success: false, message: queueFullMessage("STAT") };
  }

  const entryId = await insertQueuedEntry(client, {
    userId,
    type: "STAT",
    status: "QUEUED",
    stat,
    trainingSpeed: user.trainingSpeed,
  });
  const hasSlot = await verifyQueueSlotAfterInsert(
    client,
    userId,
    "STAT",
    entryId,
    maxQueued,
  );
  if (!hasSlot) {
    return { success: false, message: queueFullMessage("STAT") };
  }

  return { success: true, message: "Added to stat training queue" };
};

export const cancelStatQueueEntry = async (
  client: DrizzleClient,
  userId: string,
  queueId: string,
) => {
  const entry = await client.query.userActivityQueue.findFirst({
    where: and(
      eq(userActivityQueue.id, queueId),
      eq(userActivityQueue.userId, userId),
      eq(userActivityQueue.type, "STAT"),
      eq(userActivityQueue.status, "QUEUED"),
    ),
  });
  if (!entry) return { success: false, message: "Queue entry not found" };

  const cancelResult = await client
    .update(userActivityQueue)
    .set({ status: "CANCELLED", updatedAt: new Date() })
    .where(
      and(
        eq(userActivityQueue.id, queueId),
        eq(userActivityQueue.userId, userId),
        eq(userActivityQueue.type, "STAT"),
        eq(userActivityQueue.status, "QUEUED"),
      ),
    );
  if (cancelResult.rowsAffected !== 1) {
    return { success: false, message: "Queue entry not found" };
  }

  return { success: true, message: "Removed from stat training queue" };
};

const applyJutsuTrainingStart = async (
  client: DrizzleClient,
  user: ActiveUser,
  jutsuInfo: Jutsu,
  trainTimeMs: number,
  skipQuestOnExisting: boolean,
  userjutsusInput?: Awaited<ReturnType<typeof fetchUserJutsus>>,
) => {
  const userjutsus = userjutsusInput ?? (await fetchUserJutsus(client, user.userId));
  const userjutsuObj = userjutsus.find((j) => j.jutsuId === jutsuInfo.id);
  const equippedJutsus = userjutsus.filter((uj) => uj.equipped);
  const curEquip = equippedJutsus.length;
  const maxEquip = calcJutsuEquipLimit(user);

  if (userjutsuObj) {
    const result = await client
      .update(userJutsu)
      .set({
        level: sql`${userJutsu.level} + 1`,
        finishTraining: new Date(Date.now() + trainTimeMs),
        updatedAt: new Date(),
      })
      .where(and(eq(userJutsu.id, userjutsuObj.id), eq(userJutsu.userId, user.userId)));
    if (result.rowsAffected === 0) return false;
    return true;
  }

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

  const jutsuHasResidual = jutsuInfo.effects.some(
    (e) => "residualModifier" in e && e.residualModifier,
  );
  const jutsuHasPierce = jutsuInfo.effects.some((e) => e.type === "pierce");
  const jutsuIsEvent = jutsuInfo.jutsuType === "EVENT";
  const jutsuHasBarrier = jutsuInfo.effects.some((e) => e.type === "barrier");
  const jutsuHasStun = jutsuInfo.effects.some((e) => e.type === "stun");

  const canAutoEquip =
    curEquip < maxEquip &&
    (!jutsuHasResidual || residualJutsus.length < JUTSU_MAX_RESIDUAL_EQUIPPED) &&
    (!jutsuHasPierce || pierceJutsus.length < JUTSU_MAX_PIERCE_EQUIPPED) &&
    (!jutsuIsEvent || eventJutsus.length < JUTSU_MAX_EVENT_EQUIPPED) &&
    (!jutsuHasBarrier || barrierJutsus.length < JUTSU_MAX_BARRIER_EQUIPPED) &&
    (!jutsuHasStun || stunJutsus.length < JUTSU_MAX_STUN_EQUIPPED);

  if (!skipQuestOnExisting) {
    const { trackers } = getNewTrackers(user, [
      { task: "jutsus_mastered", increment: 1 },
    ]);
    const questDataForDb = filterQuestTrackersForDbPersist(trackers, user);
    await client
      .update(userData)
      .set({ questData: questDataForDb })
      .where(eq(userData.userId, user.userId));
  }

  await client
    .insert(userJutsu)
    .values({
      id: nanoid(),
      userId: user.userId,
      jutsuId: jutsuInfo.id,
      finishTraining: new Date(Date.now() + trainTimeMs),
      equipped: canAutoEquip,
    })
    .onDuplicateKeyUpdate({ set: { id: sql`id` } });

  return true;
};

export const promoteJutsuQueue = async (
  client: DrizzleClient,
  userId: string,
): Promise<boolean> => {
  for (;;) {
    const [{ user }, queued, userjutsus] = await Promise.all([
      fetchUpdatedUser({ client, userId }),
      fetchQueuedEntries(client, userId, "JUTSU"),
      fetchUserJutsus(client, userId),
    ]);
    const activelyTraining = userjutsus.some(
      (j) => j.finishTraining && j.finishTraining > new Date(),
    );
    if (!user || activelyTraining || queued.length === 0) return false;

    const next = queued[0];
    if (!next) return false;

    if (!next.jutsuId || next.costBasisLevel === null || !next.trainTimeMs) {
      if (!(await abortQueuedEntry(client, next))) return false;
      continue;
    }

    const jutsuInfo = await fetchJutsu(client, next.jutsuId);
    const userjutsuObj = userjutsus.find((j) => j.jutsuId === next.jutsuId);
    const currentLevel = userjutsuObj?.level ?? 0;
    if (!jutsuInfo || currentLevel !== next.costBasisLevel) {
      if (!(await abortQueuedEntry(client, next))) return false;
      continue;
    }

    const claimed = await completeQueueEntry(client, next.id);
    if (!claimed) continue;

    const started = await applyJutsuTrainingStart(
      client,
      user,
      jutsuInfo,
      next.trainTimeMs,
      !!userjutsuObj,
      userjutsus,
    );
    if (!started) {
      if (!(await revertFailedQueueClaim(client, next))) return false;
      continue;
    }

    return true;
  }
};

export const enqueueJutsuTraining = async (
  client: DrizzleClient,
  userId: string,
  jutsuId: string,
) => {
  const [{ user }, jutsuInfo, userjutsus, students] = await Promise.all([
    fetchUpdatedUser({ client, userId }),
    fetchJutsu(client, jutsuId),
    fetchUserJutsus(client, userId),
    fetchStudents(client, userId),
  ]);
  const activelyTraining = userjutsus.some(
    (j) => j.finishTraining && j.finishTraining > new Date(),
  );

  if (!user) return { success: false, message: "User not found" };
  if (!jutsuInfo) return { success: false, message: "Jutsu not found" };

  const guard = assertCanEnqueue(user);
  if (guard) return { success: false, message: guard };
  if (user.status !== "AWAKE") return { success: false, message: "Must be awake" };

  const userjutsuObj = userjutsus.find((j) => j.jutsuId === jutsuId);
  if (!canTrainJutsu(jutsuInfo, user) && !jutsuInfo.parentJutsuId) {
    return { success: false, message: "Jutsu not for you" };
  }
  if (jutsuInfo.parentJutsuId && !userjutsuObj) {
    return {
      success: false,
      message: "Evolution jutsus can only be obtained by evolving the parent jutsu",
    };
  }
  if (jutsuInfo.parentJutsuId && userjutsuObj && !canUseJutsu(jutsuInfo, user, true)) {
    return { success: false, message: "Jutsu not for you" };
  }
  if (
    userjutsus.some(
      (j) => j.jutsu.parentJutsuId === jutsuId || j.parentJutsuParentId === jutsuId,
    )
  ) {
    return { success: false, message: "You have already evolved this jutsu" };
  }
  if (jutsuInfo.hidden && !canChangeContent(user.role)) {
    return { success: false, message: "Jutsu is hidden, cannot be trained" };
  }

  const queued = await fetchQueuedEntries(client, userId, "JUTSU");
  const maxQueued = getMaxQueueSlots(user);
  const sameJutsuQueued = queued.filter((e) => e.jutsuId === jutsuId);

  const baseCostLevel = userjutsuObj?.level ?? 0;
  const costBasisLevel = getJutsuQueueCostBasis(baseCostLevel, sameJutsuQueued.length);
  const targetLevel = costBasisLevel + 1;

  if (targetLevel > JUTSU_LEVEL_CAP) {
    return { success: false, message: "Jutsu is already at max level" };
  }

  const trainTimeMs = calcJutsuTrainTime(jutsuInfo, costBasisLevel, user);
  const trainCost = calcJutsuTrainCost(jutsuInfo, costBasisLevel, user, students);

  if (!activelyTraining) {
    if (user.money < trainCost) {
      return { success: false, message: "You don't have enough money" };
    }

    const claimResult = await claimUserSnapshot({
      client,
      userId,
      updatedAt: user.updatedAt,
      where: [eq(userData.status, "AWAKE")],
    });
    if (!claimResult.success) {
      return {
        success: false,
        message: "Could not start jutsu training — please try again",
      };
    }

    let questDataFull = user.questData ?? [];
    if (!userjutsuObj) {
      const { trackers } = getNewTrackers(user, [
        { task: "jutsus_mastered", increment: 1 },
      ]);
      questDataFull = trackers;
    }
    const questDataForDb = filterQuestTrackersForDbPersist(questDataFull, user);

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

    const started = await applyJutsuTrainingStart(
      client,
      user,
      jutsuInfo,
      trainTimeMs,
      !!userjutsuObj,
      userjutsus,
    );
    if (!started) {
      await client
        .update(userData)
        .set({
          money: sql`${userData.money} + ${trainCost}`,
          questData: user.questData,
        })
        .where(eq(userData.userId, userId));
      return { success: false, message: "Could not start jutsu training" };
    }

    return {
      success: true,
      message: `You started training: ${jutsuInfo.name}`,
      data: { money: user.money - trainCost, questData: questDataFull },
    };
  }

  if (queued.length >= maxQueued) {
    return { success: false, message: queueFullMessage("JUTSU") };
  }

  if (user.money < trainCost) {
    return { success: false, message: "You don't have enough money" };
  }

  const moneyUpdate = await client
    .update(userData)
    .set({ money: sql`${userData.money} - ${trainCost}` })
    .where(and(eq(userData.userId, userId), gte(userData.money, trainCost)));
  if (moneyUpdate.rowsAffected !== 1) {
    return { success: false, message: "You don't have enough money" };
  }

  const entryId = await insertQueuedEntry(client, {
    userId,
    type: "JUTSU",
    status: "QUEUED",
    jutsuId,
    moneyPaid: trainCost,
    costBasisLevel,
    targetLevel,
    trainTimeMs,
  });
  const hasSlot = await verifyQueueSlotAfterInsert(
    client,
    userId,
    "JUTSU",
    entryId,
    maxQueued,
  );
  if (!hasSlot) {
    return { success: false, message: queueFullMessage("JUTSU") };
  }

  return {
    success: true,
    message: `Queued ${jutsuInfo.name} training to level ${targetLevel}`,
    data: { money: user.money - trainCost, questData: null },
  };
};

export const cancelJutsuQueueEntry = async (
  client: DrizzleClient,
  userId: string,
  queueId: string,
) => {
  const entry = await client.query.userActivityQueue.findFirst({
    where: and(
      eq(userActivityQueue.id, queueId),
      eq(userActivityQueue.userId, userId),
      eq(userActivityQueue.type, "JUTSU"),
      eq(userActivityQueue.status, "QUEUED"),
    ),
  });

  if (!entry) return { success: false, message: "Queue entry not found" };

  const queued = await fetchQueuedEntries(client, userId, "JUTSU");
  if (!canCancelJutsuQueueEntry(entry, queued)) {
    return {
      success: false,
      message: "Cancel the highest level training for this jutsu first",
    };
  }

  const cancelResult = await client
    .update(userActivityQueue)
    .set({ status: "CANCELLED", updatedAt: new Date() })
    .where(
      and(
        eq(userActivityQueue.id, queueId),
        eq(userActivityQueue.userId, userId),
        eq(userActivityQueue.type, "JUTSU"),
        eq(userActivityQueue.status, "QUEUED"),
      ),
    );
  if (cancelResult.rowsAffected !== 1) {
    return { success: false, message: "Queue entry not found" };
  }

  await client
    .update(userData)
    .set({ money: sql`${userData.money} + ${entry.moneyPaid}` })
    .where(eq(userData.userId, userId));

  return {
    success: true,
    message: `Cancelled jutsu training queue entry. Refunded ${entry.moneyPaid} ryo.`,
  };
};

const startCraftFromQueueEntry = async (
  client: DrizzleClient,
  user: ActiveUser,
  entry: UserActivityQueue,
) => {
  if (!entry.itemId || !entry.craftSeconds) return false;

  const itemWithRequirements = await fetchItemWithCraftingRequirements(
    client,
    entry.itemId,
  );
  if (!itemWithRequirements) return false;

  const finishTime = new Date(Date.now() + entry.craftSeconds * 1000);
  const craftingItemInserts = [];

  if (itemWithRequirements.stackSize === 1) {
    for (let i = 0; i < entry.quantity; i++) {
      craftingItemInserts.push(
        client.insert(userItem).values({
          id: nanoid(),
          userId: user.userId,
          itemId: entry.itemId,
          quantity: 1,
          craftingFinishedAt: finishTime,
        }),
      );
    }
  } else {
    let remainingQuantity = entry.quantity;
    while (remainingQuantity > 0) {
      const stackQuantity = Math.min(remainingQuantity, itemWithRequirements.stackSize);
      craftingItemInserts.push(
        client.insert(userItem).values({
          id: nanoid(),
          userId: user.userId,
          itemId: entry.itemId,
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
  const baseExpGain = (itemWithRequirements.craftingExperience ?? 0) * entry.quantity;
  const expGain = Math.floor(baseExpGain * (1 + clanCraftingExpBoost));
  const { trackers } = getNewTrackers(user, [
    { task: "crafting_experience_gained", increment: expGain },
  ]);
  const questDataForDb = filterQuestTrackersForDbPersist(trackers, user);

  await Promise.all([
    ...craftingItemInserts,
    client
      .update(userData)
      .set({
        craftingExperience: sql`${userData.craftingExperience} + ${expGain}`,
        questData: questDataForDb,
      })
      .where(eq(userData.userId, user.userId)),
  ]);

  return true;
};

export const promoteCraftQueue = async (
  client: DrizzleClient,
  userId: string,
): Promise<boolean> => {
  for (;;) {
    const [{ user }, queued, useritems] = await Promise.all([
      fetchUpdatedUser({ client, userId }),
      fetchQueuedEntries(client, userId, "CRAFT"),
      fetchUserItems(client, userId),
    ]);
    const activelyCrafting = useritems.some(
      (item) => item.craftingFinishedAt && item.craftingFinishedAt > new Date(),
    );
    if (!user || activelyCrafting || queued.length === 0) return false;

    const next = queued[0];
    if (!next) return false;

    if (!next.itemId || !next.craftSeconds) {
      if (!(await abortQueuedEntry(client, next))) return false;
      continue;
    }

    const claimed = await completeQueueEntry(client, next.id);
    if (!claimed) continue;

    const started = await startCraftFromQueueEntry(client, user, next);
    if (!started) {
      if (!(await revertFailedQueueClaim(client, next))) return false;
      continue;
    }

    return true;
  }
};

export const enqueueCraft = async (
  client: DrizzleClient,
  userId: string,
  itemId: string,
  quantity: number,
) => {
  const [{ user }, itemWithRequirements, useritems] = await Promise.all([
    fetchUpdatedUser({ client, userId }),
    fetchItemWithCraftingRequirements(client, itemId),
    fetchUserItems(client, userId),
  ]);
  const activelyCrafting = useritems.some(
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
  if (itemWithRequirements.hidden) {
    return { success: false, message: "This item is hidden and cannot be crafted" };
  }
  if (!itemWithRequirements.canBeCrafted) {
    return { success: false, message: "This item is not craftable" };
  }
  if (itemWithRequirements.craftingRequirements.length === 0) {
    return errorMessage("This item cannot be crafted (no requirements defined)");
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

  for (const requirement of itemWithRequirements.craftingRequirements) {
    const totalQuantity = getTotalItemQuantity(
      useritems,
      requirement.requirementItemId,
    );
    const requiredQuantity = requirement.quantity * quantity;
    if (totalQuantity < requiredQuantity) {
      const itemName = requirement.requirementItem?.name || "Unknown item";
      return errorMessage(
        `You need ${requiredQuantity} ${itemName} (you have ${totalQuantity})`,
      );
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

  const allConsumptions: {
    userItemId: string;
    consumeQuantity: number;
    newQuantity: number;
  }[] = [];
  for (const requirement of itemWithRequirements.craftingRequirements) {
    const requiredQuantity = requirement.quantity * quantity;
    const consumption = calculateItemConsumption(
      useritems,
      requirement.requirementItemId,
      requiredQuantity,
    );
    if (!consumption.hasEnough) {
      const itemName = requirement.requirementItem?.name || "Unknown item";
      return errorMessage(`Insufficient ${itemName} for crafting`);
    }
    allConsumptions.push(...consumption.consumptions);
  }

  const materialsPaid: QueueMaterialRefund[] = allConsumptions.map((c) => {
    const row = useritems.find((ui) => ui.id === c.userItemId);
    return {
      itemId: row?.itemId ?? itemId,
      quantity: c.consumeQuantity,
      userItemId: c.userItemId,
    };
  });

  // Serialize immediate craft starts after validation so a failed gate does not
  // consume the user snapshot; matches occupation craft CAS ordering.
  if (!activelyCrafting) {
    const claimResult = await claimUserSnapshot({
      client,
      userId,
      updatedAt: user.updatedAt,
      where: [eq(userData.status, "AWAKE"), eq(userData.occupation, "CRAFTING")],
    });
    if (!claimResult.success) {
      return errorMessage("Could not start crafting — please try again");
    }
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
    const consumedMaterials = materialsPaid.filter((_, i) => materialUpdates[i]);
    await refundMaterials(client, userId, consumedMaterials);
    return errorMessage(
      "Could not start crafting — materials changed, please try again",
    );
  }

  if (!activelyCrafting) {
    const queueEntry: UserActivityQueue = {
      id: nanoid(),
      userId,
      type: "CRAFT",
      status: "QUEUED",
      position: 0,
      itemId,
      quantity,
      moneyPaid: 0,
      materialsPaid,
      costBasisLevel: null,
      targetLevel: null,
      trainTimeMs: null,
      trainingSpeed: null,
      craftSeconds,
      stat: null,
      jutsuId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const started = await startCraftFromQueueEntry(client, user, queueEntry);
    if (!started) {
      await refundMaterials(client, userId, materialsPaid);
      return errorMessage("Could not start crafting");
    }
    return {
      success: true,
      message: `Started crafting ${quantity}x ${itemWithRequirements.name}`,
    };
  }

  const maxQueued = getMaxQueueSlots(user);
  const queuedCount = await countQueuedEntries(client, userId, "CRAFT");
  if (queuedCount >= maxQueued) {
    await refundMaterials(client, userId, materialsPaid);
    return errorMessage(queueFullMessage("CRAFT"));
  }

  const entryId = await insertQueuedEntry(client, {
    userId,
    type: "CRAFT",
    status: "QUEUED",
    itemId,
    quantity,
    materialsPaid,
    craftSeconds,
  });
  const hasSlot = await verifyQueueSlotAfterInsert(
    client,
    userId,
    "CRAFT",
    entryId,
    maxQueued,
  );
  if (!hasSlot) {
    return errorMessage(queueFullMessage("CRAFT"));
  }

  return {
    success: true,
    message: `Queued crafting ${quantity}x ${itemWithRequirements.name}`,
  };
};

const errorMessage = (message: string) => ({ success: false as const, message });

export const cancelCraftQueueEntry = async (
  client: DrizzleClient,
  userId: string,
  queueId: string,
) => {
  const entry = await client.query.userActivityQueue.findFirst({
    where: and(
      eq(userActivityQueue.id, queueId),
      eq(userActivityQueue.userId, userId),
      eq(userActivityQueue.type, "CRAFT"),
      eq(userActivityQueue.status, "QUEUED"),
    ),
  });
  if (!entry) return { success: false, message: "Queue entry not found" };

  const cancelResult = await client
    .update(userActivityQueue)
    .set({ status: "CANCELLED", updatedAt: new Date() })
    .where(
      and(
        eq(userActivityQueue.id, queueId),
        eq(userActivityQueue.userId, userId),
        eq(userActivityQueue.type, "CRAFT"),
        eq(userActivityQueue.status, "QUEUED"),
      ),
    );
  if (cancelResult.rowsAffected !== 1) {
    return { success: false, message: "Queue entry not found" };
  }

  await refundMaterials(client, userId, entry.materialsPaid);

  return {
    success: true,
    message: "Cancelled crafting queue entry and refunded materials",
  };
};

export const getStatQueueStatus = async (
  client: DrizzleClient,
  user: ActiveUser,
): Promise<ActivityQueueStatus> => {
  const queued = await fetchQueuedEntries(client, user.userId, "STAT");
  return {
    type: "STAT",
    maxQueued: getMaxQueueSlots(user),
    maxPipeline: getMaxPipelineSlots(user),
    usedQueued: queued.length,
    active: user.currentlyTraining
      ? {
          label: user.currentlyTraining,
          finishAt: user.trainingStartedAt
            ? new Date(
                user.trainingStartedAt.getTime() +
                  trainingSpeedSeconds(user.trainingSpeed) * 1000,
              )
            : null,
          stat: user.currentlyTraining,
        }
      : null,
    queued: queued.map((entry) => mapQueuedEntry(entry, queued, "STAT")),
  };
};

export const getJutsuQueueStatus = async (
  client: DrizzleClient,
  user: ActiveUser,
): Promise<ActivityQueueStatus> => {
  const [queued, userjutsus] = await Promise.all([
    fetchQueuedEntries(client, user.userId, "JUTSU"),
    fetchUserJutsus(client, user.userId),
  ]);
  const activeJutsu = userjutsus.find(
    (j) => j.finishTraining && j.finishTraining > new Date(),
  );

  return {
    type: "JUTSU",
    maxQueued: getMaxQueueSlots(user),
    maxPipeline: getMaxPipelineSlots(user),
    usedQueued: queued.length,
    active: activeJutsu
      ? {
          label: activeJutsu.jutsu?.name ?? "Jutsu",
          finishAt: activeJutsu.finishTraining,
          jutsuId: activeJutsu.jutsuId,
          targetLevel: activeJutsu.level,
        }
      : null,
    queued: queued.map((entry) => mapQueuedEntry(entry, queued, "JUTSU")),
  };
};

export const getCraftQueueStatus = async (
  client: DrizzleClient,
  user: ActiveUser,
): Promise<ActivityQueueStatus> => {
  const [queued, useritems] = await Promise.all([
    fetchQueuedEntries(client, user.userId, "CRAFT"),
    fetchUserItems(client, user.userId),
  ]);
  const activeCraft = useritems.find(
    (ui) => ui.craftingFinishedAt && ui.craftingFinishedAt > new Date(),
  );

  return {
    type: "CRAFT",
    maxQueued: getMaxQueueSlots(user),
    maxPipeline: getMaxPipelineSlots(user),
    usedQueued: queued.length,
    active: activeCraft
      ? {
          label: activeCraft.item?.name ?? "Item",
          finishAt: activeCraft.craftingFinishedAt,
          itemId: activeCraft.itemId,
        }
      : null,
    queued: queued.map((entry) => mapQueuedEntry(entry, queued, "CRAFT")),
  };
};

const runInBatches = async <T, R>(
  items: T[],
  batchSize: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> => {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batchResults = await Promise.all(items.slice(i, i + batchSize).map(fn));
    results.push(...batchResults);
  }
  return results;
};

const countPromoted = async (
  userIds: string[],
  promote: (client: DrizzleClient, userId: string) => Promise<boolean>,
  client: DrizzleClient,
) => {
  const results = await runInBatches(userIds, PROMOTE_CONCURRENCY, (userId) =>
    promote(client, userId),
  );
  return results.filter(Boolean).length;
};

export const processActivityQueueTick = async (client: DrizzleClient) => {
  const now = new Date();

  const activeStatUsers = await client
    .select({
      userId: userData.userId,
      trainingStartedAt: userData.trainingStartedAt,
      trainingSpeed: userData.trainingSpeed,
    })
    .from(userData)
    .where(sql`${userData.currentlyTraining} IS NOT NULL`)
    .limit(PROCESS_BATCH_LIMIT);

  const expiredStatUserIds = activeStatUsers
    .filter((row) => {
      if (!row.trainingStartedAt) return false;
      const finishAt =
        row.trainingStartedAt.getTime() +
        trainingSpeedSeconds(row.trainingSpeed) * 1000;
      return now.getTime() >= finishAt;
    })
    .map((row) => row.userId);

  const statResults = await runInBatches(
    expiredStatUserIds,
    PROMOTE_CONCURRENCY,
    (userId) => tryCompleteExpiredStatTraining(client, userId),
  );
  const statCompleted = statResults.filter(Boolean).length;

  const usersWithJutsuQueue = await client
    .selectDistinct({ userId: userActivityQueue.userId })
    .from(userActivityQueue)
    .where(
      and(eq(userActivityQueue.type, "JUTSU"), eq(userActivityQueue.status, "QUEUED")),
    )
    .limit(PROCESS_BATCH_LIMIT);

  const jutsuPromoted = await countPromoted(
    usersWithJutsuQueue.map((row) => row.userId),
    promoteJutsuQueue,
    client,
  );

  const usersWithCraftQueue = await client
    .selectDistinct({ userId: userActivityQueue.userId })
    .from(userActivityQueue)
    .where(
      and(eq(userActivityQueue.type, "CRAFT"), eq(userActivityQueue.status, "QUEUED")),
    )
    .limit(PROCESS_BATCH_LIMIT);

  const craftPromoted = await countPromoted(
    usersWithCraftQueue.map((row) => row.userId),
    promoteCraftQueue,
    client,
  );

  const usersWithStatQueue = await client
    .selectDistinct({ userId: userActivityQueue.userId })
    .from(userActivityQueue)
    .where(
      and(eq(userActivityQueue.type, "STAT"), eq(userActivityQueue.status, "QUEUED")),
    )
    .limit(PROCESS_BATCH_LIMIT);

  await countPromoted(
    usersWithStatQueue.map((row) => row.userId),
    promoteStatQueue,
    client,
  );

  return { statCompleted, jutsuPromoted, craftPromoted };
};
