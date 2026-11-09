import { beforeEach, expect, it } from "bun:test";
import { and, eq, sql } from "drizzle-orm";
import { item, quest, questHistory, userData, userItem } from "@/drizzle/schema";
import {
  commitQuestEntryBattle,
  getQuestEntryCharges,
} from "@/server/utils/questEntry";
import { ObjectiveReward } from "@/validators/rewards";
import {
  insertItems,
  insertQuestHistory,
  insertQuests,
  insertUserItems,
  insertUsers,
} from "../../setup/factories";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";

describeWithDatabase("quest entry receipts", () => {
  beforeEach(async () => {
    await resetTables(quest, questHistory, userData, userItem, item);
    await insertUsers([{ userId: "hero", status: "AWAKE" }, { userId: "other" }]);
    await insertQuests([
      {
        id: "pyramid",
        questType: "battlepyramid",
        content: {
          entryItems: [{ ids: ["ticket"], number: 3 }],
          isolated: true,
          objectives: [],
          reward: ObjectiveReward.parse({}),
          sceneBackground: "",
          sceneCharacters: [],
        },
      },
    ]);
    await insertQuestHistory([
      {
        id: "run",
        userId: "hero",
        questId: "pyramid",
        questType: "battlepyramid",
        isolated: true,
      },
    ]);
    await insertItems([{ id: "ticket" }]);
    await insertUserItems([
      { id: "a", userId: "hero", itemId: "ticket", quantity: 2 },
      { id: "b", userId: "hero", itemId: "ticket", quantity: 3 },
    ]);
  });
  /** Read the same preloaded attempt/inventory snapshot consumed by first-battle entry. */
  const snapshot = async () => {
    const client = await getTestDatabase();
    const [attempt, items] = await Promise.all([
      client.query.questHistory.findFirst({
        where: eq(questHistory.id, "run"),
        with: { quest: true },
      }),
      client.query.userItem.findMany({ where: eq(userItem.userId, "hero") }),
    ]);
    if (!attempt) throw new Error("Missing run fixture");
    return { client, attempt, items, role: "USER" as const };
  };
  // A guarded participant claim with a visible counter detects duplicate commits and rollback.
  const createBattle = (client: Awaited<ReturnType<typeof getTestDatabase>>) =>
    client
      .update(userData)
      .set({ status: "BATTLE", money: sql`${userData.money} + 1` })
      .where(and(eq(userData.userId, "hero"), eq(userData.status, "AWAKE")));
  const didClaim = (result: { rowsAffected: number }) => result.rowsAffected === 1;

  it("retains each allocated stack's item identity and original quantity", async () => {
    const { attempt, items } = await snapshot();
    expect(getQuestEntryCharges(attempt, items)).toEqual([
      { id: "a", itemId: "ticket", quantity: 2, expectedQuantity: 2 },
      { id: "b", itemId: "ticket", quantity: 1, expectedQuantity: 3 },
    ]);
  });

  it("charges fragmented stacks once under simultaneous first-battle requests", async () => {
    const info = await snapshot();
    const results = await Promise.all(
      [1, 2].map(() => commitQuestEntryBattle({ ...info, createBattle, didClaim })),
    );
    expect(results.filter((r) => r.success)).toHaveLength(1);
    expect(
      (await info.client.query.userItem.findMany()).map((r) => [r.id, r.quantity]),
    ).toEqual([["b", 2]]);
    expect((await info.client.query.questHistory.findFirst())?.entryPaid).toBe(true);
  });
  it("rolls back items and receipt if battle creation rejects or throws", async () => {
    const info = await snapshot();
    expect(
      (
        await commitQuestEntryBattle({
          ...info,
          createBattle: async () => ({ rowsAffected: 0 }),
          didClaim,
        })
      ).success,
    ).toBe(false);
    await expect(
      commitQuestEntryBattle({
        ...info,
        createBattle: async () => {
          throw new Error("Battle write failed");
        },
        didClaim,
      }),
    ).rejects.toThrow("Battle write failed");
    expect(
      (await info.client.query.userItem.findMany()).map((r) => r.quantity).sort(),
    ).toEqual([2, 3]);
    expect((await info.client.query.questHistory.findFirst())?.entryPaid).toBe(false);
  });
  it("retains the receipt for another floor, and requires tickets for a new attempt", async () => {
    const info = await snapshot();
    expect(
      (await commitQuestEntryBattle({ ...info, createBattle, didClaim })).success,
    ).toBe(true);
    await info.client
      .update(userData)
      .set({ status: "AWAKE" })
      .where(eq(userData.userId, "hero"));
    expect(
      (await commitQuestEntryBattle({ ...(await snapshot()), createBattle, didClaim }))
        .success,
    ).toBe(true);
    expect(
      (await info.client.query.userItem.findMany()).reduce(
        (sum, r) => sum + r.quantity,
        0,
      ),
    ).toBe(2);
    await info.client
      .update(questHistory)
      .set({ entryPaid: false })
      .where(eq(questHistory.id, "run"));
    expect(
      (await commitQuestEntryBattle({ ...(await snapshot()), createBattle, didClaim }))
        .success,
    ).toBe(false);
  });
  for (const state of [
    "abandoned",
    "edited",
    "hidden",
    "items changed",
    "items stored",
    "items auctioned",
    "items transferred",
  ] as const) {
    it(`rejects ${state} snapshots before any committed charge`, async () => {
      const info = await snapshot();
      if (state === "abandoned")
        await info.client
          .update(questHistory)
          .set({ endAt: new Date() })
          .where(eq(questHistory.id, "run"));
      if (state === "edited") {
        info.attempt.questVersion = info.attempt.quest.updatedAt;
        await info.client
          .update(quest)
          .set({ updatedAt: new Date(info.attempt.quest.updatedAt.getTime() + 1000) })
          .where(eq(quest.id, "pyramid"));
      }
      if (state === "hidden")
        await info.client
          .update(quest)
          .set({ hidden: true })
          .where(eq(quest.id, "pyramid"));
      if (state === "items changed")
        await info.client
          .update(userItem)
          .set({ quantity: 1 })
          .where(eq(userItem.id, "a"));
      if (state === "items stored")
        await info.client
          .update(userItem)
          .set({ storedAtHome: true })
          .where(eq(userItem.id, "a"));
      if (state === "items auctioned")
        await info.client
          .update(userItem)
          .set({ isInAuction: true })
          .where(eq(userItem.id, "a"));
      if (state === "items transferred")
        await info.client
          .update(userItem)
          .set({ userId: "other" })
          .where(eq(userItem.id, "a"));
      expect(
        (await commitQuestEntryBattle({ ...info, createBattle, didClaim })).success,
      ).toBe(false);
      expect((await info.client.query.questHistory.findFirst())?.entryPaid).toBe(false);
      expect(
        (
          await info.client.query.userData.findFirst({
            where: eq(userData.userId, "hero"),
          })
        )?.status,
      ).toBe("AWAKE");
      expect(
        (await info.client.query.userItem.findFirst({ where: eq(userItem.id, "b") }))
          ?.quantity,
      ).toBe(3);
    });
  }
});
