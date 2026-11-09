import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { actionLog, item, userData } from "@/drizzle/schema";
import { fetchItemWithCraftingRequirements } from "@/queries/item";
import { itemRouter } from "@/server/api/routers/item";
import { ItemValidator, NonCombatConsumeRewardTag } from "@/validators/combat";
import { insertItems, insertUsers } from "../../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

const reward = (patch: Record<string, unknown>) =>
  NonCombatConsumeRewardTag.parse(patch);

const storedReputation = async () => {
  const saved = await (await getTestDatabase()).query.item.findFirst({
    where: eq(item.id, "gift"),
  });
  return saved?.effects.map((effect) =>
    effect.type === "noncombatconsumereward" ? effect.reward_reputation : null,
  );
};

/** Save `effects` over the stored item as a content editor who may not award reputation. */
const saveEffects = async (effects: ReturnType<typeof reward>[]) => {
  const db = await getTestDatabase();
  const row = await fetchItemWithCraftingRequirements(db, "gift");
  const data = ItemValidator.parse({
    ...row,
    cost: 1,
    target: "SELF",
    method: "SINGLE",
    effects,
  });
  const result = await (await callerFor(itemRouter, "editor")).update({
    id: "gift",
    data,
  });
  expect(result.success).toBe(true);
};

describeWithDatabase("reputation rewards edited without award permission", () => {
  beforeEach(async () => {
    await resetTables(actionLog, item, userData);
    await insertUsers([{ userId: "editor", role: "CONTENT" }]);
    await insertItems([
      {
        id: "gift",
        name: "Gift",
        itemType: "CONSUMABLE",
        preventBattleUsage: true,
        destroyOnUse: true,
        cost: 1,
        target: "SELF",
        method: "SINGLE",
        effects: [
          reward({ reward_money: 5, reward_reputation: 7 }),
          reward({ reward_money: 5, reward_reputation: 3 }),
          reward({ reward_money: 9 }),
        ],
      },
    ]);
  });

  it("keeps stored reputation on matching effects, in stored order, when they move", async () => {
    await saveEffects([
      reward({ reward_money: 9 }),
      reward({ reward_money: 5 }),
      reward({ reward_money: 5 }),
    ]);
    expect(await storedReputation()).toEqual([0, 7, 3]);
  });

  it("clears reputation requested on a new or changed effect", async () => {
    await saveEffects([
      reward({ reward_money: 6, reward_reputation: 7 }),
      reward({ reward_money: 5, reward_reputation: 500 }),
    ]);
    expect(await storedReputation()).toEqual([0, 7]);
  });

  it("spends each stored value once when an effect is duplicated", async () => {
    await saveEffects([
      reward({ reward_money: 5 }),
      reward({ reward_money: 5 }),
      reward({ reward_money: 5 }),
    ]);
    expect(await storedReputation()).toEqual([7, 3, 0]);
  });
});
