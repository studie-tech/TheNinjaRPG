import { afterEach, beforeEach, expect, it, setSystemTime, vi } from "bun:test";
import { eq } from "drizzle-orm";
import { VILLAGE_SYNDICATE_ID } from "@/drizzle/constants";
import { item, userData, userItem, userVote, village } from "@/drizzle/schema";
import { Pusher } from "@/libs/pusher";
import { itemRouter } from "@/server/api/routers/item";
import { NonCombatConsumeRewardTag } from "@/validators/combat";
import { insertItems, insertUserItems, insertUsers } from "../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

const NOW = new Date("2026-10-14T12:00:00Z");

describeWithDatabase("consumable village token rewards", () => {
  beforeEach(async () => {
    setSystemTime(NOW);
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    await resetTables(userItem, item, userVote, userData, village);
    await insertItems([
      {
        id: "token-reward",
        itemType: "CONSUMABLE",
        cost: 0,
        effects: [NonCombatConsumeRewardTag.parse({ reward_tokens: 1000 })],
      },
    ]);
  });

  afterEach(() => {
    setSystemTime();
    vi.restoreAllMocks();
  });

  it.each([
    { days: 0, isOutlaw: false, expectedTokens: 1000 },
    { days: 14, isOutlaw: false, expectedTokens: 1030 },
    { days: 100, isOutlaw: false, expectedTokens: 1130 },
    { days: 100, isOutlaw: true, expectedTokens: 1000 },
  ])(
    "grants $expectedTokens tokens after $days days (outlaw: $isOutlaw)",
    async ({ days, isOutlaw, expectedTokens }) => {
      const db = await getTestDatabase();
      const villageId = isOutlaw ? VILLAGE_SYNDICATE_ID : "home";
      await db.insert(village).values({
        id: villageId,
        name: isOutlaw ? "Syndicate" : "Home",
        type: isOutlaw ? "OUTLAW" : "VILLAGE",
        sector: 1,
        kageId: "",
        tokens: 200,
      });
      await insertUsers([
        {
          userId: "member",
          level: 50,
          rank: "JONIN",
          status: "AWAKE",
          villageId,
          isOutlaw,
          joinedVillageAt: new Date(NOW.getTime() - days * 86_400_000),
          updatedAt: NOW,
          regenAt: NOW,
        },
      ]);
      await insertUserItems([
        { id: "owned-reward", userId: "member", itemId: "token-reward" },
      ]);

      const api = await callerFor(itemRouter, "member");
      expect(await api.consume({ userItemId: "owned-reward" })).toMatchObject({
        success: true,
        rewards: { reward_tokens: expectedTokens },
      });
      expect(
        await db.query.village.findFirst({ where: eq(village.id, villageId) }),
      ).toMatchObject({ tokens: 200 + expectedTokens });
      expect(await db.select().from(userItem)).toHaveLength(0);

      expect(await api.consume({ userItemId: "owned-reward" })).toMatchObject({
        success: false,
      });
      expect(
        await db.query.village.findFirst({ where: eq(village.id, villageId) }),
      ).toMatchObject({ tokens: 200 + expectedTokens });
    },
  );
});
