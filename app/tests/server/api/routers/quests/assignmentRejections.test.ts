import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import { WAR_MISSIONS_PER_DAY } from "@/drizzle/constants";
import {
  item,
  quest,
  questHistory,
  userData,
  userItem,
  village,
  villageStructure,
  war,
} from "@/drizzle/schema";
import { Pusher } from "@/libs/pusher";
import { fetchUpdatedUser } from "@/routers/profile";
import { assignQuestToUser } from "@/server/utils/questAssignment";
import { DialogObjective } from "@/validators/objectives";
import { ObjectiveReward } from "@/validators/rewards";
import {
  insertItems,
  insertQuests,
  insertUserItems,
  insertUsers,
} from "../../../../setup/factories";
import { overrideQuery } from "../../../../setup/statements";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

const entryItemsChanged = "Your entry items changed. Please try again.";

const content = {
  entryItems: [{ ids: ["ticket"], number: 1 }],
  objectives: [DialogObjective.parse({ id: "wait", task: "dialog" })],
  reward: ObjectiveReward.parse({}),
  sceneBackground: "",
  sceneCharacters: [],
};

/** Every start branch rejects without keeping a partial slot, attempt or item debit. */
describeWithDatabase("assignQuestToUser rejections", () => {
  beforeEach(async () => {
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    await resetTables(
      questHistory,
      quest,
      userItem,
      item,
      villageStructure,
      war,
      village,
      userData,
    );
    await insertUsers([
      {
        userId: "hero",
        status: "AWAKE",
        rank: "JONIN",
        level: 50,
        isOutlaw: true,
        villageId: "home",
        regeneration: 0,
        primaryElement: "Fire",
        secondaryElement: "Water",
      },
    ]);
    const client = await getTestDatabase();
    await client.insert(village).values(
      ["home", "enemy"].map((id, i) => ({
        id,
        name: id,
        sector: 201 + i,
        kageId: `${id}-kage`,
        tokens: 1000,
      })),
    );
    await client.insert(war).values({
      id: "war",
      type: "VILLAGE_WAR",
      status: "ACTIVE",
      sector: 201,
      attackerVillageId: "home",
      defenderVillageId: "enemy",
      attackerWarHealth: 100,
      defenderWarHealth: 100,
      defenderShrineHp: 0,
    });
    await client.insert(villageStructure).values(
      ["home", "enemy"].map((id) => ({
        id: `${id}/townhall`,
        name: "Town Hall",
        route: "/townhall",
        image: "",
        villageId: id,
        curSp: 1000,
      })),
    );
    await insertItems([{ id: "ticket", name: "Ticket", itemType: "WEAPON" }]);
    await insertUserItems([
      { id: "tickets", userId: "hero", itemId: "ticket", quantity: 3 },
    ]);
    await insertQuests(
      (["battlepyramid", "war", "special"] as const).map((questType) => ({
        id: questType,
        name: questType,
        questType,
        hidden: false,
        maxAttempts: 100,
        maxCompletes: 100,
        content,
      })),
    );
  });
  afterEach(() => vi.restoreAllMocks());

  /** The plan reads three tickets while the stack has already moved underneath it. */
  const withMovedStack = async () => {
    const client = await getTestDatabase();
    return overrideQuery(client, "userItem", {
      findMany: async (read, ...args) => {
        const rows = await read(...args);
        await client
          .update(userItem)
          .set({ quantity: 2 })
          .where(eq(userItem.id, "tickets"));
        return rows;
      },
    });
  };

  const loadStart = async (questId: string) => {
    const client = await getTestDatabase();
    const { user } = await fetchUpdatedUser({ client, userId: "hero" });
    const definition = await client.query.quest.findFirst({
      where: eq(quest.id, questId),
    });
    return { client, user: user!, definition: definition! };
  };

  const expectNothingKept = async (quantity = 2) => {
    const client = await getTestDatabase();
    const saved = await client.query.userData.findFirst({
      where: eq(userData.userId, "hero"),
    });
    expect(await client.query.questHistory.findMany()).toHaveLength(0);
    expect(saved?.dailyWarMissions).toBe(0);
    expect(saved?.questData ?? []).toHaveLength(0);
    expect((await client.query.userItem.findFirst())?.quantity).toBe(quantity);
  };

  it("rolls back a Pyramid start when a ticket stack moved", async () => {
    const { user, definition } = await loadStart("battlepyramid");
    const updatedAt = user.updatedAt;
    const result = await assignQuestToUser({
      client: await withMovedStack(),
      user,
      quest: definition,
      source: "ui",
      prevAttempt: undefined,
    });
    expect(result).toEqual({ success: false, message: entryItemsChanged });
    await expectNothingKept();
    expect(user.updatedAt).toEqual(updatedAt);
    expect(user.userQuests).toHaveLength(0);
  });

  it("rejects a Pyramid start when the account snapshot moved", async () => {
    const { client, user, definition } = await loadStart("battlepyramid");
    await client
      .update(userData)
      .set({ updatedAt: new Date(user.updatedAt.getTime() + 60000) })
      .where(eq(userData.userId, "hero"));
    expect(
      await assignQuestToUser({
        client,
        user,
        quest: definition,
        source: "ui",
        prevAttempt: undefined,
      }),
    ).toEqual({
      success: false,
      message:
        "Your account changed or another Pyramid started. Refresh and try again.",
    });
    await expectNothingKept(3);
  });

  it("refunds a ticketed war slot when a ticket stack moved", async () => {
    const { user, definition } = await loadStart("war");
    const result = await assignQuestToUser({
      client: await withMovedStack(),
      user,
      quest: definition,
      source: "ui",
      prevAttempt: undefined,
    });
    expect(result).toEqual({ success: false, message: entryItemsChanged });
    await expectNothingKept();
    expect(user.dailyWarMissions).toBe(0);
    expect(user.userQuests).toHaveLength(0);
  });

  it("rejects a ticketed war start when a stale slot is already spent", async () => {
    const { client, user, definition } = await loadStart("war");
    await client
      .update(userData)
      .set({ dailyWarMissions: WAR_MISSIONS_PER_DAY })
      .where(eq(userData.userId, "hero"));
    const result = await assignQuestToUser({
      client,
      user,
      quest: definition,
      source: "ui",
      prevAttempt: undefined,
    });
    expect(result).toEqual({
      success: false,
      message: `You have reached your daily war mission limit of ${WAR_MISSIONS_PER_DAY}`,
    });
    expect(await client.query.questHistory.findMany()).toHaveLength(0);
    expect((await client.query.userItem.findFirst())?.quantity).toBe(3);
    expect(user.dailyWarMissions).toBe(0);
  });

  it("leaves the receipt unmarked when an item start cannot pay", async () => {
    const { user, definition } = await loadStart("special");
    const result = await assignQuestToUser({
      client: await withMovedStack(),
      user,
      quest: definition,
      source: "item",
      inTransaction: true,
      prevAttempt: undefined,
    });
    expect(result).toEqual({ success: false, message: entryItemsChanged });
    expect(user.userQuests.find((row) => row.questId === "special")?.entryPaid).toBe(
      false,
    );
  });

  it("marks the receipt on the caller's user when an item start pays", async () => {
    const { client, user, definition } = await loadStart("special");
    const result = await assignQuestToUser({
      client,
      user,
      quest: definition,
      source: "item",
      inTransaction: true,
      prevAttempt: undefined,
    });
    expect(result).toMatchObject({ success: true, message: "Quest started: special" });
    expect(user.userQuests.find((row) => row.questId === "special")?.entryPaid).toBe(
      true,
    );
    expect((await client.query.questHistory.findFirst())?.entryPaid).toBe(true);
    expect((await client.query.userItem.findFirst())?.quantity).toBe(2);
  });

  it.each(["battlepyramid", "war"])(
    "marks the receipt when a %s start pays",
    async (questId) => {
      const { client, user, definition } = await loadStart(questId);
      const result = await assignQuestToUser({
        client,
        user,
        quest: definition,
        source: "ui",
        prevAttempt: undefined,
      });
      expect(result).toMatchObject({
        success: true,
        message: `Quest started: ${questId}`,
      });
      expect(user.userQuests.find((row) => row.questId === questId)?.entryPaid).toBe(
        true,
      );
      expect((await client.query.questHistory.findFirst())?.entryPaid).toBe(true);
      expect((await client.query.userItem.findFirst())?.quantity).toBe(2);
    },
  );
});
