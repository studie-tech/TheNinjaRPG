import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { eq } from "drizzle-orm";
import type { ZodType } from "zod";
import type { UserUpdateOptions } from "@/deltas/profile";
import { getRobPlayerUserUpdate } from "@/deltas/travel";
import {
  DMG_SETTING_DEFAULTS,
  MAP_WAR_TORN_BATTLEGROUND_SECTOR,
} from "@/drizzle/constants";
import {
  actionLog,
  aiProfile,
  battle,
  battleHistory,
  gameSetting,
  userData,
  village,
} from "@/drizzle/schema";
import { AUTO_CHECKOUT_MESSAGE, AUTO_WAKE_MESSAGE } from "@/libs/actionReadiness";
import { Pusher } from "@/libs/pusher";
import { fetchActionUser } from "@/queries/actionReadiness";
import { travelRouter } from "@/server/api/routers/travel";
import { prepareUserUpdate, updateUserCache } from "@/utils/userCache";
import type { UserDeltaResponse } from "@/validators/userCache";
import { withAfterTasks } from "../../../../setup/after";
import { insertDefaultAiProfile, insertUsers } from "../../../../setup/factories";
import { stubRateLimitTransport } from "../../../../setup/rateLimit";
import { beforeStatements } from "../../../../setup/statements";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

const ROBBER = "pvp-robber";
const VICTIM = "pvp-victim";
const location = {
  sector: MAP_WAR_TORN_BATTLEGROUND_SECTOR,
  longitude: 10,
  latitude: 10,
};
const readVictim = async () =>
  (await getTestDatabase()).query.userData.findFirst({
    where: eq(userData.userId, VICTIM),
  });
const readRobber = async () =>
  (await getTestDatabase()).query.userData.findFirst({
    where: eq(userData.userId, ROBBER),
  });

describeWithDatabase("robbery generated prestige PvP boost", () => {
  beforeEach(async () => {
    stubRateLimitTransport();
    await resetTables(
      actionLog,
      aiProfile,
      battle,
      battleHistory,
      gameSetting,
      userData,
      village,
    );
    await insertUsers([
      {
        userId: ROBBER,
        username: ROBBER,
        rank: "JONIN",
        isOutlaw: true,
        status: "AWAKE",
        ...location,
        pvpExperience: 1400,
        money: 500,
        villagePrestige: 0,
      },
      {
        userId: VICTIM,
        username: VICTIM,
        rank: "JONIN",
        status: "AWAKE",
        ...location,
        pvpExperience: 600,
        money: 1000,
        immunityUntil: new Date(0),
        robImmunityUntil: new Date(0),
      },
    ]);
    vi.spyOn(Math, "random").mockReturnValue(0);
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it.each([
    { xp: 1400, prestige: 5.75 },
    { xp: 0, prestige: 5 },
  ])(
    "boosts generated prestige for XP=$xp while preserving stolen ryo",
    async ({ xp, prestige }) => {
      const db = await getTestDatabase();
      await db
        .update(userData)
        .set({ pvpExperience: xp })
        .where(eq(userData.userId, ROBBER));
      const result = await (await callerFor(travelRouter, ROBBER)).robPlayer({
        userId: VICTIM,
        ...location,
      });
      expect(result.success).toBe(true);
      expect(result.money).toBe(800);
      expect(result.userDelta).toMatchObject({ money: 300, villagePrestige: prestige });
      expect(await readRobber()).toMatchObject({
        money: 800,
        villagePrestige: prestige,
      });
      expect(await readVictim()).toMatchObject({ money: 700 });
    },
  );

  it("credits nothing when the target deduction fails", async () => {
    const db = await getTestDatabase();
    const client = beforeStatements(db, userData, [
      async () => {
        await db.delete(userData).where(eq(userData.userId, VICTIM));
      },
    ]);
    const result = await callerForDatabase(travelRouter, ROBBER, client).robPlayer({
      userId: VICTIM,
      ...location,
    });
    expect(result.success).toBe(false);
    expect(await readRobber()).toMatchObject({ money: 500, villagePrestige: 0 });
    expect(await db.query.actionLog.findMany()).toHaveLength(0);
  });

  it.each([
    {
      change: "gains robbery immunity",
      set: { robImmunityUntil: new Date(Date.now() + 3_600_000) },
    },
    {
      change: "gains general immunity",
      set: { immunityUntil: new Date(Date.now() + 3_600_000) },
    },
    { change: "spends their ryo", set: { money: 100 } },
    { change: "leaves the tile", set: { longitude: 11 } },
  ])("credits nothing when the target $change after the read", async ({ set }) => {
    const db = await getTestDatabase();
    const client = beforeStatements(db, userData, [
      async () => {
        await db.update(userData).set(set).where(eq(userData.userId, VICTIM));
      },
    ]);
    const result = await callerForDatabase(travelRouter, ROBBER, client).robPlayer({
      userId: VICTIM,
      ...location,
    });
    expect(result.success).toBe(false);
    expect(await readRobber()).toMatchObject({ money: 500, villagePrestige: 0 });
    expect(await readVictim()).toMatchObject({ money: set.money ?? 1000 });
    expect(await db.query.actionLog.findMany()).toHaveLength(0);
  });

  it("robs the target once when concurrent robberies race", async () => {
    const caller = await callerFor(travelRouter, ROBBER);
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        caller.robPlayer({ userId: VICTIM, ...location }),
      ),
    );
    expect(results.filter((result) => result.success)).toHaveLength(1);
    expect(await readRobber()).toMatchObject({ money: 800 });
    expect(await readVictim()).toMatchObject({ money: 700 });
  });

  it.each(["ASLEEP", "HOSPITALIZED"] as const)(
    "preserves committed %s recovery when the combat target moves",
    async (status) => {
      const db = await getTestDatabase();
      await db
        .update(userData)
        .set({
          status,
          curHealth: 1,
          maxHealth: 1000,
          regeneration: 0,
          regenAt: new Date(0),
        })
        .where(eq(userData.userId, ROBBER));
      await insertDefaultAiProfile();
      await db.insert(gameSetting).values(
        Object.entries(DMG_SETTING_DEFAULTS).map(([name, value]) => ({
          id: name,
          name,
          value,
          time: new Date(),
        })),
      );
      vi.spyOn(Math, "random").mockReturnValue(0.99);
      const initial = {
        userData: await fetchActionUser(db, ROBBER),
        notifications: [],
      };
      const raced = beforeStatements(db, userData, [
        () =>
          db
            .update(userData)
            .set({ longitude: location.longitude + 1 })
            .where(eq(userData.userId, VICTIM)),
      ]);
      const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const key = [["profile", "getUser"], { type: "query" }];
      cache.setQueryData(key, initial);
      const read = vi.fn(async () => initial);
      const stop = new QueryObserver(cache, {
        queryKey: key,
        staleTime: Infinity,
        queryFn: read,
      }).subscribe(() => {});
      const source = readFileSync(
        join(import.meta.dirname, "../../../../../src/layout/Sector.tsx"),
        "utf8",
      );
      const callbacks = source
        .slice(source.indexOf("api.travel.robPlayer.useMutation("))
        .match(/useMutation\((\{[\s\S]*?\n  \})\);/)?.[1];
      if (!callbacks) throw new Error("Robbery callbacks were not found");
      const toast = vi.fn();
      const options = new Function(
        "prepareUserUpdate",
        "updateUser",
        "showMutationToast",
        `return (${callbacks});`,
      )(
        () => prepareUserUpdate(cache, key),
        (response: UserDeltaResponse, update: UserUpdateOptions) =>
          updateUserCache(cache, key, response, update),
        toast,
      ) as {
        onMutate: () => number | undefined;
        onSuccess: (
          response: UserDeltaResponse,
          input: unknown,
          revision: number | undefined,
        ) => Promise<void>;
      };
      try {
        const revision = options.onMutate();
        const result = await withAfterTasks({
          start: () =>
            callerForDatabase(travelRouter, ROBBER, raced).robPlayer({
              userId: VICTIM,
              ...location,
            }),
        }).start();
        const notice = status === "ASLEEP" ? AUTO_WAKE_MESSAGE : AUTO_CHECKOUT_MESSAGE;
        expect(result).toMatchObject({
          success: false,
          actionNotice: notice,
          message: `Attack failed, did the target move? ${notice}`,
          userRecovery: {
            userId: ROBBER,
            requiresUserRefresh: true,
            activity: { status: "AWAKE", battleId: null },
          },
        });
        expect(result.battleId).toBeUndefined();
        expect(await readRobber()).toMatchObject({
          status: "AWAKE",
          battleId: null,
          money: 500,
        });
        expect(await readVictim()).toMatchObject({
          status: "AWAKE",
          longitude: location.longitude + 1,
          money: 1000,
        });
        expect(await db.query.battle.findMany()).toEqual([]);
        expect(await db.query.battleHistory.findMany()).toEqual([]);
        await options.onSuccess(result, undefined, revision);
        expect(cache.getQueryData<typeof initial>(key)?.userData).toMatchObject({
          status: "AWAKE",
          battleId: null,
        });
        expect(read).not.toHaveBeenCalled();
        expect(toast).toHaveBeenCalledWith(result);
      } finally {
        stop();
        cache.clear();
      }
    },
  );
});

it.each(["AWAKE", "ASLEEP", "HOSPITALIZED"] as const)(
  "retains fractional robbery credits and faction counters through the actual %s output without a profile read",
  async (status) => {
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const key = [["profile", "getUser"], { type: "query" }];
    const initial = {
      userData: {
        userId: ROBBER,
        status,
        money: 500,
        villagePrestige: 20,
        clanId: "faction",
        clan: { id: "faction", points: 10, activityPoints: 12 },
        curHealth: 5,
      },
      notifications: [],
    };
    cache.setQueryData(key, initial);
    const read = vi.fn(async () => initial);
    const observer = new QueryObserver(cache, {
      queryKey: key,
      staleTime: Infinity,
      queryFn: read,
    });
    const unsubscribe = observer.subscribe(() => {});
    const output = (
      travelRouter.robPlayer._def as unknown as {
        output: ZodType<UserDeltaResponse & { money?: number; battleId?: string }>;
      }
    ).output;
    const response = output.parse({
      success: true,
      message: "Robbed",
      money: 800,
      ...getRobPlayerUserUpdate({
        user: { stealthActive: false, clanId: "faction" },
        stolenAmount: 300,
        prestigeGain: 5.75,
      }),
      ...(status !== "AWAKE"
        ? {
            userRecovery: {
              userId: ROBBER,
              userPatch: { status: "AWAKE", curHealth: 100 },
            },
          }
        : {}),
    });
    try {
      expect(
        await updateUserCache(cache, key, response, {
          revision: prepareUserUpdate(cache, key),
        }),
      ).toBe(true);
      expect(read).not.toHaveBeenCalled();
      expect(cache.getQueryData(key)).toMatchObject({
        userData: {
          status: "AWAKE",
          money: 800,
          villagePrestige: 25.75,
          clan: { id: "faction", points: 11, activityPoints: 13 },
        },
      });
      expect(response.money).toBe(800);
    } finally {
      unsubscribe();
      cache.clear();
    }
  },
);

it("retains canonical recovery for a robbery whose stealth roll can change the actor", async () => {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const key = [["profile", "getUser"], { type: "query" }];
  const initial = {
    userData: {
      userId: ROBBER,
      status: "AWAKE",
      money: 500,
      villagePrestige: 20,
      stealthActive: true,
    },
    notifications: [],
  };
  const canonical = {
    ...initial,
    userData: {
      ...initial.userData,
      money: 800,
      villagePrestige: 25.75,
      stealthActive: false,
    },
  };
  cache.setQueryData(key, initial);
  const read = vi.fn(async () => canonical);
  const observer = new QueryObserver(cache, {
    queryKey: key,
    staleTime: Infinity,
    queryFn: read,
  });
  const unsubscribe = observer.subscribe(() => {});
  const output = (
    travelRouter.robPlayer._def as unknown as { output: ZodType<UserDeltaResponse> }
  ).output;
  try {
    const response = output.parse({
      success: true,
      message: "Robbed",
      ...getRobPlayerUserUpdate({
        user: { stealthActive: true, clanId: null },
        stolenAmount: 300,
        prestigeGain: 5.75,
      }),
    });
    expect(
      await updateUserCache(cache, key, response, {
        revision: prepareUserUpdate(cache, key),
      }),
    ).toBe(false);
    expect(read).toHaveBeenCalledTimes(1);
    expect(cache.getQueryData(key)).toEqual(canonical);
  } finally {
    unsubscribe();
    cache.clear();
  }
});

it("preserves the battle projection when a failed robbery starts combat", () => {
  const output = (
    travelRouter.robPlayer._def as unknown as {
      output: ZodType<UserDeltaResponse & { battleId?: string }>;
    }
  ).output;
  const response = {
    success: false,
    message: "Prepare for combat",
    battleId: "rob-battle",
    userPatch: { status: "BATTLE" as const, battleId: "rob-battle" },
    userDelta: {},
    userRecovery: {
      userId: ROBBER,
      userPatch: { status: "AWAKE" as const, curHealth: 100 },
    },
  };
  expect(output.parse(response)).toEqual(response);
});
