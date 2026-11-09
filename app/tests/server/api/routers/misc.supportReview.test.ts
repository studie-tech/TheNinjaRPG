import { beforeEach, expect, it } from "bun:test";
import { supportReview, userData } from "@/drizzle/schema";
import { miscRouter } from "@/server/api/routers/misc";
import { insertUsers } from "../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

const review = {
  apiRoute: "/api/support",
  chatHistory: [],
  sentiment: "POSITIVE" as const,
};

describeWithDatabase("support chat reviews", () => {
  beforeEach(async () => {
    await resetTables(supportReview, userData);
    await insertUsers([{ userId: "busy" }, { userId: "fresh" }]);
    await (await getTestDatabase()).insert(supportReview).values(
      Array.from({ length: 5 }, (_, i) => ({
        id: `r${i}`,
        userId: "busy",
        ...review,
      })),
    );
  });

  it("limits daily reviews per player, not across all players", async () => {
    expect(
      await (await callerFor(miscRouter, "fresh")).reviewSupportWithAI(review),
    ).toMatchObject({ success: true });
    expect(
      await (await callerFor(miscRouter, "busy")).reviewSupportWithAI(review),
    ).toMatchObject({
      success: false,
      message: "You have reached the maximum number of reviews for today",
    });
  });
});
