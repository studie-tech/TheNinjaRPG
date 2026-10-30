/**
 * Database access for dungeon; authorization and transaction scopes stay in callers.
 */
import {
  and,
  desc,
  eq,
  getTableColumns,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { nanoid } from "nanoid";
import { DUNGEON_LOBBY_SECONDS } from "@/drizzle/constants";
import {
  actionLog,
  battle,
  dungeon,
  dungeonMember,
  dungeonRun,
  item,
  jutsu,
  mapAsset,
  quest,
  questHistory,
  rewardPackage,
  userData,
  userItem,
  userPet,
} from "@/drizzle/schema";
import type { CompleteBattle } from "@/libs/combat/types";
import type { DrizzleClient } from "@/server/db";
import { activityCompletionExtras } from "@/server/utils/achievementObjectives";
import { resumeBracketImmunitySql } from "@/server/utils/objectiveWar";
import type { DungeonContent, DungeonRunState } from "@/validators/dungeon";

/** Build the `userData` lookup for `getAvailable`, selecting only `sector`, using predicates on `userId`. */
export const findUserDataForGetAvailable = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
) =>
  client.query.userData.findFirst({
    where: eq(userData.userId, ctx.userId),
    columns: { userId: true, sector: true, level: true },
  });

/** Build the `dungeon` listing for `getAvailable`. */
export const listDungeonForGetAvailable = (client: Pick<DrizzleClient, "query">) =>
  client.query.dungeon.findMany();

/** Build the `dungeonMember` selection for `getState`, using predicates on `userId`, `state`, `status`. */
export const selectDungeonMemberForGetState = (
  client: Pick<DrizzleClient, "select">,
  ctx: { userId: string },
) =>
  client
    .select({ id: dungeonRun.id })
    .from(dungeonMember)
    .innerJoin(dungeonRun, eq(dungeonRun.id, dungeonMember.runId))
    .where(
      and(
        eq(dungeonMember.userId, ctx.userId),
        sql`JSON_CONTAINS(${dungeonRun.state}, ${JSON.stringify(ctx.userId)}, '$.memberIds')`,
      ),
    )
    .union(
      client
        .select({ id: dungeonRun.id })
        .from(dungeonRun)
        .where(
          and(
            eq(dungeonRun.status, "LOBBY"),
            sql`JSON_CONTAINS(${dungeonRun.state}, ${JSON.stringify(ctx.userId)}, '$.invitedIds')`,
          ),
        ),
    )
    .as("visibleDungeonRuns");

/** Build the `candidates` selection for `getState`. */
export const selectCandidatesForGetState = (
  client: Pick<DrizzleClient, "select">,
  candidates: ReturnType<typeof selectDungeonMemberForGetState>,
  ctx: { userId: string },
) =>
  client
    .select(getTableColumns(dungeonRun))
    .from(candidates)
    .innerJoin(dungeonRun, eq(dungeonRun.id, candidates.id))
    .orderBy(
      // Keep the player's party, unclaimed rewards and invitations ahead of paid history.
      desc(
        sql`EXISTS (SELECT 1 FROM ${dungeonMember} WHERE ${dungeonMember.runId} = ${dungeonRun.id} AND ${dungeonMember.activeUserId} = ${ctx.userId})`,
      ),
      desc(eq(dungeonRun.status, "LOBBY")),
      desc(dungeonRun.createdAt),
    )
    .limit(20);

/** Build the `userData` listing for `getState`, using predicates on `userId`. */
export const listUserDataForGetState = (
  client: Pick<DrizzleClient, "query">,
  ids: string[],
) =>
  client.query.userData.findMany({
    where: inArray(userData.userId, ids),
    columns: { userId: true, username: true, status: true, isBanned: true },
  });

/** Build the `dungeonMember` listing for `getState`, using predicates on `runId`. */
export const listDungeonMemberForGetState = (
  client: Pick<DrizzleClient, "query">,
  runs: import("@/drizzle/schema").DungeonRun[],
) =>
  client.query.dungeonMember.findMany({
    where: inArray(
      dungeonMember.runId,
      runs.map((r) => r.id),
    ),
  });

/** Build the `dungeonRun` listing for `getState`, using predicates on `id`. */
export const listDungeonRunForGetState = (
  client: Pick<DrizzleClient, "query">,
  runs: import("@/drizzle/schema").DungeonRun[],
) =>
  client.query.dungeonRun.findMany({
    where: inArray(
      dungeonRun.id,
      runs.map((r) => r.id),
    ),
    orderBy: desc(dungeonRun.createdAt),
  });

/** Build the `battle` listing for `getState`, selecting only `id`, using predicates on `id`. */
export const listBattleForGetState = (
  client: Pick<DrizzleClient, "query">,
  interrupted: import("@/drizzle/schema").DungeonRun[],
) =>
  client.query.battle.findMany({
    where: inArray(
      battle.id,
      interrupted.map((r) => r.battleId as string),
    ),
    columns: { id: true },
  });

/** Build the `item` listing for `save`, selecting only `id` and `effects`, using predicates on `id`. */
export const listItemForSave = (
  client: Pick<DrizzleClient, "query">,
  drops: DungeonContent["rewards"]["drops"],
) =>
  client.query.item.findMany({
    where: inArray(
      item.id,
      drops.filter((d) => d.type === "item" || d.type === "cache").map((d) => d.id),
    ),
    columns: { id: true, effects: true },
  });

/** Build the `jutsu` listing for `save`, selecting only `id`, using predicates on `id`. */
export const listJutsuForSave = (
  client: Pick<DrizzleClient, "query">,
  drops: DungeonContent["rewards"]["drops"],
) =>
  client.query.jutsu.findMany({
    where: inArray(
      jutsu.id,
      drops.filter((d) => d.type === "jutsu").map((d) => d.id),
    ),
    columns: { id: true },
  });

/** Build the `mapAsset` lookup for `save`, selecting only `id`, using predicates on `id`. */
export const findMapAssetForSave = (
  client: Pick<DrizzleClient, "query">,
  input: { content: { structureAssetId: string } },
) =>
  client.query.mapAsset.findFirst({
    columns: { id: true },
    where: eq(mapAsset.id, input.content.structureAssetId),
  });

/** Build the `rewardPackage` listing for `save`, using predicates on `id`. */
export const listRewardPackageForSave = (
  client: Pick<DrizzleClient, "query">,
  drops: DungeonContent["rewards"]["drops"],
) =>
  client.query.rewardPackage.findMany({
    where: inArray(
      rewardPackage.id,
      drops.filter((d) => d.type === "package").map((d) => d.id),
    ),
  });

/** Build the `dungeon` insert for `save`, updating duplicate keys. */
export const insertDungeonForSave = (
  client: Pick<DrizzleClient, "insert">,
  id: string,
  content: DungeonContent,
) =>
  client
    .insert(dungeon)
    .values({ id, content, updatedAt: new Date() })
    .onDuplicateKeyUpdate({
      set: { content, updatedAt: new Date() },
    });

/** Build the `actionLog` insert for `save`. */
export const insertActionLogForSave = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  id: string,
  content: DungeonContent,
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    relatedId: id,
    tableName: "dungeon",
    relatedMsg: "Updated dungeon",
    changes: [JSON.stringify(content)],
  });

/** Build the `dungeon` lookup for `create`, using predicates on `id`. */
export const findDungeonForCreate = (
  client: Pick<DrizzleClient, "query">,
  input: { id: string },
) => client.query.dungeon.findFirst({ where: eq(dungeon.id, input.id) });

/** Build the `dungeonMember` lookup for `create`, using predicates on `activeUserId`. */
export const findDungeonMemberForCreate = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
) =>
  client.query.dungeonMember.findFirst({
    where: eq(dungeonMember.activeUserId, ctx.userId),
  });

/** Build the `dungeonRun` insert for `create`. */
export const insertDungeonRunForCreate = (
  client: Pick<DrizzleClient, "insert">,
  id: string,
  definition: { id: string },
  ctx: { userId: string },
  content: import("@/validators/dungeon").DungeonContent,
  pets?: DungeonRunState["pets"],
) =>
  client.insert(dungeonRun).values({
    id,
    dungeonId: definition.id,
    leaderId: ctx.userId,
    content,
    status: "LOBBY",
    expiresAt: new Date(Date.now() + DUNGEON_LOBBY_SECONDS * 1000),
    createdAt: new Date(),
    state: {
      pets,
      memberIds: [ctx.userId],
      invitedIds: [],
      readyIds: pets ? [ctx.userId] : [],
      floor: 0,
      clearedFloors: [],
      message: pets
        ? "Your companions are ready. Enter the first floor."
        : "Invite teammates, then have everyone ready up.",
    },
  });

/** Build a dungeon membership insert that marks the user active in the run. */
export const insertDungeonMember = (
  client: Pick<DrizzleClient, "insert">,
  runId: string,
  userId: string,
) =>
  client
    .insert(dungeonMember)
    .values({ runId: runId, userId: userId, activeUserId: userId });

/** Build the `dungeonRun` deletion for `create`, including predicates on `id`, `version`, `status`. */
export const deleteDungeonRunForCreate = (
  client: Pick<DrizzleClient, "delete">,
  id: string,
) =>
  client
    .delete(dungeonRun)
    .where(
      and(
        eq(dungeonRun.id, id),
        eq(dungeonRun.version, 0),
        eq(dungeonRun.status, "LOBBY"),
        sql`NOT EXISTS (SELECT 1 FROM ${dungeonMember} WHERE ${dungeonMember.runId} = ${dungeonRun.id})`,
      ),
    );

/** Build the `dungeonRun` lookup for `act`, using predicates on `id`. */
export const findDungeonRunForAct = (
  client: Pick<DrizzleClient, "query">,
  input: { id: string },
) => client.query.dungeonRun.findFirst({ where: eq(dungeonRun.id, input.id) });

/** Build the `dungeonMember` listing for `act`, using predicates on `activeUserId`. */
export const listDungeonMemberForAct = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
  input: { userId?: undefined | string },
) =>
  client.query.dungeonMember.findMany({
    where: inArray(dungeonMember.activeUserId, [
      ctx.userId,
      ...(input.userId ? [input.userId] : []),
    ]),
  });

/** Build the `dungeonRun` update for `reserve`, using predicates on `id` and `version`. */
export const updateDungeonRunForReserve = (
  client: Pick<DrizzleClient, "update">,
  battleId: string,
  expiresAt: Date,
  run: { version: number; expiresAt: null | Date; id: string },
  state: DungeonRunState,
) =>
  client
    .update(dungeonRun)
    .set({
      status: "FIGHTING",
      battleId,
      expiresAt,
      version: run.version + 1,
      state: {
        ...state,
        battlePublished: false,
        entryStartedAt: Date.now(),
        entryPreviousDeadline: run.expiresAt?.getTime() ?? null,
      },
    })
    .where(and(eq(dungeonRun.id, run.id), eq(dungeonRun.version, run.version)));

/** Build the `dungeonRun` update for `updateParty`, using predicates on `id` and `version`. */
export const updateDungeonRunForUpdateParty = (
  client: Pick<DrizzleClient, "update">,
  state: DungeonRunState,
  status:
    | "LOBBY"
    | "STARTING"
    | "FIGHTING"
    | "BETWEEN"
    | "PAUSED"
    | "COMPLETED"
    | "ENDED",
  run: { id: string; version: number },
) =>
  client
    .update(dungeonRun)
    .set({ state, status, version: sql`${dungeonRun.version} + 1` })
    .where(and(eq(dungeonRun.id, run.id), eq(dungeonRun.version, run.version)));

/** Build the `dungeonMember` deletion for `updateParty`, using predicates on `runId` and `userId`. */
export const deleteDungeonMemberForUpdateParty = (
  client: Pick<DrizzleClient, "delete">,
  run: { id: string },
  removedUser: string,
) =>
  client
    .delete(dungeonMember)
    .where(and(eq(dungeonMember.runId, run.id), eq(dungeonMember.userId, removedUser)));

/** Build the active-user reset for every member of a dungeon run. */
export const clearDungeonActiveUsers = (
  client: Pick<DrizzleClient, "update">,
  runId: string,
) =>
  client
    .update(dungeonMember)
    .set({ activeUserId: null })
    .where(eq(dungeonMember.runId, runId));

/** Build the `dungeonMember` lookup for `claim`, using predicates on `runId` and `userId`. */
export const findDungeonMemberForClaim = (
  client: Pick<DrizzleClient, "query">,
  input: { id: string },
  ctx: { userId: string },
) =>
  client.query.dungeonMember.findFirst({
    where: and(eq(dungeonMember.runId, input.id), eq(dungeonMember.userId, ctx.userId)),
  });

/** Serialize completion grants for an existing player across different dungeon runs. */
export const lockDungeonRewardUser = (
  client: Pick<DrizzleClient, "select">,
  userId: string,
) =>
  client
    .select({ userId: userData.userId })
    .from(userData)
    .where(eq(userData.userId, userId))
    .for("update");

/** Durable completion receipts preserve drop history even after inventory is consumed. */
export const listDungeonRewardHistory = (
  client: Pick<DrizzleClient, "select">,
  userId: string,
  dungeonId: string,
) =>
  client
    .select({ reward: dungeonMember.reward })
    .from(dungeonMember)
    .innerJoin(dungeonRun, eq(dungeonRun.id, dungeonMember.runId))
    .where(
      and(
        eq(dungeonMember.userId, userId),
        eq(dungeonRun.dungeonId, dungeonId),
        isNotNull(dungeonMember.reward),
      ),
    );

/**
 * Build the `dungeonMember` update for `claim`, setting `reward` and `activeUserId`,
 * using predicates on `runId`, `userId`, `reward`.
 */
export const updateDungeonMemberForClaim = (
  client: Pick<DrizzleClient, "update">,
  receipt: {
    money: number;
    experience: number;
    tokens: number;
    prestige: number;
    items: string[];
    jutsus: string[];
    rewards: import("@/validators/rewards").PostProcessedRewards;
    grantedDrops?: string[];
  },
  run: { id: string },
  ctx: { userId: string },
) =>
  client
    .update(dungeonMember)
    .set({ reward: receipt, activeUserId: null })
    .where(
      and(
        eq(dungeonMember.runId, run.id),
        eq(dungeonMember.userId, ctx.userId),
        isNull(dungeonMember.reward),
      ),
    );

/** Finalize the reserved receipt with actual delivery inside the claim transaction. */
export const updateDungeonRewardReceipt = (
  client: Pick<DrizzleClient, "update">,
  runId: string,
  userId: string,
  receipt: import("@/validators/dungeon").DungeonRewardReceipt,
) =>
  client
    .update(dungeonMember)
    .set({ reward: receipt })
    .where(
      and(
        eq(dungeonMember.runId, runId),
        eq(dungeonMember.userId, userId),
        isNotNull(dungeonMember.reward),
      ),
    );

/** Build the `dungeonRun` update for `rollbackDungeonStart`, using predicates on `id`, `battleId`, `version`. */
export const updateDungeonRunForRollbackDungeonStart = (
  client: Pick<DrizzleClient, "update">,
  run: { expiresAt: null | Date; id: string; state?: DungeonRunState },
  state: Omit<DungeonRunState, "entryStartedAt" | "entryPreviousDeadline">,
  battleId: string,
  version: number,
) =>
  client
    .update(dungeonRun)
    .set({
      status: run.state?.entryPaidAt ? "BETWEEN" : "LOBBY",
      battleId: null,
      expiresAt: run.expiresAt,
      version: sql`${dungeonRun.version} + 1`,
      state: { ...state, readyIds: [] },
    })
    .where(
      and(
        eq(dungeonRun.id, run.id),
        eq(dungeonRun.battleId, battleId),
        eq(dungeonRun.version, version),
      ),
    );

/** Build the `dungeonRun` update for `settleDungeonBattle`, including predicates on `id`, `battleId`, `version`. */
export const updateDungeonRunForSettleDungeonBattle = (
  client: Pick<DrizzleClient, "update">,
  next: Omit<DungeonRunState, "readyIds"> & { readyIds: never[] },
  status: "BETWEEN" | "COMPLETED" | "ENDED",
  meta: { runId: string; runVersion: number },
  current: { id: string },
) =>
  client
    .update(dungeonRun)
    .set({
      state: next,
      status,
      battleId: null,
      version: sql`${dungeonRun.version} + 1`,
    })
    .where(
      and(
        eq(dungeonRun.id, meta.runId),
        eq(dungeonRun.battleId, current.id),
        eq(dungeonRun.version, meta.runVersion),
        eq(dungeonRun.status, "FIGHTING"),
      ),
    );

/** Build the `userData` update for `settleDungeonBattle`, using predicates on `userId` and `battleId`. */
export const updateUserDataForSettleDungeonBattle = (
  client: Pick<DrizzleClient, "update">,
  dungeonEnergyRecoverySql: (
    snapshot: CompleteBattle | undefined,
    memberIds: string[],
    at: Date,
  ) => SQL<unknown>,
  current: import("@/libs/combat/types").CompleteBattle,
  meta: { runState: { memberIds: string[] } },
  settledAt: Date,
  keepQueued: boolean,
) =>
  client
    .update(userData)
    .set({
      status: keepQueued ? "QUEUED" : "AWAKE",
      battleId: null,
      bracketImmunityLiftedUntil: resumeBracketImmunitySql(),
      bracketImmunityPausedAt: null,
      curHealth: sql`${userData.maxHealth}`,
      curChakra: sql`${userData.maxChakra}`,
      curStamina: sql`${userData.maxStamina}`,
      curEnergy: dungeonEnergyRecoverySql(current, meta.runState.memberIds, settledAt),
      regenAt: settledAt,
      updatedAt: settledAt,
    })
    .where(
      and(
        inArray(userData.userId, meta.runState.memberIds),
        eq(userData.battleId, current.id),
      ),
    );

/** Build the `battle` lookup for `expireDungeonRun`, using predicates on `id`. */
export const findBattleForExpireDungeonRun = (
  client: Pick<DrizzleClient, "query">,
  run: { battleId: string },
) => client.query.battle.findFirst({ where: eq(battle.id, run.battleId) });

/** Build the `dungeonRun` update for `expireDungeonRun`, using predicates on `id` and `version`. */
export const updateDungeonRunForExpireDungeonRun = (
  client: Pick<DrizzleClient, "update">,
  run: {
    state: DungeonRunState;
    status?: string;
    id: string;
    version: number;
  },
) =>
  client
    .update(dungeonRun)
    .set({
      status: "ENDED",
      battleId: null,
      version: sql`${dungeonRun.version} + 1`,
      state: expiredDungeonState(run),
    })
    .where(and(eq(dungeonRun.id, run.id), eq(dungeonRun.version, run.version)));

/**
 * End a battle-free run and release its own queue and memberships in one guarded update.
 * Affected rows span all joined tables, rather than counting claimed runs alone.
 */
export const expireDungeonRunWithoutBattle = (
  client: Pick<DrizzleClient, "execute">,
  run: typeof dungeonRun.$inferSelect,
) =>
  // Resolve wake eligibility in the join before activeUserId is cleared. Missing or busy
  // users must not prevent the run and membership cleanup from committing.
  client.execute(sql`UPDATE ${dungeonRun}
    LEFT JOIN ${dungeonMember} ON ${dungeonMember.runId} = ${dungeonRun.id}
    LEFT JOIN ${userData} ON ${userData.userId} = ${dungeonMember.activeUserId}
      AND ${userData.status} = 'QUEUED' AND ${userData.battleId} IS NULL
    SET ${dungeonRun.status} = 'ENDED', ${dungeonRun.battleId} = NULL,
      ${dungeonRun.version} = ${dungeonRun.version} + 1,
      ${dungeonRun.state} = CAST(${JSON.stringify(expiredDungeonState(run))} AS JSON),
      ${userData.status} = 'AWAKE', ${userData.updatedAt} = NOW(3),
      ${dungeonMember.activeUserId} = NULL
    WHERE ${dungeonRun.id} = ${run.id} AND ${dungeonRun.version} = ${run.version}
      AND ${dungeonRun.status} = ${run.status}
      AND ${dungeonRun.status} NOT IN ('ENDED', 'COMPLETED')
      AND ${dungeonRun.battleId} IS NULL
      AND (${dungeonRun.expiresAt} <= NOW(3) OR (${dungeonRun.status} = 'LOBBY'
        AND ${dungeonRun.expiresAt} IS NULL
        AND ${dungeonRun.createdAt} <= TIMESTAMPADD(SECOND, ${-DUNGEON_LOBBY_SECONDS}, NOW(3))))`);

/** Build the `userData` update for `expireDungeonRun`, using predicates on `userId` and `battleId`. */
export const updateUserDataForExpireDungeonRun = (
  client: Pick<DrizzleClient, "update">,
  dungeonEnergyRecoverySql: (
    snapshot: CompleteBattle | undefined,
    memberIds: string[],
    at: Date,
  ) => SQL<unknown>,
  snapshot: undefined | import("@/drizzle/schema").Battle,
  run: { state: { memberIds: string[] }; battleId: string },
  settledAt: Date,
) =>
  client
    .update(userData)
    .set({
      status: "AWAKE",
      battleId: null,
      bracketImmunityLiftedUntil: resumeBracketImmunitySql(),
      bracketImmunityPausedAt: null,
      curHealth: sql`${userData.maxHealth}`,
      curChakra: sql`${userData.maxChakra}`,
      curStamina: sql`${userData.maxStamina}`,
      curEnergy: dungeonEnergyRecoverySql(snapshot, run.state.memberIds, settledAt),
      updatedAt: settledAt,
      regenAt: settledAt,
    })
    .where(
      and(
        inArray(userData.userId, run.state.memberIds),
        eq(userData.battleId, run.battleId),
      ),
    );

/** One active reservation identifies the queue owner and private squad navigation. */
export const findActiveDungeonRun = (
  client: Pick<DrizzleClient, "select">,
  userId: string,
) =>
  client
    .select({ run: dungeonRun })
    .from(dungeonMember)
    .innerJoin(dungeonRun, eq(dungeonRun.id, dungeonMember.runId))
    .where(eq(dungeonMember.activeUserId, userId))
    .limit(1);

/** Claim ordinary play only for the account's own newly inserted membership. */
export const claimDungeonQueue = (
  client: Pick<DrizzleClient, "update">,
  userId: string,
  runId: string,
) =>
  client
    .update(userData)
    .set({ status: "QUEUED", updatedAt: new Date() })
    .where(
      and(
        eq(userData.userId, userId),
        eq(userData.status, "AWAKE"),
        isNull(userData.battleId),
        eq(userData.isBanned, false),
        sql`EXISTS (SELECT 1 FROM ${dungeonMember} INNER JOIN ${dungeonRun} ON ${dungeonRun.id} = ${dungeonMember.runId} WHERE ${dungeonMember.runId} = ${runId} AND ${dungeonMember.activeUserId} = ${userData.userId} AND ${dungeonRun.status} IN ('LOBBY', 'BETWEEN', 'PAUSED') AND (${dungeonRun.expiresAt} IS NULL OR ${dungeonRun.expiresAt} > NOW(3)))`,
      ),
    );

/** Release only a queue owned by this run, before deleting its membership reservation. */
export const releaseDungeonQueue = (
  client: Pick<DrizzleClient, "update">,
  runId: string,
  userId?: string,
) =>
  client
    .update(userData)
    .set({ status: "AWAKE", updatedAt: new Date() })
    .where(
      and(
        eq(userData.status, "QUEUED"),
        isNull(userData.battleId),
        userId ? eq(userData.userId, userId) : undefined,
        sql`EXISTS (SELECT 1 FROM ${dungeonMember} WHERE ${dungeonMember.runId} = ${runId} AND ${dungeonMember.activeUserId} = ${userData.userId})`,
      ),
    );

/** Project durable entry/completion receipts, retaining creation time for legacy rewards. */
export const listDungeonEntryHistory = (
  client: Pick<DrizzleClient, "select">,
  userIds: string[],
) =>
  client
    .select({
      userId: dungeonMember.userId,
      dungeonId: dungeonRun.dungeonId,
      entryPaidAt: sql`JSON_EXTRACT(${dungeonRun.state}, '$.entryPaidAt')`.mapWith(
        (value: string | number | null) =>
          value === null || value === "null" ? null : Number(value),
      ),
      claimedAt: sql`JSON_EXTRACT(${dungeonMember.reward}, '$.claimedAt')`.mapWith(
        (value: string | number | null) =>
          value === null || value === "null" ? null : Number(value),
      ),
      hasReward:
        // The driver can return SQL integer expressions as strings; "0" is not a receipt.
        sql`COALESCE(JSON_TYPE(${dungeonMember.reward}) = 'OBJECT', FALSE)`.mapWith(
          (value: string | number) => Number(value) === 1,
        ),
      createdAt: dungeonRun.createdAt,
    })
    .from(dungeonMember)
    .innerJoin(dungeonRun, eq(dungeonRun.id, dungeonMember.runId))
    .where(inArray(dungeonMember.userId, userIds));

/** Load historical completion evidence independently of a quest's current attempt. */
export const listDungeonPrerequisites = (
  client: Pick<DrizzleClient, "query">,
  userIds: string[],
) =>
  client.query.questHistory.findMany({
    where: and(
      inArray(questHistory.userId, userIds),
      or(eq(questHistory.completed, 1), gt(questHistory.previousCompletes, 0)),
    ),
    columns: { userId: true, questId: true },
  });

/** Load carried, available item stacks for admission and the subsequent guarded debits. */
export const listDungeonEntryInventory = (
  client: Pick<DrizzleClient, "query">,
  userIds: string[],
) =>
  client.query.userItem.findMany({
    columns: {
      id: true,
      userId: true,
      itemId: true,
      quantity: true,
      storedAtHome: true,
      isInAuction: true,
    },
    where: and(
      inArray(userItem.userId, userIds),
      gt(userItem.quantity, 0),
      eq(userItem.storedAtHome, false),
      eq(userItem.isInAuction, false),
      or(
        isNull(userItem.craftingFinishedAt),
        lt(userItem.craftingFinishedAt, new Date()),
      ),
    ),
  });

/** Resolve referenced catalog rows together for save validation and requirement labels. */
export const findDungeonRequirementSources = (
  client: Pick<DrizzleClient, "query">,
  requirements: DungeonContent["requirements"],
) =>
  Promise.all([
    requirements.prerequisiteQuestId
      ? client.query.quest.findFirst({
          where: eq(quest.id, requirements.prerequisiteQuestId),
          columns: { id: true, name: true },
        })
      : null,
    requirements.requiredItemId
      ? client.query.item.findFirst({
          where: eq(item.id, requirements.requiredItemId),
          columns: { id: true, name: true },
        })
      : null,
  ]);

/** The run receipt commits with inventory debits and battle inserts in the admission transaction. */
export const markDungeonFloorPublished = (
  client: Pick<DrizzleClient, "update">,
  runId: string,
  battleId: string,
  version: number,
  state: DungeonRunState,
) =>
  client
    .update(dungeonRun)
    .set({ state })
    .where(
      and(
        eq(dungeonRun.id, runId),
        eq(dungeonRun.version, version),
        eq(dungeonRun.battleId, battleId),
        eq(dungeonRun.status, "FIGHTING"),
        sql`COALESCE(JSON_UNQUOTE(JSON_EXTRACT(${dungeonRun.state}, '$.battlePublished')), 'false') = 'false'`,
      ),
    );

/**
 * Grant selected companions completion XP in their active or parked bank.
 * Call once per pet: a joined UPDATE writes the shared owner row only once, so
 * mixing active and parked pets in one statement would make its XP delta ambiguous.
 */
export const grantDungeonPetExperience = (
  client: Pick<DrizzleClient, "execute">,
  userId: string,
  petIds: string[],
  experience: number,
) =>
  client.execute(sql`UPDATE ${userPet} INNER JOIN ${userData} ON ${eq(userData.userId, userPet.userId)}
    SET ${userPet.revision} = ${userPet.revision} + 1, ${userPet.updatedAt} = NOW(3),
        ${userPet.storedExperience} = ${userPet.storedExperience} + IF(${userPet.id} = ${userData.activePetId}, 0, ${experience}),
        ${userData.petExperience} = ${userData.petExperience} + IF(${userPet.id} = ${userData.activePetId}, ${experience}, 0)
    WHERE ${and(eq(userPet.userId, userId), inArray(userPet.id, petIds))}`);

/** Bounded deadline sweep includes offline parties and interrupted floor reservations. */
export const listExpiredDungeonRuns = (client: Pick<DrizzleClient, "query">) =>
  client.query.dungeonRun.findMany({
    where: and(
      inArray(dungeonRun.status, [
        "LOBBY",
        "STARTING",
        "FIGHTING",
        "BETWEEN",
        "PAUSED",
      ]),
      or(
        lte(dungeonRun.expiresAt, new Date()),
        and(
          eq(dungeonRun.status, "LOBBY"),
          isNull(dungeonRun.expiresAt),
          lte(
            dungeonRun.createdAt,
            new Date(Date.now() - DUNGEON_LOBBY_SECONDS * 1000),
          ),
        ),
      ),
    ),
    limit: 100,
  });

/** Fence an unpublished launcher before destructive recovery; publication uses the same row. */
export const claimDungeonStartRecovery = (
  client: Pick<DrizzleClient, "update">,
  runId: string,
  battleId: string,
  version: number,
) =>
  client
    .update(dungeonRun)
    .set({ status: "STARTING", version: sql`${dungeonRun.version} + 1` })
    .where(
      and(
        eq(dungeonRun.id, runId),
        eq(dungeonRun.battleId, battleId),
        eq(dungeonRun.version, version),
        eq(dungeonRun.status, "FIGHTING"),
        sql`COALESCE(JSON_UNQUOTE(JSON_EXTRACT(${dungeonRun.state}, '$.battlePublished')), 'false') = 'false'`,
      ),
    );

/** Keep expiry notices and cleared readiness identical for both cleanup write paths. */
const expiredDungeonState = (run: { state: DungeonRunState; status?: string }) => ({
  ...run.state,
  readyIds: [],
  message:
    run.status === "LOBBY"
      ? `The ${DUNGEON_LOBBY_SECONDS / 60}-minute dungeon lobby expired.`
      : "The one-hour dungeon deadline expired.",
});

/** Confirm scalar reward balances and mastery state; membership rewards use a full profile. */
export const findDungeonRewardUserCache = (
  client: Pick<DrizzleClient, "query">,
  userId: string,
) =>
  client.query.userData.findFirst({
    where: eq(userData.userId, userId),
    columns: {
      money: true,
      seichiSilver: true,
      earnedExperience: true,
      petExperience: true,
      reputationPoints: true,
      reputationPointsTotal: true,
      villagePrestige: true,
      skillPoints: true,
      medicalExperience: true,
      huntingExperience: true,
      craftingExperience: true,
      gatheringExperience: true,
      sageMasteryExperience: true,
      level: true,
      rank: true,
      bloodlineId: true,
      isAi: true,
      ninjutsuMastery: true,
      genjutsuMastery: true,
      taijutsuMastery: true,
      bukijutsuMastery: true,
      bloodlineMastery: true,
      sageMastery: true,
      masteryRanks: true,
      sageModeId: true,
    },
    extras: (table) => activityCompletionExtras(table.userId),
    with: {
      sageMode: true,
      titles: { with: { title: true } },
    },
  });
