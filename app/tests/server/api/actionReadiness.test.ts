import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import { HOSPITAL_BASE_HEAL_SECONDS } from "@/drizzle/constants";
import {
  quest,
  questHistory,
  userData,
  village,
  villageStructure,
} from "@/drizzle/schema";
import { AUTO_CHECKOUT_MESSAGE, AUTO_WAKE_MESSAGE } from "@/libs/actionReadiness";
import { Pusher } from "@/libs/pusher";
import { fetchActionUser } from "@/queries/actionReadiness";
import { appRouter } from "@/server/api/root";
import { createTRPCRouter, errorResponse, protectedProcedure } from "@/server/api/trpc";
import {
  actionReadinessResponse,
  prepareActionReadiness,
} from "@/server/utils/actionReadiness";
import { claimUserSnapshot } from "@/server/utils/concurrency";
import { insertQuests, insertUsers } from "../../setup/factories";
import { resetServerModuleStubs, stubProfile } from "../../setup/serverModules";
import { beforeStatements } from "../../setup/statements";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";

// A resolver composes recovery into its own read and account-claim phases.
// The protected procedure itself does not load or change character readiness.
let invocations = 0;
const router = createTRPCRouter({
  train: createTRPCRouter({
    startTraining: protectedProcedure.mutation(async ({ ctx }) => {
      const initial = await fetchActionUser(ctx.drizzle, ctx.userId);
      if (!initial) return errorResponse("User not found");
      const readiness = prepareActionReadiness(initial, []);
      if (readiness.error) return errorResponse(readiness.error);
      const claim = await claimUserSnapshot({
        client: ctx.drizzle,
        userId: ctx.userId,
        updatedAt: initial.updatedAt,
        readiness,
      });
      if (!claim.success)
        return errorResponse("Your status changed. Please try again.");
      invocations++;
      return actionReadinessResponse({ success: true, message: "Trained" }, readiness);
    }),
  }),
});
const userId = "action-readiness";
const current = async () =>
  (await (
    await getTestDatabase()
  ).query.userData.findFirst({ where: eq(userData.userId, userId) }))!;

afterEach(() => {
  invocations = 0;
  resetServerModuleStubs();
  vi.restoreAllMocks();
});

describeWithDatabase("automatic action recovery", () => {
  const setup = async (
    status: "ASLEEP" | "HOSPITALIZED",
    values: Record<string, unknown> = {},
  ) => {
    await resetTables(userData, villageStructure, village);
    await insertUsers([
      {
        userId,
        username: userId,
        status,
        villageId: "village",
        curHealth: 10,
        maxHealth: 100,
        money: 1234,
        ...values,
      },
    ]);
    await (await getTestDatabase())
      .insert(village)
      .values({ id: "village", name: "Village", sector: 0, kageId: "" });
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    // Isolate the transition's SQL, with the shared hydrated snapshot controlled at the
    // boundary. Profile regeneration itself is exercised by the arena and hospital suites.
    stubProfile("fetchUpdatedUser", async () => ({ user: await current() }) as never);
    return callerForDatabase(router, userId, await getTestDatabase());
  };
  it("wakes with the default preference in the endpoint account claim", async () => {
    const caller = await setup("ASLEEP");
    expect((await current()).autoWakeUp).toBe(true);
    expect(await caller.train.startTraining()).toMatchObject({
      success: true,
      message: `Trained ${AUTO_WAKE_MESSAGE}`,
      actionNotice: AUTO_WAKE_MESSAGE,
    });
    expect(invocations).toBe(1);
    expect((await current()).status).toBe("AWAKE");
  });
  it("respects an explicit opt-out", async () => {
    const caller = await setup("ASLEEP", { autoWakeUp: false });
    expect(await caller.train.startTraining()).toMatchObject({
      success: false,
      message: expect.stringContaining("asleep"),
    });
    expect(invocations).toBe(0);
    expect((await current()).status).toBe("ASLEEP");
  });
  it.each(["deadline", "full health", "village boost"])(
    "checks out for free by %s",
    async (reason) => {
      const caller = await setup("HOSPITALIZED", {
        autoWakeUp: false,
        warTornRespawn: true,
        regenAt: new Date(
          Date.now() -
            (reason === "deadline" ? HOSPITAL_BASE_HEAL_SECONDS + 5 : 1) * 1000,
        ),
        curHealth: reason === "full health" ? 100 : 10,
      });
      if (reason === "village boost")
        await (await getTestDatabase()).insert(villageStructure).values({
          id: "hospital",
          name: "Hospital",
          image: "/hospital.png",
          villageId: "village",
          level: 100,
          hospitalSpeedupPerLvl: 1,
        });
      expect(await caller.train.startTraining()).toMatchObject({
        success: true,
        actionNotice: AUTO_CHECKOUT_MESSAGE,
        userRecovery: {
          activity: { status: "AWAKE" },
          userPatch: { warTornRespawn: false },
        },
      });
      expect(invocations).toBe(1);
      expect(await current()).toMatchObject({
        status: "AWAKE",
        warTornRespawn: false,
        money: 1234,
        curHealth: 100,
      });
    },
  );
  it("offers hospital recovery without charging when checkout is still paid", async () => {
    const caller = await setup("HOSPITALIZED", { regenAt: new Date() });
    expect(await caller.train.startTraining()).toMatchObject({
      success: false,
      message: expect.stringContaining("in the hospital"),
    });
    expect(invocations).toBe(0);
    expect(await current()).toMatchObject({
      status: "HOSPITALIZED",
      money: 1234,
      curHealth: 10,
    });
  });
  it.each(["ASLEEP", "HOSPITALIZED"] as const)(
    "does not overwrite a concurrent battle from %s",
    async (status) => {
      await setup(status, { regenAt: new Date(0) });
      const database = await getTestDatabase();
      const client = beforeStatements(database, userData, [
        async () => {
          await database
            .update(userData)
            .set({ status: "BATTLE" })
            .where(eq(userData.userId, userId));
        },
      ]);
      expect(
        await callerForDatabase(router, userId, client).train.startTraining(),
      ).toMatchObject({ success: false });
      expect(invocations).toBe(0);
      expect((await current()).status).toBe("BATTLE");
    },
  );
});

describeWithDatabase("specific quest action recovery", () => {
  beforeEach(async () => {
    await resetTables(questHistory, quest, villageStructure, village, userData);
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    await insertUsers([
      {
        userId,
        username: userId,
        rank: "JONIN",
        level: 50,
        status: "ASLEEP",
        regeneration: 0,
        primaryElement: "Fire",
        secondaryElement: "Water",
        villageId: "home",
        sector: 0,
      },
    ]);
    const database = await getTestDatabase();
    await database
      .insert(village)
      .values({ id: "home", name: "Home", sector: 0, kageId: userId });
    await database.insert(villageStructure).values([
      {
        id: "hq",
        villageId: "home",
        name: "Global ANBU HQ",
        route: "/globalanbuhq",
        image: "",
      },
      {
        id: "mission",
        villageId: "home",
        name: "Mission Hall",
        route: "/missionhall",
        image: "",
      },
    ]);
    await insertQuests([
      {
        id: "specific",
        name: "Specific quest",
        questType: "story",
        hidden: false,
        questRank: "D",
      },
    ]);
  });
  it.each([
    { status: "ASLEEP", autoWakeUp: true },
    { status: "ASLEEP", autoWakeUp: false },
    { status: "HOSPITALIZED", autoWakeUp: true },
  ] as const)(
    "preserves ordinary story eligibility and activity: %j",
    async (initial) => {
      const database = await getTestDatabase();
      await database
        .update(userData)
        .set({ ...initial, curHealth: 1, maxHealth: 100, regenAt: new Date() })
        .where(eq(userData.userId, userId));
      const questReads = vi.spyOn(database.query.quest, "findFirst");
      const result = await (await callerFor(appRouter, userId)).quests.startQuest({
        questId: "specific",
        userSector: 0,
      });
      expect(result.success).toBe(true);
      expect(result).not.toHaveProperty("actionNotice");
      expect((await current()).status).toBe(initial.status);
      expect(questReads).toHaveBeenCalledTimes(1);
    },
  );
  it.each(["mission", "battlepyramid"] as const)(
    "recovers an awake-only %s start using its saved quest type",
    async (questType) => {
      await (await getTestDatabase())
        .update(quest)
        .set({ questType, questRank: "A" })
        .where(eq(quest.id, "specific"));
      const result = await (await callerFor(appRouter, userId)).quests.startQuest({
        questId: "specific",
        userSector: 0,
      });
      expect(result).toMatchObject({ success: true, actionNotice: AUTO_WAKE_MESSAGE });
      expect((await current()).status).toBe("AWAKE");
    },
  );
  it("rejects an awake-only quest when the sleeper opts out", async () => {
    const database = await getTestDatabase();
    await database
      .update(quest)
      .set({ questType: "mission" })
      .where(eq(quest.id, "specific"));
    await database
      .update(userData)
      .set({ autoWakeUp: false })
      .where(eq(userData.userId, userId));
    expect(
      await (await callerFor(appRouter, userId)).quests.startQuest({
        questId: "specific",
        userSector: 0,
      }),
    ).toMatchObject({ success: false, message: expect.stringContaining("asleep") });
    expect(await database.query.questHistory.findMany()).toHaveLength(0);
    expect((await current()).status).toBe("ASLEEP");
  });
});
