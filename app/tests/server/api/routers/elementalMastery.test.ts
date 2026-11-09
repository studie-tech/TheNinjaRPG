import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import {
  type BasicElement,
  ELEMENTAL_MASTERY_CAP,
  MAX_DAILY_TRAININGS,
} from "@/drizzle/constants";
import {
  bloodline,
  captcha,
  gameSetting,
  trainingLog,
  userData,
  userQueue,
  userVote,
} from "@/drizzle/schema";
import { getUserElements } from "@/libs/elementalMastery";
import { masteryTotal } from "@/libs/masteryProgression";
import { getMasteryQueue } from "@/libs/queue";
import { fetchUpdatedUser, profileRouter } from "@/server/api/routers/profile";
import { trainRouter } from "@/server/api/routers/train";
import { IncreaseDamageGivenTag } from "@/validators/combat";
import { insertUsers, insertUserVotes } from "../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

const ID = "elemental-trainee";
const api = () => callerFor(trainRouter, ID);
const assign = async (element: BasicElement, amount: number) =>
  (await callerFor(profileRouter, ID)).useUnusedExperiencePoints({ [element]: amount });
const readUser = async () =>
  (
    await (
      await getTestDatabase()
    )
      .select()
      .from(userData)
      .where(eq(userData.userId, ID))
  )[0]!;
const patch = async (data: Partial<typeof userData.$inferInsert>) =>
  (await getTestDatabase()).update(userData).set(data).where(eq(userData.userId, ID));
const session = async () => ({
  stat: "Wind" as const,
  startedAt: (await readUser()).elementalTrainingStartedAt!,
});

describeWithDatabase("elemental mastery guarded progression", () => {
  beforeEach(async () => {
    await resetTables(
      userData,
      userQueue,
      userVote,
      trainingLog,
      bloodline,
      gameSetting,
      captcha,
    );
    await insertUsers([
      {
        userId: ID,
        username: ID,
        rank: "JONIN",
        status: "AWAKE",
        isOutlaw: true,
        primaryElement: "Fire",
        secondaryElement: "Water",
        earnedExperience: 600_000,
        trainingSpeed: "1hr",
        elementalTrainingSpeed: "1hr",
      },
    ]);
    await insertUserVotes([{ userId: ID }]);
  });

  it("rejects innate, bloodline-provided and capped elements without spending XP", async () => {
    const caller = await api();
    expect((await caller.startMasteryTraining({ stat: "Fire" })).success).toBe(false);
    expect((await assign("Water", 100)).success).toBe(false);
    await (await getTestDatabase()).insert(bloodline).values({
      id: "wind-line",
      name: "Wind Line",
      image: "/test.png",
      rank: "C",
      description: "test",
      effects: [IncreaseDamageGivenTag.parse({ elements: ["Wind"] })],
    });
    await patch({
      bloodlineId: "wind-line",
      elementalMastery: { Earth: ELEMENTAL_MASTERY_CAP },
    });
    expect((await caller.startMasteryTraining({ stat: "Wind" })).success).toBe(false);
    expect((await assign("Wind", 100)).success).toBe(false);
    expect((await assign("Earth", 100)).success).toBe(false);
    expect((await readUser()).earnedExperience).toBe(600_000);
  });

  it("invests independently, unlocks only at cap and selects one active element", async () => {
    const caller = await api();
    const before = await readUser();
    expect((await assign("Wind", 100)).success).toBe(true);
    expect((await caller.selectTrainedElement({ element: "Wind" })).success).toBe(
      false,
    );
    expect(getUserElements((await readUser()) as never)).not.toContain("Wind");
    expect((await assign("Wind", ELEMENTAL_MASTERY_CAP)).success).toBe(true);
    expect((await assign("Earth", ELEMENTAL_MASTERY_CAP)).success).toBe(true);
    expect((await caller.selectTrainedElement({ element: "Wind" })).success).toBe(true);
    expect(getUserElements((await readUser()) as never)).toContain("Wind");
    expect((await caller.selectTrainedElement({ element: "Earth" })).success).toBe(
      true,
    );
    const after = await readUser();
    expect(getUserElements(after as never)).toEqual(["Fire", "Water", "Earth", "None"]);
    expect(after.elementalMastery).toEqual({
      Wind: ELEMENTAL_MASTERY_CAP,
      Earth: ELEMENTAL_MASTERY_CAP,
    });
    expect(after.earnedExperience).toBe(0);
    expect(after.experience).toBe(before.experience);
    expect(masteryTotal(after)).toBe(masteryTotal(before));
  });

  it.each([["Wind"], ["Wind", "Earth"]] satisfies BasicElement[][])(
    "trains overridden innate elements with bloodline %j",
    async (...elements) => {
      const effects = [IncreaseDamageGivenTag.parse({ elements })];
      await (await getTestDatabase()).insert(bloodline).values({
        id: "override-line",
        name: "Override Line",
        image: "/test.png",
        rank: "C",
        description: "test",
        effects,
      });
      await patch({ bloodlineId: "override-line" });
      const caller = await api();
      expect((await caller.startMasteryTraining({ stat: "Fire" })).success).toBe(true);
      const startedAt = new Date(Date.now() - 1_800_000);
      await patch({ elementalTrainingStartedAt: startedAt });
      expect(
        (await caller.stopMasteryTraining({ stat: "Fire", startedAt })).success,
      ).toBe(true);
      expect((await readUser()).elementalMastery.Fire).toBeGreaterThan(0);
      expect((await assign("Water", ELEMENTAL_MASTERY_CAP)).success).toBe(true);
      expect((await caller.selectTrainedElement({ element: "Water" })).success).toBe(
        true,
      );
      expect(
        getUserElements({ ...(await readUser()), bloodline: { effects } } as never),
      ).toEqual([...elements, "Water", "None"]);
      expect((await caller.startMasteryTraining({ stat: "Wind" })).success).toBe(false);
      await patch({ bloodlineId: null });
      expect((await caller.selectTrainedElement({ element: "Water" })).success).toBe(
        false,
      );
      expect((await readUser()).elementalMastery.Water).toBe(ELEMENTAL_MASTERY_CAP);
    },
  );

  it("finishes a fractional timed balance with one whole unused XP point", async () => {
    await patch({ elementalMastery: { Wind: ELEMENTAL_MASTERY_CAP - 0.5 } });
    expect((await assign("Wind", 1)).success).toBe(true);
    const user = await readUser();
    expect(user.elementalMastery.Wind).toBe(ELEMENTAL_MASTERY_CAP);
    expect(user.earnedExperience).toBe(599_999);
  });

  it("guards concurrent XP spending and rejects overspending", async () => {
    await patch({ earnedExperience: 100 });
    expect((await assign("Wind", 101)).success).toBe(false);
    const results = await Promise.all([assign("Wind", 100), assign("Earth", 100)]);
    expect(results.filter((result) => result.success)).toHaveLength(1);
    const user = await readUser();
    expect(user.earnedExperience).toBe(0);
    expect(
      Object.values(user.elementalMastery).reduce((sum, value) => sum + value, 0),
    ).toBe(100);
  });

  it("caps timed collection, freezes speed and prevents replay/concurrent collection", async () => {
    await patch({ elementalMastery: { Wind: ELEMENTAL_MASTERY_CAP - 5 } });
    const caller = await api();
    expect((await caller.startMasteryTraining({ stat: "Wind" })).success).toBe(true);
    expect((await caller.startMasteryTraining({ stat: "Earth" })).success).toBe(false);
    const startedAt = new Date(Date.now() - 1_800_000);
    await patch({ elementalTrainingStartedAt: startedAt });
    const before = await readUser();
    const results = await Promise.all([
      caller.stopMasteryTraining({ stat: "Wind", startedAt }),
      caller.stopMasteryTraining({ stat: "Wind", startedAt }),
    ]);
    expect(results.filter((result) => result.success)).toHaveLength(1);
    const after = await readUser();
    expect(after.elementalMastery.Wind).toBe(ELEMENTAL_MASTERY_CAP);
    expect(after.experience).toBe(before.experience);
    expect(after.dailyTrainings).toBe(before.dailyTrainings + 1);
    expect(after.currentlyTrainingElement).toBeNull();
    expect(
      (await caller.stopMasteryTraining({ stat: "Wind", startedAt })).success,
    ).toBe(false);
    const logs = await (await getTestDatabase())
      .select()
      .from(trainingLog)
      .where(eq(trainingLog.userId, ID));
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ amount: 5, speed: "1hr", stat: "Wind" });
  });

  it("keeps the active interval fixed while another interval is requested", async () => {
    const caller = await api();
    await caller.updateTrainingSpeed({ speed: "15min" });
    await caller.startMasteryTraining({ stat: "Wind", speed: "15min" });
    expect((await caller.updateTrainingSpeed({ speed: "24hrs" })).success).toBe(true);
    expect((await readUser()).elementalTrainingSpeed).toBe("15min");
    await patch({ elementalTrainingStartedAt: new Date(Date.now() - 840_000) });
    expect((await caller.stopMasteryTraining(await session())).success).toBe(true);
    const user = await readUser();
    expect(user.elementalMastery.Wind).toBeGreaterThan(0);
    expect(user.elementalMastery.Wind).toBeLessThan(1000);
  });

  it.each([
    { progress: ELEMENTAL_MASTERY_CAP - 5, primaryElement: "Fire", gained: 5 },
    { progress: ELEMENTAL_MASTERY_CAP + 10, primaryElement: "Fire", gained: 0 },
    { progress: 100, primaryElement: "Wind", gained: 0 },
  ] as const)(
    "automatically settles a final elemental session without waiting rows %j",
    async ({ progress, primaryElement, gained }) => {
      await patch({
        status: "ASLEEP",
        primaryElement,
        elementalMastery: { Wind: progress },
        currentlyTrainingElement: "Wind",
        elementalTrainingStartedAt: new Date(Date.now() - 3_601_000),
      });
      const before = await readUser();
      const client = await getTestDatabase();
      const { user } = await fetchUpdatedUser({ client, userId: ID });
      expect(user!.elementalMastery.Wind).toBe(progress + gained);
      expect(user!.currentlyTrainingElement).toBeNull();
      expect(user!.elementalTrainingStartedAt).toBeNull();
      expect(user!.dailyTrainings).toBe(before.dailyTrainings + (gained > 0 ? 1 : 0));
      expect(user!.experience).toBe(before.experience);
      expect(await readUser()).toMatchObject({
        elementalMastery: user!.elementalMastery,
        currentlyTrainingElement: null,
        elementalTrainingStartedAt: null,
        dailyTrainings: user!.dailyTrainings,
      });
      await fetchUpdatedUser({ client, userId: ID });
      const logs = await client
        .select()
        .from(trainingLog)
        .where(eq(trainingLog.userId, ID));
      expect(logs.map((log) => [log.stat, log.amount])).toEqual(
        gained > 0 ? [["Wind", gained]] : [],
      );
      expect((await readUser()).dailyTrainings).toBe(user!.dailyTrainings);
    },
  );

  it("retains progress after a bloodline swap but suppresses duplicate activation", async () => {
    const caller = await api();
    await patch({
      elementalMastery: { Wind: ELEMENTAL_MASTERY_CAP, Earth: ELEMENTAL_MASTERY_CAP },
      activeTrainedElement: "Wind",
    });
    const effects = [IncreaseDamageGivenTag.parse({ elements: ["Wind"] })];
    await (await getTestDatabase()).insert(bloodline).values({
      id: "wind-line",
      name: "Wind Line",
      image: "/test.png",
      rank: "C",
      description: "test",
      effects,
    });
    await patch({ bloodlineId: "wind-line" });
    expect((await caller.selectTrainedElement({ element: "Wind" })).success).toBe(
      false,
    );
    expect((await caller.selectTrainedElement({ element: "Earth" })).success).toBe(
      true,
    );
    expect((await readUser()).elementalMastery.Wind).toBe(ELEMENTAL_MASTERY_CAP);
    const publicElements = getUserElements({
      ...(await readUser()),
      bloodline: { effects },
    } as never);
    expect(publicElements.filter((element) => element === "Wind")).toHaveLength(1);
    expect(publicElements).toContain("Earth");
  });

  it("cannot cash out newly provided elements and can cancel their old session", async () => {
    const caller = await api();
    await caller.startMasteryTraining({ stat: "Wind" });
    await patch({
      primaryElement: "Wind",
      elementalTrainingStartedAt: new Date(Date.now() - 1_800_000),
    });
    expect((await caller.stopMasteryTraining(await session())).success).toBe(true);
    expect((await readUser()).elementalMastery.Wind ?? 0).toBe(0);
    expect((await readUser()).currentlyTrainingElement).toBeNull();
  });

  it("enforces awake, banned interval and daily training limits", async () => {
    const caller = await api();
    await patch({ status: "ASLEEP", autoWakeUp: false });
    expect((await caller.startMasteryTraining({ stat: "Wind" })).success).toBe(false);
    expect((await assign("Wind", 1)).success).toBe(false);
    expect((await caller.selectTrainedElement({ element: null })).success).toBe(false);
    await patch({ status: "AWAKE", isBanned: true });
    expect((await caller.startMasteryTraining({ stat: "Wind" })).success).toBe(false);
    await patch({ isBanned: false, dailyTrainings: MAX_DAILY_TRAININGS });
    expect((await caller.startMasteryTraining({ stat: "Wind" })).success).toBe(false);
  });
  it("runs both queues offline with independent speeds and rejects stale or mixed edits", async () => {
    const caller = await api();
    await patch({
      federalStatus: "SILVER",
      elementalMastery: {
        Wind: ELEMENTAL_MASTERY_CAP - 1,
        Earth: ELEMENTAL_MASTERY_CAP - 1,
      },
    });
    expect(
      (await caller.startMasteryTraining({ stat: "ninjutsuMastery" })).success,
    ).toBe(true);
    expect(
      (await caller.startMasteryTraining({ stat: "Wind", speed: "15min" })).success,
    ).toBe(true);
    const entries = [
      { stat: "Earth" as const, speed: "15min" as const },
      { stat: "Lightning" as const, speed: "4hrs" as const },
    ];
    expect(
      (
        await caller.updateMasteryTrainingQueue({
          kind: "ELEMENT",
          expectedEntries: [],
          entries,
        })
      ).success,
    ).toBe(true);
    expect(
      (
        await caller.updateMasteryTrainingQueue({
          kind: "ELEMENT",
          expectedEntries: [],
          entries: [],
        })
      ).success,
    ).toBe(false);
    expect(
      (await caller.updateMasteryTrainingQueue({ expectedEntries: [], entries }))
        .success,
    ).toBe(false);
    const masteries = [{ stat: "genjutsuMastery" as const, speed: "8hrs" as const }];
    expect(
      (
        await caller.updateMasteryTrainingQueue({
          expectedEntries: [],
          entries: masteries,
        })
      ).success,
    ).toBe(true);
    const before = await readUser();
    await patch({
      status: "ASLEEP",
      elementalTrainingStartedAt: new Date(Date.now() - 1_801_000),
      masteryTrainingStartedAt: new Date(Date.now() - 3_601_000),
    });
    const { user } = await fetchUpdatedUser({
      client: await getTestDatabase(),
      userId: ID,
    });
    expect(user!.elementalMastery).toEqual({
      Wind: ELEMENTAL_MASTERY_CAP,
      Earth: ELEMENTAL_MASTERY_CAP,
    });
    expect(user!.currentlyTrainingElement).toBe("Lightning");
    expect(user!.elementalTrainingSpeed).toBe("4hrs");
    expect(user!.currentlyTrainingMastery).toBe("genjutsuMastery");
    expect(user!.trainingSpeed).toBe("8hrs");
    expect(getMasteryQueue(user!, "ELEMENT")).toEqual([]);
    expect(getMasteryQueue(user!)).toEqual([]);
    expect(user!.experience).toBe(before.experience);
    expect(user!.ninjutsuMastery).toBeGreaterThan(before.ninjutsuMastery);
    expect(user!.dailyTrainings).toBe(before.dailyTrainings + 3);
    const second = await fetchUpdatedUser({
      client: await getTestDatabase(),
      userId: ID,
    });
    expect(second.user!.elementalMastery).toEqual(user!.elementalMastery);
    expect(second.user!.dailyTrainings).toBe(user!.dailyTrainings);
  });

  it("gives each queue its own capacity and cancellation does not change the other session", async () => {
    const caller = await api();
    await caller.startMasteryTraining({ stat: "ninjutsuMastery" });
    await caller.startMasteryTraining({ stat: "Wind", speed: "4hrs" });
    const masteries = [{ stat: "genjutsuMastery" as const, speed: "1hr" as const }];
    const elements = [{ stat: "Earth" as const, speed: "15min" as const }];
    expect(
      (
        await caller.updateMasteryTrainingQueue({
          expectedEntries: [],
          entries: masteries,
        })
      ).success,
    ).toBe(true);
    expect(
      (
        await caller.updateMasteryTrainingQueue({
          kind: "ELEMENT",
          expectedEntries: [],
          entries: elements,
        })
      ).success,
    ).toBe(true);
    expect(
      (
        await caller.updateMasteryTrainingQueue({
          kind: "ELEMENT",
          expectedEntries: elements,
          entries: [...elements, ...elements],
        })
      ).success,
    ).toBe(false);
    expect(
      (
        await caller.updateMasteryTrainingQueue({
          kind: "ELEMENT",
          expectedEntries: elements,
          entries: [],
        })
      ).success,
    ).toBe(true);
    const before = await readUser();
    expect((await caller.stopMasteryTraining(await session())).success).toBe(true);
    const { user } = await fetchUpdatedUser({
      client: await getTestDatabase(),
      userId: ID,
    });
    expect(getMasteryQueue(user!)).toEqual(masteries);
    expect(user!.currentlyTrainingMastery).toBe(before.currentlyTrainingMastery);
    expect(user!.masteryTrainingStartedAt).toEqual(before.masteryTrainingStartedAt);
    expect(user!.trainingSpeed).toBe(before.trainingSpeed);
    expect(user!.currentlyTrainingElement).toBeNull();
  });

  it("shares the daily allowance when both offline queues advance", async () => {
    const caller = await api();
    await caller.updateTrainingSpeed({ speed: "15min" });
    await caller.startMasteryTraining({ stat: "ninjutsuMastery" });
    await caller.startMasteryTraining({ stat: "Wind", speed: "15min" });
    await caller.updateMasteryTrainingQueue({
      expectedEntries: [],
      entries: [{ stat: "genjutsuMastery", speed: "1hr" }],
    });
    await caller.updateMasteryTrainingQueue({
      kind: "ELEMENT",
      expectedEntries: [],
      entries: [{ stat: "Earth", speed: "1hr" }],
    });
    const startedAt = new Date(Date.now() - 901_000);
    await patch({
      dailyTrainings: MAX_DAILY_TRAININGS - 2,
      masteryTrainingStartedAt: startedAt,
      elementalTrainingStartedAt: startedAt,
    });
    const { user } = await fetchUpdatedUser({
      client: await getTestDatabase(),
      userId: ID,
    });
    expect(user!.dailyTrainings).toBe(MAX_DAILY_TRAININGS - 1);
    expect(user!.currentlyTrainingMastery).toBe("genjutsuMastery");
    expect(user!.currentlyTrainingElement).toBe("Wind");
    expect(getMasteryQueue(user!, "ELEMENT")).toEqual([
      { stat: "Earth", speed: "1hr" },
    ]);
    expect(user!.elementalMastery.Wind ?? 0).toBe(0);
  });

  it("collects only one standalone session when both were started with one daily allowance left", async () => {
    const caller = await api();
    await patch({ dailyTrainings: MAX_DAILY_TRAININGS - 1 });
    expect((await caller.updateTrainingSpeed({ speed: "15min" })).success).toBe(true);
    expect(
      (await caller.startMasteryTraining({ stat: "ninjutsuMastery" })).success,
    ).toBe(true);
    expect(
      (await caller.startMasteryTraining({ stat: "Wind", speed: "15min" })).success,
    ).toBe(true);
    const before = await readUser();
    const startedAt = new Date(Date.now() - 901_000);
    await patch({
      masteryTrainingStartedAt: startedAt,
      elementalTrainingStartedAt: startedAt,
    });
    const db = await getTestDatabase();
    const { user } = await fetchUpdatedUser({ client: db, userId: ID });
    expect(user!.dailyTrainings).toBe(MAX_DAILY_TRAININGS);
    expect(user!.ninjutsuMastery).toBeGreaterThan(before.ninjutsuMastery);
    expect(user!.elementalMastery.Wind ?? 0).toBe(0);
    expect(user!.currentlyTrainingMastery).toBeNull();
    expect(user!.currentlyTrainingElement).toBeNull();
    expect((await db.select().from(trainingLog)).map((log) => log.stat)).toEqual([
      "ninjutsuMastery",
    ]);
    const refreshed = await fetchUpdatedUser({ client: db, userId: ID });
    expect(refreshed.user!.dailyTrainings).toBe(MAX_DAILY_TRAININGS);
    expect(refreshed.user!.ninjutsuMastery).toBe(user!.ninjutsuMastery);
    expect((await readUser()).dailyTrainings).toBe(MAX_DAILY_TRAININGS);
  });

  it.each(["ninjutsuMastery", "Wind"] as const)(
    "stops unfinished %s without gains after the daily allowance is exhausted",
    async (stat) => {
      const caller = await api();
      await patch({ dailyTrainings: MAX_DAILY_TRAININGS - 1 });
      expect((await caller.startMasteryTraining({ stat })).success).toBe(true);
      const startedAt = new Date(Date.now() - 14 * 60_000);
      await patch({
        dailyTrainings: MAX_DAILY_TRAININGS,
        ...(stat === "Wind"
          ? { elementalTrainingStartedAt: startedAt }
          : { masteryTrainingStartedAt: startedAt }),
      });
      const db = await getTestDatabase();
      await db.insert(captcha).values({ userId: ID, value: "stop-test" });
      const before = await readUser();
      const result = await caller.stopMasteryTraining({
        stat,
        startedAt,
        guess: "stop-test",
      });
      expect(result.success).toBe(true);
      expect(result.message).toContain("gained 0.00");
      const after = await readUser();
      expect(after.dailyTrainings).toBe(MAX_DAILY_TRAININGS);
      expect(after.ninjutsuMastery).toBe(before.ninjutsuMastery);
      expect(after.elementalMastery).toEqual(before.elementalMastery);
      expect(
        stat === "Wind"
          ? after.currentlyTrainingElement
          : after.currentlyTrainingMastery,
      ).toBeNull();
      expect(await db.select().from(trainingLog)).toEqual([]);
    },
  );
});
