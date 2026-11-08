import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { linkPromotion, userData } from "@/drizzle/schema";
import { linkPromotionRouter } from "@/server/api/routers/linkpromotion";
import { insertUsers } from "../../../setup/factories";
import { beforeStatements } from "../../../setup/statements";
import { callerFor, callerForDatabase, describeWithDatabase, getTestDatabase, resetTables } from "../../../setup/testDatabase";

describeWithDatabase("Link promotion submissions and review rewards", () => {
  beforeEach(async () => {
    await resetTables(linkPromotion, userData);
    await insertUsers([
      { userId: "owner-a", username: "owner-a", role: "OWNER" },
      { userId: "owner-b", username: "owner-b", role: "OWNER" },
      { userId: "promoter", username: "promoter", reputationPoints: 0, reputationPointsTotal: 0 },
    ]);
    await (await getTestDatabase()).insert(linkPromotion).values({
      id: "link", userId: "promoter", url: "https://example.com/post",
    });
  });

  it.each([
    "https://www.theninja-rpg.com/post",
    "https://theninja-rpg.com/post",
    "http://www.theninja-rpg.com/post",
    "https://WWW.THENINJA-RPG.COM/post",
    "https://forum.theninja-rpg.com/post",
    "https://theninja-rpg.com./post",
    "https://www.theninja-rpg.com./post",
  ])("rejects an own-site promotion without inserting it: %s", async (url) => {
    const caller = await callerFor(linkPromotionRouter, "promoter");
    expect(await caller.submitLinkPromotion({ url })).toMatchObject({
      success: false,
      message: "Cannot submit link to TNR",
    });
    expect(await (await getTestDatabase()).query.linkPromotion.findMany()).toHaveLength(1);
  });

  it.each([
    "https://example.com/post?source=https://www.theninja-rpg.com",
    "https://theninja-rpg.com.example.com/post",
    "https://nottheninja-rpg.com/post",
  ])("stores an external promotion using its actual host: %s", async (url) => {
    const caller = await callerFor(linkPromotionRouter, "promoter");
    expect((await caller.submitLinkPromotion({ url })).success).toBe(true);
    const saved = await (await getTestDatabase()).query.linkPromotion.findFirst({
      where: eq(linkPromotion.url, url),
    });
    expect(saved).toMatchObject({ userId: "promoter", url, points: 0, reviewed: false });
  });

  it("lists only the caller's own submissions to a player who cannot review", async () => {
    await insertUsers([{ userId: "other", username: "other" }]);
    const caller = await callerFor(linkPromotionRouter, "other");
    // A client-sent user id names nobody; the listing is scoped to the caller.
    const { data } = await caller.getLinkPromotions({ limit: 30, userId: "promoter" } as never);
    expect(data).toEqual([]);
  });

  it("lists a player's own submissions", async () => {
    const caller = await callerFor(linkPromotionRouter, "promoter");
    const { data } = await caller.getLinkPromotions({ limit: 30 });
    expect(data.map((row) => row.id)).toEqual(["link"]);
  });

  it("grants the reward once when two reviewers submit at the same time", async () => {
    const db = await getTestDatabase();
    const results: boolean[] = [];
    const raced = beforeStatements(db, linkPromotion, [async () => {
      results.push((await (await callerFor(linkPromotionRouter, "owner-b")).reviewLinkPromotion({ id: "link", points: 50 })).success);
    }]);
    results.unshift((await callerForDatabase(linkPromotionRouter, "owner-a", raced).reviewLinkPromotion({ id: "link", points: 50 })).success);
    const promoter = await db.query.userData.findFirst({ where: eq(userData.userId, "promoter") });
    expect({ reputation: promoter?.reputationPoints, total: promoter?.reputationPointsTotal, results })
      .toEqual({ reputation: 50, total: 50, results: [false, true] });
  });
});
