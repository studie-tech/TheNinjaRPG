import { beforeEach, expect, it } from "bun:test";
import { asc, eq } from "drizzle-orm";
import { item, userData, userItem } from "@/drizzle/schema";
import { updateRewards } from "@/server/utils/questRewards";
import { PostProcessedRewardSchema } from "@/validators/rewards";
import { insertItems, insertUserItems, insertUsers } from "../../setup/factories";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";

describeWithDatabase("updateRewards item stacks", () => {
  beforeEach(async () => {
    await resetTables(userItem, item, userData);
    await insertUsers([{ userId: "player" }]);
    await insertItems([{ id: "ore", name: "Ore", canStack: true, stackSize: 100 }]);
    await insertUserItems([
      { id: "ore-stack", userId: "player", itemId: "ore", quantity: 10 },
    ]);
  });

  it.each([false, true])(
    "adds rewarded items to the stack already carried (transaction %p)",
    async (inTransaction) => {
      const client = await getTestDatabase();
      const user = await client.query.userData.findFirst({
        where: eq(userData.userId, "player"),
      });
      const pay = (tx: typeof client) =>
        updateRewards({
          client: tx,
          user: user!,
          inTransaction,
          rewards: PostProcessedRewardSchema.parse({
            reward_items: ["ore", "ore", "ore"],
          }),
          reason: "QUEST",
        });
      const granted = inTransaction
        ? await client.transaction((tx) => pay(tx as typeof client))
        : await pay(client);
      const rows = await client
        .select({ id: userItem.id, quantity: userItem.quantity })
        .from(userItem)
        .orderBy(asc(userItem.id));
      expect(rows).toEqual([{ id: "ore-stack", quantity: 13 }]);
      expect(granted.items).toMatchObject([{ id: "ore", quantity: 3 }]);
    },
  );
});
