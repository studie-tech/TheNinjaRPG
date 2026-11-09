import { vi } from "bun:test";
import { eq, type SQL } from "drizzle-orm";
import { captureCombatCacheSnapshot } from "@/deltas/combat";
import type { BattleType } from "@/drizzle/constants";
import {
  type AiProfile,
  battle,
  battleHistory,
  combatSharedCooldown,
  jutsuEquipLimit,
  userData,
} from "@/drizzle/schema";
import { refreshMasteries } from "@/libs/combat/mastery";
import type {
  CombatQueryUser,
  CombatQueryUserJutsu,
  CompleteBattle,
} from "@/libs/combat/types";
import type { fetchBattleEssentials } from "@/queries/combat";
import { processUsersForBattle } from "@/server/api/routers/combat";
import { fetchUserItemsWithVariants } from "@/server/api/routers/item";
import { fetchUserJutsus } from "@/server/api/routers/jutsu";
import type { DrizzleClient } from "@/server/db";
import { makeBattleUser, makeUser, tableDefaults } from "../../../setup/combat";
import { equipLimitFixture } from "../../../setup/jutsuEquipLimits";

type PreloadOptions = Parameters<typeof processUsersForBattle>[1];
type Essentials = Awaited<ReturnType<typeof fetchBattleEssentials>>;
type Preloaded = Awaited<ReturnType<typeof processUsersForBattle>>;

/** Fetched-character shape battle initiation consumes: a battle user with empty relations. */
export const makeCombatQueryUser = (
  id: string,
  overrides: Record<string, unknown> = {},
): CombatQueryUser =>
  makeBattleUser(id, {
    regenAt: new Date(),
    regeneration: 0,
    money: 0,
    effects: [],
    bloodright: [],
    userSkills: [],
    items: [],
    jutsus: [],
    bloodline: null,
    village: null,
    clan: null,
    anbuSquad: null,
    aiProfile: null,
    ...overrides,
  }) as unknown as CombatQueryUser;

/**
 * Runs battle initiation on preloaded combatants in a 10x10 COMBAT battle with the
 * first user on the left. Scenarios that reach the database pass a stub `client`.
 */
export const preloadBattle = (
  users: CombatQueryUser[],
  {
    client = {} as DrizzleClient,
    ...options
  }: Partial<PreloadOptions> & { client?: DrizzleClient } = {},
) =>
  processUsersForBattle(client, {
    users,
    battleType: "COMBAT",
    leftSideUserIds: users.slice(0, 1).map((user) => user.userId),
    hide: false,
    isSummon: false,
    width: 10,
    height: 10,
    settings: [],
    relations: [],
    wars: [],
    villages: [],
    defaultProfile: { id: "default" } as AiProfile,
    ...options,
  });

/** The stored character as battle initiation receives it: equipped jutsu and every owned item. */
export const loadCombatant = async (
  db: DrizzleClient,
  userId: string,
  essentials: Essentials,
  {
    equippedItemsOnly = false,
    unequippedJutsus = false,
    applyReskins = true,
    ...relations
  }: {
    equippedItemsOnly?: boolean;
    unequippedJutsus?: boolean;
    applyReskins?: boolean;
  } & Record<string, unknown> = {},
) => {
  const row = await db.query.userData.findFirst({ where: eq(userData.userId, userId) });
  if (!row) throw new Error(`Missing ${userId}`);
  const items = await fetchUserItemsWithVariants(db, userId);
  const jutsus = await fetchUserJutsus(db, userId, undefined, { applyReskins });
  return {
    ...row,
    items: equippedItemsOnly
      ? items.filter((owned) => owned.equipped !== "NONE")
      : items,
    jutsus: unequippedJutsus ? jutsus : jutsus.filter((owned) => owned.equipped),
    userSkills: [],
    bloodline: null,
    village: null,
    aiProfile: essentials.defaultProfile,
    ...relations,
  } as CombatQueryUser;
};

/** Runs battle initiation on `users` with the stored essentials on the standard 13x9 lobby grid. */
export const preloadLobby = (
  db: DrizzleClient,
  users: CombatQueryUser[],
  essentials: Essentials,
  battleType: BattleType,
  options: Partial<PreloadOptions> = {},
) =>
  processUsersForBattle(db, {
    users,
    ...essentials,
    wars: essentials.activeWars,
    battleType,
    hide: false,
    isSummon: false,
    width: 13,
    height: 9,
    ...options,
  });

/** Stores a preloaded battle whose round has not started yet. */
export const insertLobbyBattle = (
  db: DrizzleClient,
  id: string,
  battleType: BattleType,
  { usersState, userEffects, extraState }: Preloaded,
) =>
  db.insert(battle).values({
    id,
    background: "default",
    battleType,
    roundStartAt: new Date(Date.now() + 60_000),
    usersState,
    usersEffects: userEffects,
    extraState,
    groundEffects: [],
  });

/** Stores `raw` on the lobby with the snapshot and masteries a loadout switch compares against. */
export const insertSnapshotLobby = async (
  db: DrizzleClient,
  id: string,
  battleType: BattleType,
  raw: CombatQueryUser,
  processed: Preloaded,
) => {
  processed.extraState.profileCacheSnapshots = {
    [raw.userId]: captureCombatCacheSnapshot(raw),
  };
  refreshMasteries(processed.usersState, processed.userEffects);
  await insertLobbyBattle(db, id, battleType, processed);
};

/** Character row with empty relations, as `initiateBattle` reads it back. */
export const makeInitiationUser = (
  overrides: { userId: string } & Record<string, unknown>,
) => ({
  ...tableDefaults(userData),
  ...makeUser({
    username: overrides.userId,
    controllerId: overrides.userId,
    experience: 3339000,
    rank: "JONIN",
    status: "AWAKE",
    ...overrides,
  }),
  items: [],
  jutsus: [] as CombatQueryUserJutsu[],
  userSkills: [],
  queue: [],
  cookingJobs: [],
  raidBuffs: [],
  userQuests: [],
  completedQuests: [],
  bounties: [],
  bountySignups: [],
  bloodline: null,
  sageMode: null,
  village: null,
  clan: null,
  regenAt: new Date(),
  joinedVillageAt: new Date(),
});

/** Client answering `initiateBattle` from `users` and capturing the saved battle. */
export const fakeInitiationClient = (
  users: ReturnType<typeof makeInitiationUser>[],
  {
    historyCount = 0,
    equipLimits = equipLimitFixture,
    otherRows = [],
    onHistoryRead,
    onWrite,
  }: {
    historyCount?: number;
    equipLimits?: typeof equipLimitFixture;
    otherRows?: object[];
    onHistoryRead?: (predicate: SQL) => void;
    onWrite?: () => void;
  } = {},
) => {
  let saved: CompleteBattle | undefined;
  const readEquipLimits = vi.fn(async () => equipLimits);
  const client = {
    query: new Proxy(
      {},
      {
        get: (_target, key) => ({
          findMany: async () => (key === "userData" ? structuredClone(users) : []),
          findFirst: async () =>
            key === "aiProfile"
              ? { id: "Default", rules: [], includeDefaultRules: false }
              : undefined,
        }),
      },
    ),
    select: () => ({
      from: (table: object) => {
        if (table === combatSharedCooldown) return { orderBy: async () => [] };
        if (table === jutsuEquipLimit) return { orderBy: readEquipLimits };
        const rows =
          table === battleHistory
            ? [{ count: historyCount }]
            : table === userData
              ? [{ average: 0 }]
              : otherRows;
        const builder = {
          innerJoin: () => builder,
          where: (predicate: SQL) => {
            if (table === battleHistory) onHistoryRead?.(predicate);
            return builder;
          },
          then: (resolve: (value: unknown) => unknown) =>
            Promise.resolve(rows).then(resolve),
        };
        return builder;
      },
    }),
    insert: (table: object) => ({
      values: async (value: unknown) => {
        onWrite?.();
        if (table === battle) saved = value as CompleteBattle;
        return { rowsAffected: 1 };
      },
    }),
    update: () => ({
      set: () => ({
        where: async () => ({
          rowsAffected: users.filter((user) => !user.isAi).length,
        }),
      }),
    }),
  } as unknown as DrizzleClient;
  return { client, saved: () => saved, readEquipLimits };
};
