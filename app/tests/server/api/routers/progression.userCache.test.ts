import type { UserUpdate, UserUpdateOptions } from "@/deltas/profile";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as Sentry from "@sentry/nextjs";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import {
  BLOODLINE_COST,
  ELEMENTAL_MASTERY_CAP,
  REMOVAL_COST,
} from "@/drizzle/constants";
import {
  bloodline,
  bloodlineRolls,
  gameSetting,
  notification,
  quest,
  questHistory,
  skillTree,
  userCookingJob,
  userData,
  userQueue,
  userSkill,
  userVote,
} from "@/drizzle/schema";
import { calcEnergy } from "@/libs/profile";
import { bloodlineRouter } from "@/server/api/routers/bloodline";
import { miscRouter } from "@/server/api/routers/misc";
import { fetchUpdatedUser, profileRouter } from "@/server/api/routers/profile";
import { skillTreeRouter } from "@/server/api/routers/skillTree";
import { trainRouter } from "@/server/api/routers/train";
import { prepareUserUpdate, updateUserCache } from "@/utils/userCache";
import { IncreaseMasteryTag, IncreaseMaxPoolsTag } from "@/validators/combat";
import { petSkillFixture } from "../../../libs/pets/helpers/abilities";
import { insertUsers, insertUserVotes } from "../../../setup/factories";
import { countUserReads } from "../../../setup/userReads";
import {
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  recordQueries,
  resetTables,
} from "../../../setup/testDatabase";

const userId = "progress-cache";
const effects = [
  IncreaseMasteryTag.parse({
    power: 50,
    calculation: "static",
    masteryTypes: ["Ninjutsu"],
  }),
  IncreaseMaxPoolsTag.parse({
    power: 100,
    calculation: "static",
    poolsAffected: ["Energy"],
  }),
];

describeWithDatabase("confirmed progression cache responses", () => {
  afterEach(() => vi.restoreAllMocks());
  beforeEach(async () => {
    await resetTables(
      bloodlineRolls,
      bloodline,
      notification,
      questHistory,
      quest,
      userCookingJob,
      userQueue,
      userSkill,
      skillTree,
      userVote,
      gameSetting,
      userData,
    );
    await insertUsers([
      {
        userId,
        username: "ProgressCache",
        role: "OWNER",
        rank: "JONIN",
        level: 50,
        primaryElement: "Fire",
        secondaryElement: "Water",
        status: "AWAKE",
        isOutlaw: true,
        regeneration: 20,
        ninjutsuMastery: 100,
        reputationPoints: 1000,
        seichiSilver: 200,
        skillPoints: 5,
        updatedAt: new Date(),
        regenAt: new Date(),
      },
    ]);
    const db = await getTestDatabase();
    await insertUserVotes([{ userId }]);
    await db.insert(bloodline).values({
      id: "cache-line",
      name: "Cache Line",
      rank: "D",
      image: "",
      description: "Cache fixture",
      regenIncrease: 7,
      effects,
    });
  });

  it("returns purchased lineage, the confirmed debit and passive changes", async () => {
    const db = await getTestDatabase();
    const counted = countUserReads(db);
    const result = await callerForDatabase(
      bloodlineRouter,
      userId,
      counted.client,
    ).purchaseBloodline({ bloodlineId: "cache-line" });
    expect(result.success).toBe(true);
    expect(result.userPatch).toMatchObject({
      bloodlineId: "cache-line",
      bloodline: { id: "cache-line" },
      bloodlineReskinId: null,
      activeReskin: null,
      bloodright: [],
      bloodrightSpent: 0,
      regeneration: 27,
      regenerationWithoutTimedBuffs: 27,
      maxEnergy: calcEnergy(50) + 100,
      effectiveMasteries: { ninjutsuMastery: 150 },
    });
    expect(result.userPatch?.updatedAt).toBeInstanceOf(Date);
    expect(result.userDelta).toEqual({ reputationPoints: -BLOODLINE_COST.D });
    expect(counted.getReads()).toBe(1);
  });

  it.each([false, true])(
    "returns the saved Bloodright refund and correct removal charge (natural=%s)",
    async (natural) => {
      const db = await getTestDatabase();
      await db
        .update(userData)
        .set({
          bloodlineId: "cache-line",
          bloodright: [{ skillId: "old-tier", cost: 77 }],
          bloodrightSpent: 77,
        })
        .where(eq(userData.userId, userId));
      if (natural)
        await db.insert(bloodlineRolls).values({
          id: "natural-line",
          userId,
          bloodlineId: "cache-line",
          type: "NATURAL",
        });
      const result = await callerForDatabase(
        bloodlineRouter,
        userId,
        db,
      ).removeBloodline();
      expect(result.success).toBe(true);
      expect(result.userPatch).toBeUndefined();
      expect(result.userDelta).toBeUndefined();
      expect(
        await db.query.userData.findFirst({ where: eq(userData.userId, userId) }),
      ).toMatchObject({
        bloodlineId: null,
        seichiSilver: 277,
        bloodright: [],
        bloodrightSpent: 0,
        reputationPoints: 1000 - (natural ? 0 : REMOVAL_COST),
      });
    },
  );

  it("publishes activated skills and derived pool/mastery values without spending skill points", async () => {
    const db = await getTestDatabase();
    await db.insert(skillTree).values(petSkillFixture({ id: "cache-skill", effects }));
    // Hydrate any first-login bookkeeping before isolating the activation response.
    await fetchUpdatedUser({ client: db, userId });
    const counted = countUserReads(db);
    const result = await callerForDatabase(
      skillTreeRouter,
      userId,
      counted.client,
    ).purchaseSkill({ skillId: "cache-skill" });
    expect(result.success).toBe(true);
    expect(result.userPatch?.userSkills).toEqual([
      expect.objectContaining({ skillId: "cache-skill", activated: true }),
    ]);
    expect(result.userPatch?.maxEnergy).toBe(calcEnergy(50) + 100);
    expect(counted.getReads()).toBe(1);
    expect(result.userPatch?.effectiveMasteries?.ninjutsuMastery).toBe(150);
    expect(
      (await db.query.userData.findFirst({ where: eq(userData.userId, userId) }))
        ?.skillPoints,
    ).toBe(5);
  });

  it.each([
    "timed hydration failure",
    "later timed kind failure",
    "Cooking hydration failure",
    "successful Cooking hydration",
  ] as const)("reconciles skill activation after %s", async (scenario) => {
    const db = await getTestDatabase();
    const cooking = scenario.includes("Cooking");
    const succeeds = scenario === "successful Cooking hydration";
    const future = new Date(Date.now() + 60_000);
    const past = new Date(Date.now() - 60_000);
    await db.insert(skillTree).values(petSkillFixture({ id: "cache-skill", effects }));
    if (cooking) {
      await db
        .insert(userCookingJob)
        .values({ id: "skill-cooking", userId, experience: 30, finishesAt: future });
    } else {
      await db.insert(userQueue).values({
        id: "skill-jutsu",
        userId,
        kind: "JUTSU",
        position: 1,
        jutsuId: "unavailable-jutsu",
        reservedRyo: 100,
        durationSeconds: 60,
        startsAt: future,
        finishesAt: future,
      });
      if (scenario === "later timed kind failure") {
        await db.insert(userQueue).values({
          id: "skill-craft",
          userId,
          kind: "CRAFT",
          position: 1,
          itemId: "unavailable-item",
          quantity: 1,
          materials: [],
          durationSeconds: 60,
          startsAt: future,
          finishesAt: future,
        });
      }
    }
    const profile = callerForDatabase(profileRouter, userId, db);
    const initial = await profile.getUser();
    if (cooking)
      await db
        .update(userCookingJob)
        .set({ finishesAt: past })
        .where(eq(userCookingJob.userId, userId));
    else
      await db
        .update(userQueue)
        .set({ startsAt: past, finishesAt: past })
        .where(eq(userQueue.userId, userId));

    const error = new Error("Settlement follow-up read unavailable");
    const readProfile = db.query.userData.findFirst.bind(db.query.userData);
    let profileReads = 0;
    vi.spyOn(db.query.userData, "findFirst").mockImplementation(((
      config: Parameters<typeof readProfile>[0],
    ) => {
      if (
        config?.with?.attributes &&
        ++profileReads === 2 &&
        scenario.endsWith("hydration failure")
      )
        throw error;
      return readProfile(config);
    }) as never);
    const readQueue = db.query.userQueue.findMany.bind(db.query.userQueue);
    let failedCraft = false;
    vi.spyOn(db.query.userQueue, "findMany").mockImplementation(((
      config: Parameters<typeof readQueue>[0],
    ) => {
      if (
        config?.with?.item &&
        scenario === "later timed kind failure" &&
        !failedCraft
      ) {
        failedCraft = true;
        throw error;
      }
      return readQueue(config);
    }) as never);
    const warning = vi
      .spyOn(Sentry, "captureException")
      .mockReturnValue("warning-event");

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const key = ["skill-settlement-profile"];
    const getUser = vi.fn(() => profile.getUser());
    client.setQueryData(key, initial);
    const observer = new QueryObserver(client, {
      queryKey: key,
      queryFn: getUser,
      staleTime: Infinity,
    });
    const unsubscribe = observer.subscribe(() => {});
    try {
      // Execute the Skills tab's mutation callbacks with the real cache merger.
      const source = readFileSync(
        join(import.meta.dirname, "../../../../src/layout/StrengthWeaknesses.tsx"),
        "utf8",
      );
      const call = source.indexOf("api.skillTree.purchaseSkill.useMutation(");
      const callbacks = source
        .slice(call)
        .match(/useMutation\((\{[\s\S]*?\n    \})\);/)?.[1];
      if (!callbacks) throw new Error("Skill purchase callbacks were not found");
      const invalidate = vi.fn(async () => {});
      const leaf = { invalidate };
      const utils = {
        skillTree: { getUserSkills: leaf, getAll: leaf, getFolderStats: leaf },
      };
      const updateUser = (update: UserUpdate | undefined, options: UserUpdateOptions) =>
        updateUserCache(client, key, update, options);
      const options = new Function(
        "prepareUserUpdate",
        "updateUser",
        "showMutationToast",
        "utils",
        `return (${callbacks});`,
      )(() => prepareUserUpdate(client, key), updateUser, vi.fn(), utils) as {
        onMutate: () => number | undefined;
        onSuccess: (
          data: unknown,
          input: unknown,
          revision: number | undefined,
        ) => Promise<void>;
      };
      const revision = options.onMutate();
      expect(revision).toBeDefined();
      const result = await callerForDatabase(skillTreeRouter, userId, db).purchaseSkill(
        { skillId: "cache-skill" },
      );
      expect(result.success).toBe(true);
      expect(result.userPatch).toEqual(succeeds ? expect.anything() : undefined);
      if (!succeeds) {
        expect(warning).toHaveBeenCalledWith(error, {
          level: "warning",
          tags: {
            source: cooking ? "settleCookingExperience" : "settleUserQueues",
          },
        });
      }
      // The first timed kind commits independently of the following kind or hydration.
      const saved = await db.query.userData.findFirst({
        where: eq(userData.userId, userId),
      });
      expect(saved?.cookingExperience).toBe(cooking ? 30 : 0);
      expect(saved?.money).toBe(initial.userData!.money + (cooking ? 0 : 100));
      expect(await db.query.userCookingJob.findMany()).toEqual([]);
      expect((await db.query.userQueue.findMany()).map((row) => row.id)).toEqual(
        failedCraft ? ["skill-craft"] : [],
      );
      await options.onSuccess(result, { skillId: "cache-skill" }, revision);
      expect(getUser).toHaveBeenCalledTimes(succeeds ? 0 : 1);
      const cached = client.getQueryData<typeof initial>(key)?.userData;
      expect(cached?.cookingExperience).toBe(saved?.cookingExperience);
      expect(cached?.money).toBe(saved?.money);
      expect(cached?.queue).toEqual([]);
      expect(cached?.cookingJobs).toEqual([]);
      expect(cached?.userSkills).toEqual([
        expect.objectContaining({ skillId: "cache-skill", activated: true }),
      ]);
    } finally {
      unsubscribe();
      client.clear();
    }
  });

  it("keeps a completed global skill reset canonical for concurrent skill sources", async () => {
    const db = await getTestDatabase();
    await db.insert(skillTree).values(petSkillFixture({ id: "reset-skill", effects }));
    await db
      .insert(userSkill)
      .values({ id: "reset-entry", userId, skillId: "reset-skill", activated: true });
    await fetchUpdatedUser({ client: db, userId });
    const result = await callerForDatabase(
      skillTreeRouter,
      userId,
      db,
    ).resetAllUsersSkillPoints();
    expect(result.success).toBe(true);
    expect(result.userPatch).toBeUndefined();
    expect(result.userDelta).toBeUndefined();
    expect(await db.query.userSkill.findMany()).toEqual([]);
  });

  it("publishes only the accepted elemental selection", async () => {
    const db = await getTestDatabase();
    await db
      .update(userData)
      .set({ elementalMastery: { Earth: ELEMENTAL_MASTERY_CAP } })
      .where(eq(userData.userId, userId));
    const caller = callerForDatabase(trainRouter, userId, db);
    const accepted = await caller.selectTrainedElement({ element: "Earth" });
    expect(accepted).toMatchObject({
      success: true,
      userPatch: { activeTrainedElement: "Earth" },
    });
    const rejected = await caller.selectTrainedElement({ element: "Wind" });
    expect(rejected.success).toBe(false);
    expect(rejected.userPatch).toBeUndefined();
  });

  it("returns active global boost navigation and recalculated regeneration", async () => {
    const db = await getTestDatabase();
    const result = await callerForDatabase(miscRouter, userId, db).setEventGameSetting({
      setting: "regenGainMultiplier",
      multiplier: "2",
      days: 1,
    });
    expect(result).toMatchObject({
      success: true,
      userPatch: { regeneration: 40, regenerationWithoutTimedBuffs: 40 },
      userNotifications: {
        globalBoost: {
          setting: "regenGainMultiplier",
          notice: { href: "/profile", color: "green", group: "Active boosts" },
        },
      },
    });
    expect(result.userNotifications?.globalBoost?.notice?.name).toContain("2X regen");
    const disabled = await callerForDatabase(
      miscRouter,
      userId,
      db,
    ).setEventGameSetting({ setting: "regenGainMultiplier", multiplier: "2", days: 0 });
    expect(disabled).toMatchObject({
      success: true,
      userPatch: { regeneration: 20 },
      userNotifications: {
        globalBoost: { setting: "regenGainMultiplier", notice: null },
      },
    });
  });

  it.each([
    ["trainingGainMultiplier", "/traininggrounds", "gains"],
    ["battleExpMultiplier", "/battlearena", "battle exp"],
    ["missionExpMultiplier", "/missionhall", "mission exp"],
    ["jutsuExpMultiplier", "/jutsus", "jutsu exp"],
    ["itemExpMultiplier", "/items", "item exp"],
  ] as const)(
    "updates %s without reading regeneration settings",
    async (setting, href, label) => {
      const db = await getTestDatabase();
      const counted = countUserReads(db);
      const { result, statements } = await recordQueries(() =>
        callerForDatabase(miscRouter, userId, counted.client).setEventGameSetting({
          setting,
          multiplier: "2",
          days: 1,
        }),
      );
      expect(result).toMatchObject({
        success: true,
        userPatch: {},
        userNotifications: {
          globalBoost: {
            setting,
            notice: { href, color: "green", group: "Active boosts" },
          },
        },
      });
      expect(result.userNotifications?.globalBoost?.notice?.name).toContain(
        `2X ${label}`,
      );
      expect(counted.getReads()).toBe(1);
      const settingsReads = statements.filter(
        (statement) =>
          /^select\b/i.test(statement) && /\bfrom `GameSetting`/i.test(statement),
      );
      expect(settingsReads).toHaveLength(1);
      expect(settingsReads[0]).toMatch(/\bwhere\b/i);
      expect(
        await db.query.gameSetting.findFirst({ where: eq(gameSetting.name, setting) }),
      ).toMatchObject({ value: 2 });
    },
  );

  it("publishes announcements without delivering the actor receipt inside the mutation", async () => {
    const db = await getTestDatabase();
    await insertUsers([{ userId: "other-reader", username: "OtherReader" }]);
    const counted = countUserReads(db);
    const { result, statements } = await recordQueries(() =>
      callerForDatabase(miscRouter, userId, counted.client).submitNotification({
        content: "A committed announcement",
        senderId: userId,
      }),
    );
    expect(result.success).toBe(true);
    expect(result.userPatch).toBeUndefined();
    expect(result.announcements).toBeUndefined();
    expect(counted.getReads()).toBe(1);
    const lastWrite = statements.reduce(
      (last, statement, index) =>
        /^\s*(update|insert|delete)/i.test(statement) ? index : last,
      -1,
    );
    expect(
      statements
        .slice(lastWrite + 1)
        .some((statement) => /^\s*select/i.test(statement)),
    ).toBe(false);
    expect(await db.query.notification.findMany()).toHaveLength(1);
    expect(
      await db.query.userData.findFirst({ where: eq(userData.userId, userId) }),
    ).toMatchObject({ unreadNotifications: 1 });
    expect(
      (await callerForDatabase(profileRouter, userId, db).getUser()).notifications,
    ).toContainEqual(
      expect.objectContaining({ name: "A committed announcement", color: "toast" }),
    );
    expect(
      await db.query.userData.findFirst({ where: eq(userData.userId, userId) }),
    ).toMatchObject({ unreadNotifications: 0 });
    expect(
      (
        await db.query.userData.findFirst({
          where: eq(userData.userId, "other-reader"),
        })
      )?.unreadNotifications,
    ).toBe(1);
    expect(
      (await callerForDatabase(profileRouter, userId, db).getUser()).notifications.some(
        (entry) => entry.name === "A committed announcement",
      ),
    ).toBe(false);
  });

  it("reads and validates a distinct announcement sender before publishing", async () => {
    const db = await getTestDatabase();
    await insertUsers([
      { userId: "announcement-ai", username: "AnnouncementAi", isAi: true },
    ]);
    const counted = countUserReads(db);
    const result = await callerForDatabase(
      miscRouter,
      userId,
      counted.client,
    ).submitNotification({
      content: "A message from an AI",
      senderId: "announcement-ai",
    });
    expect(result.success).toBe(true);
    expect(counted.getReads()).toBe(2);
    expect(await db.query.notification.findFirst()).toMatchObject({
      userId: "announcement-ai",
      content: "A message from an AI",
    });
  });
});
