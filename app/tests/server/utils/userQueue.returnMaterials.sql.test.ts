import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { item, userData, userItem } from "@/drizzle/schema";
import { returnCraftMaterials } from "@/server/utils/userQueue";
import { insertItems, insertUserItems, insertUsers } from "../../setup/factories";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";

const USER_ID = "material-owner";

const stacks = async () =>
  (
    await (
      await getTestDatabase()
    )
      .select({ quantity: userItem.quantity })
      .from(userItem)
      .where(eq(userItem.userId, USER_ID))
  )
    .map((row) => row.quantity)
    .sort((a, b) => a - b);

describeWithDatabase("returned craft materials", () => {
  beforeEach(async () => {
    await resetTables(userItem, item, userData);
    await insertUsers([{ userId: USER_ID, username: "Owner" }]);
  });

  it("caps a zero stack size at one item per stack, as crafted output does", async () => {
    await insertItems([{ id: "ore", name: "Ore", stackSize: 0 }]);
    await insertUserItems([
      { id: "ore-a", userId: USER_ID, itemId: "ore", quantity: 1 },
    ]);
    await returnCraftMaterials(await getTestDatabase(), USER_ID, [
      { userItemId: "ore-a", itemId: "ore", quantity: 1, storedAtHome: false },
    ]);
    expect(await stacks()).toEqual([1, 1]);
  });

  it("merges returned materials into a stack with room", async () => {
    await insertItems([{ id: "ore", name: "Ore", stackSize: 5 }]);
    await insertUserItems([
      { id: "ore-a", userId: USER_ID, itemId: "ore", quantity: 1 },
    ]);
    await returnCraftMaterials(await getTestDatabase(), USER_ID, [
      { userItemId: "ore-a", itemId: "ore", quantity: 3, storedAtHome: false },
    ]);
    expect(await stacks()).toEqual([4]);
  });
});
