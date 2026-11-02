import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { linkPromotion, userData } from "@/drizzle/schema";
import { linkPromotionRouter } from "@/server/api/routers/linkpromotion";
import { insertUsers } from "../../../setup/factories";
import { beforeStatements } from "../../../setup/statements";
import { callerFor, callerForDatabase, describeWithDatabase, getTestDatabase, resetTables } from "../../../setup/testDatabase";

describeWithDatabase("Link promotion review rewards", () => {
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
