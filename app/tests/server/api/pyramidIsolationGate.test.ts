import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import {
  conversation,
  item,
  questHistory,
  user2conversation,
  userData,
  userItem,
} from "@/drizzle/schema";
import { Pusher } from "@/libs/pusher";
import { ISOLATED_PYRAMID_MESSAGE } from "@/libs/questRun";
import { commentsRouter } from "@/server/api/routers/comments";
import { itemRouter } from "@/server/api/routers/item";
import { profileRouter } from "@/server/api/routers/profile";
import { trainRouter } from "@/server/api/routers/train";
import { createTRPCRouter } from "@/server/api/trpc";
import { NonCombatConsumeRewardTag } from "@/validators/combat";
import { deferred } from "../../setup/deferred";
import {
  insertItems,
  insertQuestHistory,
  insertUserItems,
  insertUsers,
} from "../../setup/factories";
import { stubRateLimitTransport } from "../../setup/rateLimit";
import { overrideQuery } from "../../setup/statements";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  recordQueries,
  resetTables,
} from "../../setup/testDatabase";

const router = createTRPCRouter({
  comments: commentsRouter,
  item: itemRouter,
  profile: profileRouter,
  train: trainRouter,
});

const WRITE = /^\s*(insert|update|delete|replace|begin|start transaction)\b/i;

describeWithDatabase("Pyramid isolation gate", () => {
  let events: ReturnType<typeof spyOnBroadcasts>;
  beforeEach(async () => {
    stubRateLimitTransport();
    events = spyOnBroadcasts();
    await resetTables(
      questHistory,
      user2conversation,
      conversation,
      userItem,
      item,
      userData,
    );
    const now = new Date();
    await insertUsers(
      ["isolated", "free"].map((userId) => ({
        userId,
        username: userId,
        level: 50,
        rank: "JONIN",
        status: "AWAKE",
        isOutlaw: true,
        money: 100,
        curEnergy: 100,
        showBattleDescription: false,
        regenAt: now,
        updatedAt: now,
      })),
    );
    await insertItems([
      {
        id: "purse",
        itemType: "CONSUMABLE",
        cost: 0,
        effects: [NonCombatConsumeRewardTag.parse({ reward_money: 50 })],
      },
    ]);
    await insertUserItems(
      ["isolated", "free"].map((userId) => ({
        id: `${userId}-purse`,
        userId,
        itemId: "purse",
        quantity: 2,
      })),
    );
    await insertQuestHistory([
      {
        userId: "isolated",
        questId: "pyramid",
        questType: "battlepyramid",
        isolated: true,
      },
    ]);
    const db = await getTestDatabase();
    await db
      .insert(conversation)
      .values({ id: "tavern", title: "Tavern", isPublic: true, createdById: "free" });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await resetTables(questHistory);
  });

  const actions = {
    consume: (api: Api, userId: string) =>
      api.item.consume({ userItemId: `${userId}-purse` }),
    startTraining: (api: Api) =>
      api.train.startTraining({ stat: "strength", energy: 1 }),
    updateBattleDescription: (api: Api) =>
      api.profile.updateBattleDescription({ showBattleDescription: true }),
    sendTypingIndicator: (api: Api) =>
      api.comments.sendTypingIndicator({ conversationId: "tavern" }),
  };

  it.each(Object.keys(actions) as (keyof typeof actions)[])(
    "rejects %s inside an isolated run before any write or broadcast",
    async (action) => {
      const db = await getTestDatabase();
      const before = await db.query.userData.findFirst({
        where: eq(userData.userId, "isolated"),
      });
      events.mockClear();
      const api = await callerFor(router, "isolated");
      const { result, statements } = await recordQueries(() =>
        actions[action](api, "isolated"),
      );
      expect(result).toEqual({ success: false, message: ISOLATED_PYRAMID_MESSAGE });
      expect(statements.filter((statement) => WRITE.test(statement))).toEqual([]);
      expect(events).not.toHaveBeenCalled();
      expect(
        await db.query.userData.findFirst({ where: eq(userData.userId, "isolated") }),
      ).toEqual(before);
      expect(
        await db.query.userItem.findFirst({ where: eq(userItem.id, "isolated-purse") }),
      ).toMatchObject({ quantity: 2 });
    },
  );

  it.each(Object.keys(actions) as (keyof typeof actions)[])(
    "runs %s for other players while the isolation lookup is still pending",
    async (action) => {
      const db = await getTestDatabase();
      const lookup = deferred();
      const firstRead = deferred();
      // Hold the isolation lookup until the procedure has issued a read of its own.
      const held = overrideQuery(
        overrideQuery(db, "questHistory", {
          findFirst: (read, ...args) => lookup.promise.then(() => read(...args)),
        }),
        "userData",
        {
          findFirst: (read, ...args) => {
            firstRead.resolve();
            return read(...args);
          },
        },
      );
      events.mockClear();
      const pending = actions[action](callerForDatabase(router, "free", held), "free");
      if (action === "updateBattleDescription") {
        // A write-first procedure sends nothing until the lookup clears it.
        lookup.resolve();
      } else {
        await firstRead.promise;
        lookup.resolve();
      }
      expect(await pending).toMatchObject({ success: true });
      if (action === "sendTypingIndicator") expect(events).toHaveBeenCalledTimes(1);
    },
  );
});

const spyOnBroadcasts = () =>
  vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);

type Api = ReturnType<typeof router.createCaller>;
