import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import {
  actionLog,
  bloodline,
  bloodlineRolls,
  jutsu,
  paypalSubscription,
  storePurchase,
  stripePayment,
  userData,
  userJutsu,
  userQueue,
} from "@/drizzle/schema";
import { getDiamondRestoreBloodlineId } from "@/libs/bloodline";
import { bloodlineRouter } from "@/server/api/routers/bloodline";
import { revertLapsedDiamondBloodlines } from "@/server/utils/diamondBloodline";
import { insertJutsus, insertUsers } from "../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

const userId = "diamond-swapper";
const lines = [
  { id: "owned-line", rank: "D" as const },
  { id: "pick-a", rank: "A" as const },
  { id: "pick-b", rank: "B" as const },
  { id: "pick-c", rank: "C" as const },
  { id: "s-line", rank: "S" as const },
  { id: "sand-line", rank: "A" as const, villageId: "sand" },
  { id: "hidden-line", rank: "D" as const, hidden: true },
];

const readUser = async () =>
  (await getTestDatabase()).query.userData.findFirst({
    where: eq(userData.userId, userId),
  });

/** Lift the shared swap cooldown so consecutive swaps reach the Diamond guards. */
const expireSwapCooldown = async () =>
  (await getTestDatabase())
    .update(actionLog)
    .set({ createdAt: new Date(Date.now() - 30 * 24 * 3600 * 1000) })
    .where(eq(actionLog.userId, userId));

/** The restore bloodline the swap screen derives from the profile and bloodline history. */
const readRestoreBloodlineId = async () => {
  const [user, historic] = await Promise.all([
    readUser(),
    (await callerFor(bloodlineRouter, userId)).getUserHistoricBloodlines(),
  ]);
  if (!user) throw new Error("Missing Diamond fixture user");
  return getDiamondRestoreBloodlineId(
    user,
    historic.map((line) => line.id),
  );
};

const swap = async (bloodlineId: string) =>
  (await callerFor(bloodlineRouter, userId)).swapDiamondBloodline({ bloodlineId });
const patch = async (data: Partial<typeof userData.$inferInsert>) =>
  (await getTestDatabase())
    .update(userData)
    .set(data)
    .where(eq(userData.userId, userId));

describeWithDatabase("Diamond bloodline swaps", () => {
  beforeEach(async () => {
    await resetTables(
      actionLog,
      bloodlineRolls,
      paypalSubscription,
      storePurchase,
      stripePayment,
      userData,
      userQueue,
      userJutsu,
      jutsu,
      bloodline,
    );
    const db = await getTestDatabase();
    await insertUsers([
      {
        userId,
        username: "DiamondSwapper",
        rank: "JONIN",
        level: 50,
        status: "AWAKE",
        villageId: "leaf",
        federalStatus: "DIAMOND",
        bloodlineId: "owned-line",
        reputationPoints: 7,
      },
    ]);
    await db.insert(bloodline).values(
      lines.map((line) => ({
        name: line.id,
        image: "",
        description: "Diamond fixture",
        effects: [],
        ...line,
      })),
    );
    await db.insert(bloodlineRolls).values({
      id: "owned-roll",
      userId,
      bloodlineId: "owned-line",
      type: "DIRECT",
    });
  });

  it("swaps freely and repeatedly to any D–A bloodline, without the swap cooldown", async () => {
    for (const id of ["pick-a", "pick-b", "pick-c", "pick-a"])
      expect(await swap(id)).toMatchObject({
        success: true,
        message: "Bloodline swapped with Diamond support",
      });
    expect(await readUser()).toMatchObject({
      bloodlineId: "pick-a",
      reputationPoints: 7,
      diamondBloodlineActive: true,
      preDiamondBloodlineId: "owned-line",
    });
    expect(await readRestoreBloodlineId()).toBe("owned-line");
    // Diamond swaps still start the regular swap cooldown for owned bloodlines.
    expect(
      (
        await (
          await callerFor(bloodlineRouter, userId)
        ).swapBloodline({
          bloodlineId: "owned-line",
        })
      ).message,
    ).toMatch(/^You can swap again in/);
  });

  it("asks to cancel queued bloodline jutsu training, then unequips that jutsu on the swap", async () => {
    const db = await getTestDatabase();
    const finish = new Date(Date.now() + 3_600_000);
    await insertJutsus([{ id: "owned-jutsu", bloodlineId: "owned-line" }]);
    await db.insert(userJutsu).values({
      id: "uj-owned",
      userId,
      jutsuId: "owned-jutsu",
      level: 2,
      equipped: true,
      finishTraining: finish,
    });
    await db.insert(userQueue).values({
      id: "queued-owned-jutsu",
      userId,
      kind: "JUTSU",
      position: 1,
      jutsuId: "owned-jutsu",
      reservedRyo: 500,
      durationSeconds: 60,
      startsAt: finish,
      finishesAt: new Date(finish.getTime() + 60_000),
    });
    expect(await swap("pick-a")).toMatchObject({
      success: false,
      message:
        "Cancel queued training of your bloodline jutsu before changing bloodline",
    });
    expect(await readUser()).toMatchObject({ bloodlineId: "owned-line" });
    await db.delete(userQueue);
    expect((await swap("pick-a")).success).toBe(true);
    expect(await db.query.userJutsu.findFirst()).toMatchObject({
      level: 1,
      equipped: false,
      finishTraining: null,
    });
  });

  it("never records Diamond picks as owned bloodlines", async () => {
    expect((await swap("pick-a")).success).toBe(true);
    const db = await getTestDatabase();
    expect(await db.query.bloodlineRolls.findMany()).toEqual([
      expect.objectContaining({ id: "owned-roll", bloodlineId: "owned-line" }),
    ]);
    const caller = await callerFor(bloodlineRouter, userId);
    expect((await caller.getUserHistoricBloodlines()).map((line) => line.id)).toEqual([
      "owned-line",
    ]);
    // The regular swap only reaches owned bloodlines, so a pick cannot be swapped back to.
    await expireSwapCooldown();
    expect((await caller.swapBloodline({ bloodlineId: "pick-b" })).message).toBe(
      "Bloodline is not in your history",
    );
  });

  it("rejects non-Diamond players and out-of-range bloodlines", async () => {
    for (const id of ["s-line", "sand-line", "hidden-line"]) {
      expect((await swap(id)).success).toBe(false);
    }
    const caller = await callerFor(bloodlineRouter, userId);
    expect((await caller.getDiamondSwapBloodlines()).map((line) => line.id)).toEqual([
      "pick-a",
      "pick-b",
      "pick-c",
      "owned-line",
    ]);
    await patch({ federalStatus: "GOLD" });
    expect(await swap("pick-a")).toMatchObject({
      success: false,
      message: "Diamond bloodline swaps require Diamond Federal Support",
    });
    expect(await caller.getDiamondSwapBloodlines()).toEqual([]);
    // Staff count as Gold, whatever tier is stored.
    await patch({ federalStatus: "DIAMOND", staffAccount: true });
    expect((await swap("pick-a")).success).toBe(false);
    await patch({ federalStatus: "GOLD", staffAccount: false });
    expect(await readUser()).toMatchObject({
      bloodlineId: "owned-line",
      diamondBloodlineActive: false,
    });
  });

  it("restores the pre-Diamond bloodline once Diamond support ends", async () => {
    expect((await swap("pick-a")).success).toBe(true);
    const db = await getTestDatabase();
    // Still Diamond: nothing to revert.
    expect(await revertLapsedDiamondBloodlines(db)).toEqual({
      reverted: 0,
      cleared: 0,
    });
    await patch({ federalStatus: "GOLD" });
    expect(await revertLapsedDiamondBloodlines(db)).toEqual({
      reverted: 1,
      cleared: 0,
    });
    expect(await readUser()).toMatchObject({
      bloodlineId: "owned-line",
      diamondBloodlineActive: false,
      preDiamondBloodlineId: null,
    });
    expect(
      await db.query.actionLog.findMany({
        where: eq(actionLog.relatedMsg, "Diamond Bloodline Reverted"),
      }),
    ).toEqual([
      expect.objectContaining({
        userId,
        relatedId: "owned-line",
        changes: [
          "Diamond Federal Support ended: bloodline reverted from pick-a to owned-line",
        ],
      }),
    ]);
    // Idempotent: the remembered bloodline is gone.
    expect(await revertLapsedDiamondBloodlines(db)).toEqual({
      reverted: 0,
      cleared: 0,
    });
  });

  it("restores no bloodline when the player had none before Diamond", async () => {
    const db = await getTestDatabase();
    await patch({ bloodlineId: null });
    expect((await swap("pick-a")).success).toBe(true);
    await patch({ federalStatus: "NONE" });
    expect(await revertLapsedDiamondBloodlines(db)).toEqual({
      reverted: 1,
      cleared: 0,
    });
    expect(await readUser()).toMatchObject({
      bloodlineId: null,
      diamondBloodlineActive: false,
    });
  });

  it("keeps an owned bloodline chosen after a Diamond swap", async () => {
    expect((await swap("pick-a")).success).toBe(true);
    const db = await getTestDatabase();
    await expireSwapCooldown();
    // Back on an owned bloodline: that is what Diamond's end would leave.
    await (await callerFor(bloodlineRouter, userId)).swapBloodline({
      bloodlineId: "owned-line",
    });
    expect(await readRestoreBloodlineId()).toBe("owned-line");
    await db.insert(bloodlineRolls).values({
      id: "new-roll",
      userId,
      bloodlineId: "pick-c",
      type: "NATURAL",
    });
    await patch({ bloodlineId: "pick-c", federalStatus: "NONE" });
    expect(await revertLapsedDiamondBloodlines(db)).toEqual({
      reverted: 0,
      cleared: 1,
    });
    expect(await readUser()).toMatchObject({
      bloodlineId: "pick-c",
      diamondBloodlineActive: false,
      preDiamondBloodlineId: null,
    });
  });

  it("reverts and clears a batch of lapsed supporters, refunding only their own bloodline jutsu", async () => {
    expect((await swap("pick-a")).success).toBe(true);
    const db = await getTestDatabase();
    const lapsed = {
      rank: "JONIN" as const,
      level: 50,
      status: "AWAKE" as const,
      villageId: "leaf",
      federalStatus: "NONE" as const,
      diamondBloodlineActive: true,
    };
    await insertUsers([
      // Back on an owned bloodline, and with no bloodline: both keep what they have.
      { ...lapsed, userId: "keeper-owned", bloodlineId: "pick-b" },
      { ...lapsed, userId: "keeper-none", bloodlineId: null },
      // Still Diamond: left alone.
      {
        ...lapsed,
        userId: "still-diamond",
        federalStatus: "DIAMOND",
        bloodlineId: "pick-c",
      },
    ]);
    await db.insert(bloodlineRolls).values({
      id: "keeper-roll",
      userId: "keeper-owned",
      bloodlineId: "pick-b",
      type: "NATURAL",
    });
    await insertJutsus([
      { id: "pick-a-jutsu", bloodlineId: "pick-a" },
      { id: "pick-b-jutsu", bloodlineId: "pick-b" },
    ]);
    await db.insert(userJutsu).values([
      { id: "uj-a", userId, jutsuId: "pick-a-jutsu", level: 3, equipped: true },
      { id: "uj-b", userId: "keeper-owned", jutsuId: "pick-b-jutsu", equipped: true },
    ]);
    await patch({ federalStatus: "NONE" });
    expect(await revertLapsedDiamondBloodlines(db)).toEqual({
      reverted: 1,
      cleared: 2,
    });
    const users = await db.query.userData.findMany({
      columns: { userId: true, bloodlineId: true, diamondBloodlineActive: true },
    });
    expect(users).toEqual(
      expect.arrayContaining([
        { userId, bloodlineId: "owned-line", diamondBloodlineActive: false },
        {
          userId: "keeper-owned",
          bloodlineId: "pick-b",
          diamondBloodlineActive: false,
        },
        { userId: "keeper-none", bloodlineId: null, diamondBloodlineActive: false },
        {
          userId: "still-diamond",
          bloodlineId: "pick-c",
          diamondBloodlineActive: true,
        },
      ]),
    );
    expect(
      await db.query.userJutsu.findMany({ columns: { id: true, equipped: true } }),
    ).toEqual(
      expect.arrayContaining([
        { id: "uj-a", equipped: false },
        { id: "uj-b", equipped: true },
      ]),
    );
  });

  it("waits for an active Diamond subscription's renewal before reverting", async () => {
    expect((await swap("pick-a")).success).toBe(true);
    const db = await getTestDatabase();
    await db.insert(paypalSubscription).values({
      id: "diamond-subscription",
      createdById: userId,
      affectedUserId: userId,
      federalStatus: "DIAMOND",
      subscriptionId: "I-DIAMOND",
      orderId: "I-DIAMOND",
      status: "ACTIVE",
      updatedAt: new Date(Date.now() - 32 * 24 * 3600 * 1000),
    });
    await patch({ federalStatus: "NONE" });
    expect(await revertLapsedDiamondBloodlines(db)).toEqual({
      reverted: 0,
      cleared: 0,
    });
    expect(await readUser()).toMatchObject({ bloodlineId: "pick-a" });
    // Once the renewal grace has passed, the revert goes ahead.
    await db
      .update(paypalSubscription)
      .set({ updatedAt: new Date(Date.now() - 40 * 24 * 3600 * 1000) })
      .where(eq(paypalSubscription.id, "diamond-subscription"));
    expect(await revertLapsedDiamondBloodlines(db)).toEqual({
      reverted: 1,
      cleared: 0,
    });
    expect(await readUser()).toMatchObject({ bloodlineId: "owned-line" });
  });

  it.each([
    [
      "Stripe period",
      (expiresAt: Date) =>
        getTestDatabase().then((db) =>
          db.insert(stripePayment).values({
            id: "diamond-invoice",
            checkoutId: "diamond-checkout",
            createdById: userId,
            affectedUserId: userId,
            amountCents: 2500,
            federalStatus: "DIAMOND",
            purchasedAt: new Date(expiresAt.getTime() - 30 * 24 * 3600 * 1000),
            expiresAt,
            grantedAt: new Date(expiresAt.getTime() - 30 * 24 * 3600 * 1000),
          }),
        ),
    ],
    [
      "store receipt",
      (expiresAt: Date) =>
        getTestDatabase().then((db) =>
          db.insert(storePurchase).values({
            id: "diamond-receipt",
            userId,
            originalUserId: userId,
            transactionId: "GPA.diamond",
            productId: "tnr_federal_diamond:monthly",
            store: "GOOGLE",
            federalStatus: "DIAMOND",
            purchasedAt: new Date(expiresAt.getTime() - 30 * 24 * 3600 * 1000),
            expiresAt,
            acceptedAt: new Date(expiresAt.getTime() - 30 * 24 * 3600 * 1000),
            grantedAt: new Date(expiresAt.getTime() - 30 * 24 * 3600 * 1000),
            rawData: {},
          }),
        ),
    ],
  ] as const)(
    "waits for a just-expired Diamond %s's renewal before reverting",
    async (_, insertPeriod) => {
      expect((await swap("pick-a")).success).toBe(true);
      const db = await getTestDatabase();
      await patch({ federalStatus: "NONE" });
      // Expired an hour ago: the renewal may not have been confirmed yet.
      await insertPeriod(new Date(Date.now() - 3600 * 1000));
      expect(await revertLapsedDiamondBloodlines(db)).toEqual({
        reverted: 0,
        cleared: 0,
      });
      expect(await readUser()).toMatchObject({ bloodlineId: "pick-a" });
      // Expired beyond the grace: the revert goes ahead.
      await resetTables(stripePayment, storePurchase);
      await insertPeriod(new Date(Date.now() - 3 * 24 * 3600 * 1000));
      expect(await revertLapsedDiamondBloodlines(db)).toEqual({
        reverted: 1,
        cleared: 0,
      });
      expect(await readUser()).toMatchObject({ bloodlineId: "owned-line" });
    },
  );
});
