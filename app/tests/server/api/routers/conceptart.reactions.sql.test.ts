import { beforeEach, expect, it } from "bun:test";
import { conceptImage, userData, userLikes } from "@/drizzle/schema";
import { conceptartRouter } from "@/server/api/routers/conceptart";
import { insertUsers } from "../../../setup/factories";
import { beforeStatements } from "../../../setup/statements";
import { callerFor, callerForDatabase, describeWithDatabase, getTestDatabase, resetTables } from "../../../setup/testDatabase";

describeWithDatabase("concept art reactions", () => {
  beforeEach(async () => {
    await resetTables(conceptImage, userData, userLikes);
    await insertUsers(["artist", "fan-a", "fan-b"].map((userId) => ({ userId, username: userId })));
    await (await getTestDatabase()).insert(conceptImage).values({
      id: "image", userId: "artist", prompt: "A ninja", status: "success", image: "https://example.com/ninja.webp",
    });
  });

  it("counts both reactions when two players react at the same time", async () => {
    const db = await getTestDatabase();
    const raced = beforeStatements(db, conceptImage, [async () => {
      expect((await (await callerFor(conceptartRouter, "fan-b")).toggleEmotion({ imageId: "image", type: "like" })).success).toBe(true);
    }]);
    const result = await callerForDatabase(conceptartRouter, "fan-a", raced).toggleEmotion({ imageId: "image", type: "like" });
    expect(result.success).toBe(true);
    expect((await db.query.conceptImage.findFirst())?.n_likes).toBe(2);
  });
});
