import { eq } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import { jutsu, userData, userJutsu, userQueue, userVote } from "@/drizzle/schema";
import { calcJutsuTrainCost } from "@/libs/train";
import { fetchUpdatedUser } from "@/server/api/routers/profile";
import { jutsuRouter } from "@/server/api/routers/jutsu";
import { trainRouter } from "@/server/api/routers/train";
import { queueMasteries } from "../../setup/queues";
import { insertUsers } from "../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";

const userId = "queue-profile-drop";
describeWithDatabase("Queue settlement response reconciliation", () => {
  beforeEach(async () => {
    await resetTables(userQueue, userJutsu, jutsu, userVote, userData);
    const now = new Date();
    await insertUsers([
      {
        userId,
        username: userId,
        rank: "GENIN",
        level: 20,
        status: "AWAKE",
        isOutlaw: true,
        money: 0,
        regeneration: 0,
        updatedAt: now,
        regenAt: now,
        primaryElement: "Fire",
        secondaryElement: "Water",
      },
    ]);
    const db = await getTestDatabase();
    await db
      .insert(userVote)
      .values({ id: "profile-drop-vote", userId, secret: "secret01", lastVoteAt: now });
    await db.insert(jutsu).values({
      id: "hidden-drop",
      name: "Hidden",
      description: "Hidden",
      battleDescription: "Hidden",
      effects: [],
      target: "SELF",
      range: 0,
      requiredRank: "STUDENT",
      jutsuRank: "D",
      jutsuType: "NORMAL",
      image: "/hidden.png",
      hidden: true,
    });
    await db.insert(userQueue).values({
      id: "profile-drop-row",
      userId,
      kind: "JUTSU",
      position: 1,
      jutsuId: "hidden-drop",
      reservedRyo: 100,
      durationSeconds: 60,
      startsAt: new Date(now.getTime() - 60_000),
      finishesAt: now,
    });
  });

  it("returns refunded balance and removes a dropped queue row in the same refresh", async () => {
    const db = await getTestDatabase();
    const first = await fetchUpdatedUser({ client: db, userId });
    const actual = await db.query.userData.findFirst({
      where: eq(userData.userId, userId),
      with: { queue: true },
    });
    const second = await fetchUpdatedUser({ client: db, userId });
    expect(actual?.money).toBe(100);
    expect(actual?.queue).toEqual([]);
    expect(second.user?.money).toBe(100);
    expect(second.user?.queue).toEqual([]);
    expect(first.user?.money).toBe(100);
    expect(first.user?.queue).toEqual([]);
    expect(first.requiresUserRefresh).toBe(true);
    expect(first.requiresProgressionRefresh).toBe(true);
  });

  it("does not reject new training as queue-full after refunding its only hidden queued job", async () => {
    const db = await getTestDatabase();
    await db.update(userData).set({ money: 1000 }).where(eq(userData.userId, userId));
    await db.insert(jutsu).values({
      id: "valid-training",
      name: "Valid",
      description: "Valid",
      battleDescription: "Valid",
      effects: [],
      target: "SELF",
      range: 0,
      requiredRank: "STUDENT",
      jutsuRank: "D",
      jutsuType: "NORMAL",
      image: "/valid.png",
    });
    const caller = await callerFor(jutsuRouter, userId);
    const first = await caller.startTraining({ jutsuId: "valid-training" });
    const dropped = await db.query.userData.findFirst({
      where: eq(userData.userId, userId),
      with: { queue: true },
    });
    const info = await db.query.jutsu.findFirst({
      where: eq(jutsu.id, "valid-training"),
    });
    expect(dropped?.money).toBe(1100 - calcJutsuTrainCost(info!, 0));
    expect(dropped?.queue).toEqual([]);
    expect(first.success).toBe(true);
  });

  it("a started timed job does reread the current balance and queue", async () => {
    const db = await getTestDatabase();
    await db.update(jutsu).set({ hidden: false }).where(eq(jutsu.id, "hidden-drop"));
    const result = await fetchUpdatedUser({ client: db, userId });
    const actual = await db.query.userData.findFirst({
      where: eq(userData.userId, userId),
      with: { queue: true },
    });
    expect(result.startedQueuedJobs).toBe(1);
    expect(result.user?.queue).toEqual(actual?.queue);
    expect(result.user?.money).toBe(actual?.money);
    expect(result.requiresUserRefresh).toBe(true);
    expect(result.requiresProgressionRefresh).toBe(true);
  });

  it.each([5, 16])(
    "collecting a viewed mastery after %s minutes preserves its queued next session",
    async (elapsedMinutes) => {
      const db = await getTestDatabase();
      await db.delete(userQueue).where(eq(userQueue.userId, userId));
      const session = {
        stat: "ninjutsuMastery" as const,
        startedAt: new Date(Date.now() - elapsedMinutes * 60_000),
      };
      await db
        .update(userData)
        .set({
          currentlyTrainingMastery: "ninjutsuMastery",
          masteryTrainingStartedAt: session.startedAt,
          trainingSpeed: "15min",
          dailyTrainings: 0,
        })
        .where(eq(userData.userId, userId));
      await queueMasteries(userId, [{ stat: "genjutsuMastery", speed: "1hr" }]);
      const result = await (await callerFor(trainRouter, userId)).stopMasteryTraining(
        session,
      );
      const actual = await db.query.userData.findFirst({
        where: eq(userData.userId, userId),
        with: { queue: true },
      });
      expect(result.success).toBe(elapsedMinutes < 15);
      expect(actual?.ninjutsuMastery).toBeGreaterThan(10);
      expect(actual?.currentlyTrainingMastery).toBe("genjutsuMastery");
      expect(actual?.trainingSpeed).toBe("1hr");
      expect(actual?.genjutsuMastery).toBe(10);
      expect(actual?.dailyTrainings).toBe(1);
    },
  );
});
