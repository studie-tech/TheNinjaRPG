import { commitCacheConsumption } from "@/server/utils/cacheConsumption";
import { fetchItemWithCraftingRequirements } from "@/queries/item";
import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { actionLog, item, userData, userItem } from "@/drizzle/schema";
import { itemRouter } from "@/server/api/routers/item";
import type { DrizzleClient } from "@/server/db";
import { CACHE_RESTRICTED_REWARD_MESSAGE } from "@/libs/weightedCache";
import { ItemValidator, NonCombatConsumeRewardTag, RollRandomBloodline } from "@/validators/combat";
import { insertItems, insertUserItems, insertUsers } from "../../../../setup/factories";
import { callerForDatabase, describeWithDatabase, getTestDatabase, resetTables } from "../../../../setup/testDatabase";
import { inTransactions, failStatements, beforeTransaction } from "../../../../setup/statements";

/** Exercise repeated bundle grants across both stackable and non-stackable inventory rows. */
const cacheEffect = () => NonCombatConsumeRewardTag.parse({ rewardMode: "weightedCache", weightedCache: {
  version: 1, displayName: "Chakra Pill Cache",
  rolls: [{ count: 2, probability: 10_000 }],
  tiers: [{ name: "Common", probability: 10_000, entries: [{ items: [{ itemId: "pill", quantity: 3 }, { itemId: "gear", quantity: 2 }] }] }],
} });

/** Inject a failure at the reward insert, after the real consumption claim ran. */
const failingGrantClient = (client: DrizzleClient) =>
  inTransactions(client, (tx) => failStatements(tx, userItem, 1, { operations: ["insert"] }));

describeWithDatabase("weighted cache consumption", () => {
  beforeEach(async () => {
    await resetTables(actionLog, userItem, item, userData);
    await insertUsers([{ userId: "opener", username: "Opener", level: 50, status: "AWAKE", isOutlaw: true }]);
    await insertItems([
      { id: "cache", name: "Pill Cache", itemType: "CONSUMABLE", destroyOnUse: true, preventBattleUsage: true, effects: [cacheEffect()] },
      { id: "pill", name: "Chakra Pill", canStack: true, stackSize: 4, hidden: true },
      { id: "gear", name: "Gear", canStack: false },
    ]);
    await insertUserItems([{ id: "cache-stack", userId: "opener", itemId: "cache", quantity: 2 }]);
  });
  it("publishes recovery only for the receipt this request commits", async () => {
    const database = await getTestDatabase();
    let published = 0;
    const response = { success: true as const, message: "Opened", notifications: [], rewards: null, cacheRewards: [] };
    const request: Parameters<typeof commitCacheConsumption>[0] = { client: database, receiptId: "confirmed-recovery", userId: "opener",
      userItemId: "cache-stack", itemId: "cache", selections: [],
      consume: async () => response,
      onCommitted: (result) => { published++; return result; } };
    expect(await commitCacheConsumption(request)).toEqual(response);
    expect(published).toBe(1);
    expect(await commitCacheConsumption({ ...request, consume: async () => { throw new Error("A replay cannot consume"); } })).toEqual(response);
    expect(published).toBe(1);
    await expect(commitCacheConsumption({ ...request, receiptId: "rolled-back-recovery",
      consume: async () => { throw new Error("Rejected delivery"); } })).rejects.toThrow("Rejected delivery");
    expect(published).toBe(1);
    expect(await database.query.actionLog.findFirst({ where: eq(actionLog.id, "rolled-back-recovery") })).toBeUndefined();
  });

  it("replays the committed opening's recovery feedback without another debit", async () => {
    const database = await getTestDatabase();
    await database.update(userData).set({ status: "ASLEEP", autoWakeUp: true }).where(eq(userData.userId, "opener"));
    const caller = callerForDatabase(itemRouter, "opener", database);
    const input = { userItemId: "cache-stack", expectedQuantity: 2, requestId: "recovered-opening" };
    const response = await caller.consume(input);
    expect(response).toMatchObject({ success: true, actionNotice: "This action woke you up." });
    expect(await caller.consume(input)).toEqual(response);
    expect((await database.query.userItem.findFirst({ where: eq(userItem.id, "cache-stack") }))?.quantity).toBe(1);
  });

  it("grants bundles with stack limits and accurate combined quantities, then replays retries", async () => {
    const db = await getTestDatabase(); const caller = callerForDatabase(itemRouter, "opener", db);
    const input = { userItemId: "cache-stack", expectedQuantity: 2, requestId: "opening-request-1" };
    const response = await caller.consume(input);
    expect(response.success).toBe(true);
    if (!response.success || !("cacheRewards" in response)) throw new Error(response.message);
    expect(response.rewards?.reward_items.filter((name) => name === "Chakra Pill")).toHaveLength(6);
    expect(response.rewards?.reward_items.filter((name) => name === "Gear")).toHaveLength(4);
    expect(response.cacheRewards).toEqual([{ displayName: "Chakra Pill Cache", items: [{ name: "Chakra Pill", chance: 100 }, { name: "Gear", chance: 100 }] }]);
    expect(await caller.consume(input)).toEqual(response);
    const rows = await db.select().from(userItem);
    expect(rows.filter((row) => row.itemId === "pill").map((row) => row.quantity).sort()).toEqual([2, 4]);
    expect(rows.filter((row) => row.itemId === "gear")).toHaveLength(4);
    expect(rows.find((row) => row.id === "cache-stack")?.quantity).toBe(1);
    const logs = await db.select().from(actionLog);
    expect(logs).toHaveLength(1);
    expect(JSON.parse((logs[0]?.changes as string[])[0]!)).toMatchObject({ selections: [{ rollCount: 2, selections: [{ tierName: "Common", entryIndex: 0 }, { tierName: "Common", entryIndex: 0 }] }] });
  });
  it("deduplicates concurrent requests and replays the committed opening from a multi-unit stack", async () => {
    const db = await getTestDatabase(); const caller = callerForDatabase(itemRouter, "opener", db);
    const results = await Promise.all(Array.from({ length: 3 }, () => caller.consume({ userItemId: "cache-stack", requestId: "same-opening-request" })));
    // Passive regeneration can reject a stale account snapshot before another request commits.
    const committed = results.find((response) => response.success);
    expect(committed).toBeDefined();
    if (!committed) throw new Error("No request committed the opening");
    for (const _result of results) expect(await caller.consume({ userItemId: "cache-stack", requestId: "same-opening-request" })).toEqual(committed);
    expect((await db.select().from(userItem).where(eq(userItem.id, "cache-stack")))[0]?.quantity).toBe(1);
    expect(await db.select().from(actionLog)).toHaveLength(1);
  });
  it("lets only one concurrent distinct request claim a single cache", async () => {
    const db = await getTestDatabase(); await db.update(userItem).set({ quantity: 1 }).where(eq(userItem.id, "cache-stack"));
    const caller = callerForDatabase(itemRouter, "opener", db);
    const results = await Promise.all(["request-one", "request-two"].map((requestId) => caller.consume({ userItemId: "cache-stack", requestId })));
    expect(results.filter((response) => response.success)).toHaveLength(1);
    expect(await db.select().from(actionLog)).toHaveLength(1);
    expect((await db.select().from(userItem)).filter((row) => row.itemId === "pill").reduce((sum, row) => sum + row.quantity, 0)).toBe(6);
  });
  it("rolls back consumption, partial grants and receipt on failure and permits a safe retry", async () => {
    const db = await getTestDatabase(); const input = { userItemId: "cache-stack", requestId: "failed-opening-request" };
    const failing = callerForDatabase(itemRouter, "opener", failingGrantClient(db));
    await expect(failing.consume(input)).rejects.toThrow("Statement failed on purpose");
    expect((await db.select().from(userItem))).toHaveLength(1);
    expect((await db.select().from(userItem))[0]?.quantity).toBe(2);
    expect(await db.select().from(actionLog)).toHaveLength(0);
    expect((await callerForDatabase(itemRouter, "opener", db).consume(input)).success).toBe(true);
  });
  it("rejects missing references and malformed stored configurations before consuming", async () => {
    const db = await getTestDatabase(); const caller = callerForDatabase(itemRouter, "opener", db);
    await db.delete(item).where(eq(item.id, "pill"));
    expect((await caller.consume({ userItemId: "cache-stack", requestId: "missing-reference" })).success).toBe(false);
    const effect = cacheEffect(); effect.weightedCache!.rolls[0]!.probability = 9999;
    await db.update(item).set({ effects: [effect] }).where(eq(item.id, "cache"));
    expect((await caller.consume({ userItemId: "cache-stack", requestId: "invalid-configuration" })).success).toBe(false);
    expect((await db.select().from(userItem))[0]?.quantity).toBe(2);
    expect(await db.select().from(actionLog)).toHaveLength(0);
  });
  it("rejects unsupported stored modes instead of granting retained standard rewards", async () => {
    const db = await getTestDatabase();
    const effect = { ...cacheEffect(), reward_money: 99, rewardMode: "weightedCacheV2" };
    await db.update(item).set({ effects: [effect] as never }).where(eq(item.id, "cache"));
    const response = await callerForDatabase(itemRouter, "opener", db).consume({ userItemId: "cache-stack", requestId: "unsupported-reward-mode" });
    expect(response).toMatchObject({ success: false, message: "This item has an unsupported reward mode. Please contact staff." });
    expect((await db.select().from(userItem))[0]?.quantity).toBe(2);
    expect(await db.select().from(actionLog)).toHaveLength(0);
  });
  it("supports multiple cache effects, self-rewards and standard rewards together", async () => {
    const db = await getTestDatabase(); const effect = cacheEffect(); effect.weightedCache!.tiers[0]!.entries = [{ items: [{ itemId: "cache", quantity: 1 }] }];
    await db.update(item).set({ effects: [cacheEffect(), effect, NonCombatConsumeRewardTag.parse({ reward_money: 7, reward_items: [{ ids: ["pill"], number: 100, quantity: 1 }] })] }).where(eq(item.id, "cache"));
    const response = await callerForDatabase(itemRouter, "opener", db).consume({ userItemId: "cache-stack", requestId: "multiple-cache-effects" });
    expect(response.success).toBe(true);
    if (!response.success || !("cacheRewards" in response)) throw new Error(response.message);
    expect(response.rewards?.reward_items.filter((name) => name === "Pill Cache")).toHaveLength(2);
    expect(response.rewards?.reward_items.filter((name) => name === "Chakra Pill")).toHaveLength(7);
    expect(response.rewards?.reward_money).toBe(7);
  });
  it.each([
    ["reputation", NonCombatConsumeRewardTag.parse({ reward_reputation: 5 })],
    ["bloodline grant", NonCombatConsumeRewardTag.parse({ reward_bloodlines: ["bloodline"] })],
    ["bloodline roll", RollRandomBloodline.parse({})],
  ])("rejects a sibling %s effect in validation and before opening", async (_label, forbidden) => {
    const db = await getTestDatabase(); const caller = callerForDatabase(itemRouter, "opener", db);
    const effects = [cacheEffect(), forbidden];
    await db.update(item).set({ effects }).where(eq(item.id, "cache"));
    const row = await fetchItemWithCraftingRequirements(db, "cache");
    const parsed = ItemValidator.safeParse({ ...row, cost: 1, target: "SELF", method: "SINGLE" });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.some((issue) => issue.message === CACHE_RESTRICTED_REWARD_MESSAGE)).toBe(true);
    expect(await caller.consume({ userItemId: "cache-stack", requestId: "forbidden-sibling" })).toMatchObject({ success: false, message: CACHE_RESTRICTED_REWARD_MESSAGE });
    expect((await db.select().from(userItem))).toHaveLength(1);
    expect((await db.select().from(userItem))[0]?.quantity).toBe(2);
    expect(await db.select().from(actionLog)).toHaveLength(0);
  });
  it.each([
    ["linked bloodline", { bloodlineId: "bloodline" }],
    ["reputation consumable", { effects: [NonCombatConsumeRewardTag.parse({ reward_reputation: 5 })] }],
    ["bloodline consumable", { effects: [NonCombatConsumeRewardTag.parse({ reward_bloodlines: ["bloodline"] })] }],
    ["bloodline roll", { effects: [RollRandomBloodline.parse({})] }],
  ])("rejects a rewarded item with %s on save and after catalog edits", async (_label, forbidden) => {
    const db = await getTestDatabase(); const caller = callerForDatabase(itemRouter, "opener", db);
    await db.update(userData).set({ role: "CONTENT-ADMIN" }).where(eq(userData.userId, "opener"));
    await db.update(item).set(forbidden).where(eq(item.id, "gear"));
    const row = await fetchItemWithCraftingRequirements(db, "cache");
    const data = ItemValidator.parse({ ...row, cost: 1, target: "SELF", method: "SINGLE" });
    expect(await caller.update({ id: "cache", data })).toMatchObject({ success: false, message: `${CACHE_RESTRICTED_REWARD_MESSAGE}: Gear` });
    expect(await caller.consume({ userItemId: "cache-stack", requestId: "forbidden-catalog" })).toMatchObject({ success: false, message: CACHE_RESTRICTED_REWARD_MESSAGE });
    expect((await db.select().from(userItem))[0]?.quantity).toBe(2);
    expect(await db.select().from(actionLog)).toHaveLength(0);
  });
  it("checks nested reward containers and cycles without hiding a forbidden descendant", async () => {
    const db = await getTestDatabase(); const caller = callerForDatabase(itemRouter, "opener", db);
    await insertItems([{ id: "nested", name: "Nested", effects: [NonCombatConsumeRewardTag.parse({ reward_reputation: 1 })] }]);
    await db.update(item).set({ effects: [NonCombatConsumeRewardTag.parse({ reward_items: [{ ids: ["cache", "nested"], number: 100, quantity: 1 }] })] }).where(eq(item.id, "gear"));
    expect(await caller.consume({ userItemId: "cache-stack", requestId: "nested-forbidden" })).toMatchObject({ success: false, message: CACHE_RESTRICTED_REWARD_MESSAGE });
    expect((await db.select().from(userItem))[0]?.quantity).toBe(2);
    expect(await db.select().from(actionLog)).toHaveLength(0);
    await db.update(item).set({ effects: [] }).where(eq(item.id, "nested"));
    expect((await caller.consume({ userItemId: "cache-stack", requestId: "nested-allowed" })).success).toBe(true);
  });
  it.each([false, true])("validates retained cache pools when another cache is active: %s", async (hasActive) => {
    const db = await getTestDatabase(); const caller = callerForDatabase(itemRouter, "opener", db);
    await db.update(userData).set({ role: "CONTENT-ADMIN" }).where(eq(userData.userId, "opener"));
    await db.update(item).set({ bloodlineId: "bloodline" }).where(eq(item.id, "gear"));
    const active = cacheEffect(); active.weightedCache!.tiers[0]!.entries = [{ items: [{ itemId: "pill", quantity: 1 }] }];
    const row = await fetchItemWithCraftingRequirements(db, "cache");
    const data = ItemValidator.parse({ ...row, cost: 1, target: "SELF", method: "SINGLE", effects: [...(hasActive ? [active] : []), { ...cacheEffect(), rewardMode: "standard" }] });
    expect(await caller.update({ id: "cache", data })).toMatchObject({ success: false, message: `${CACHE_RESTRICTED_REWARD_MESSAGE}: Gear` });
  });
  it.each(["reward_items", "reward_hunter_items", "reward_gathering_items"] as const)("checks sibling %s rewards, including dynamic pools", async (field) => {
    const db = await getTestDatabase();
    await insertItems([{ id: "forbidden", name: "Forbidden", bloodlineId: "bloodline", canBeHunted: true, canBeGathered: true }]);
    const sibling = NonCombatConsumeRewardTag.parse(field === "reward_items" ? { reward_items: [{ ids: ["forbidden"], number: 100, quantity: 1 }] } : { [field]: true });
    await db.update(item).set({ effects: [cacheEffect(), sibling] }).where(eq(item.id, "cache"));
    expect(await callerForDatabase(itemRouter, "opener", db).consume({ userItemId: "cache-stack", requestId: "sibling-item-source" })).toMatchObject({ success: false, message: CACHE_RESTRICTED_REWARD_MESSAGE });
    expect((await db.select().from(userItem))[0]?.quantity).toBe(2);
    expect(await db.select().from(actionLog)).toHaveLength(0);
  });
  it.each([
    { field: "reward_hunter_items", nested: false }, { field: "reward_gathering_items", nested: false },
    { field: "reward_hunter_items", nested: true }, { field: "reward_gathering_items", nested: true },
  ] as const)("checks combined $field allowlists on save and consume (nested: $nested)", async ({ field, nested }) => {
    const db = await getTestDatabase(); const caller = callerForDatabase(itemRouter, "opener", db);
    await db.update(userData).set({ role: "CONTENT-ADMIN", occupation: field === "reward_hunter_items" ? "HUNTER" : "GATHERING" }).where(eq(userData.userId, "opener"));
    await insertItems([{ id: "forbidden", name: "Forbidden", bloodlineId: "bloodline", canBeHunted: true, canBeGathered: true }]);
    const siblings = [
      NonCombatConsumeRewardTag.parse({ [field]: true, [`${field}_ids`]: ["pill"] }),
      NonCombatConsumeRewardTag.parse({ [field]: false, [`${field}_ids`]: ["forbidden"] }),
    ];
    await db.update(item).set({ effects: nested ? siblings : [cacheEffect(), ...siblings] }).where(eq(item.id, nested ? "gear" : "cache"));
    const row = await fetchItemWithCraftingRequirements(db, "cache");
    const data = ItemValidator.parse({ ...row, cost: 1, target: "SELF", method: "SINGLE" });
    const save = await caller.update({ id: "cache", data });
    const consume = await caller.consume({ userItemId: "cache-stack", requestId: "combined-material-allowlist" });
    expect({ save, consume }).toMatchObject({
      save: { success: false, message: `${CACHE_RESTRICTED_REWARD_MESSAGE}: Forbidden` },
      consume: { success: false, message: CACHE_RESTRICTED_REWARD_MESSAGE },
    });
    expect((await db.select().from(userItem))).toHaveLength(1);
    expect((await db.select().from(userItem))[0]?.quantity).toBe(2);
    expect(await db.select().from(actionLog)).toHaveLength(0);
  });
  it.each(["reward_hunter_items", "reward_gathering_items"] as const)("uses a sibling allowlist to narrow an enabled empty %s pool", async (field) => {
    const db = await getTestDatabase(); const caller = callerForDatabase(itemRouter, "opener", db);
    await db.update(userData).set({ role: "CONTENT-ADMIN", occupation: field === "reward_hunter_items" ? "HUNTER" : "GATHERING" }).where(eq(userData.userId, "opener"));
    await insertItems([{ id: "forbidden", name: "Forbidden", bloodlineId: "bloodline", canBeHunted: true, canBeGathered: true }]);
    const effects = [cacheEffect(),
      NonCombatConsumeRewardTag.parse({ [field]: true }),
      NonCombatConsumeRewardTag.parse({ [field]: false, [`${field}_ids`]: ["pill"] }),
    ];
    const row = await fetchItemWithCraftingRequirements(db, "cache");
    const data = ItemValidator.parse({ ...row, cost: 1, target: "SELF", method: "SINGLE", effects });
    expect((await caller.update({ id: "cache", data })).success).toBe(true);
    expect((await caller.consume({ userItemId: "cache-stack", requestId: "narrowed-material-pool" })).success).toBe(true);
    expect((await db.select().from(userItem)).some((row) => row.itemId === "forbidden")).toBe(false);
  });
  it.each(["reward_hunter_items", "reward_gathering_items"] as const)("keeps nested %s pools independent of another container's allowlist", async (field) => {
    const db = await getTestDatabase(); const caller = callerForDatabase(itemRouter, "opener", db);
    await db.update(userData).set({ role: "CONTENT-ADMIN" }).where(eq(userData.userId, "opener"));
    await insertItems([{ id: "forbidden", name: "Forbidden", bloodlineId: "bloodline", canBeHunted: true, canBeGathered: true }]);
    await db.update(item).set({ effects: [NonCombatConsumeRewardTag.parse({ [field]: true })] }).where(eq(item.id, "pill"));
    await db.update(item).set({ effects: [NonCombatConsumeRewardTag.parse({ [field]: false, [`${field}_ids`]: ["gear"] })] }).where(eq(item.id, "gear"));
    const row = await fetchItemWithCraftingRequirements(db, "cache");
    const data = ItemValidator.parse({ ...row, cost: 1, target: "SELF", method: "SINGLE" });
    expect(await caller.update({ id: "cache", data })).toMatchObject({ success: false, message: `${CACHE_RESTRICTED_REWARD_MESSAGE}: Forbidden` });
    expect(await caller.consume({ userItemId: "cache-stack", requestId: "independent-material-pools" })).toMatchObject({ success: false, message: CACHE_RESTRICTED_REWARD_MESSAGE });
    expect((await db.select().from(userItem))[0]?.quantity).toBe(2);
    expect(await db.select().from(actionLog)).toHaveLength(0);
  });
  it.each(["reward_hunter_items", "reward_gathering_items"] as const)("does not activate a different container's disabled %s pool", async (field) => {
    const db = await getTestDatabase(); const caller = callerForDatabase(itemRouter, "opener", db);
    await db.update(userData).set({ role: "CONTENT-ADMIN" }).where(eq(userData.userId, "opener"));
    await insertItems([{ id: "forbidden", name: "Forbidden", bloodlineId: "bloodline", canBeHunted: true, canBeGathered: true }]);
    await db.update(item).set({ effects: [NonCombatConsumeRewardTag.parse({ [field]: true, [`${field}_ids`]: ["pill"] })] }).where(eq(item.id, "pill"));
    await db.update(item).set({ effects: [NonCombatConsumeRewardTag.parse({ [field]: false, [`${field}_ids`]: ["forbidden"] })] }).where(eq(item.id, "gear"));
    const row = await fetchItemWithCraftingRequirements(db, "cache");
    const data = ItemValidator.parse({ ...row, cost: 1, target: "SELF", method: "SINGLE" });
    expect((await caller.update({ id: "cache", data })).success).toBe(true);
    expect((await caller.consume({ userItemId: "cache-stack", requestId: "inactive-nested-material-pool" })).success).toBe(true);
    expect((await db.select().from(userItem)).some((row) => row.itemId === "forbidden")).toBe(false);
  });
  it("ignores retained Standard grants in cache mode and preserves ordinary reputation consumables", async () => {
    const db = await getTestDatabase(); const caller = callerForDatabase(itemRouter, "opener", db);
    const effect = { ...cacheEffect(), reward_reputation: 5, reward_bloodlines: ["bloodline"] };
    await db.update(item).set({ effects: [effect] }).where(eq(item.id, "cache"));
    const before = await db.query.userData.findFirst({ where: eq(userData.userId, "opener") });
    expect((await caller.consume({ userItemId: "cache-stack", requestId: "inactive-standard-grants" })).success).toBe(true);
    const after = await db.query.userData.findFirst({ where: eq(userData.userId, "opener") });
    expect(after?.reputationPoints).toBe(before?.reputationPoints);
    expect(after?.bloodlineId).toBe(before?.bloodlineId);
    await db.update(item).set({ effects: [NonCombatConsumeRewardTag.parse({ reward_reputation: 5 })] }).where(eq(item.id, "cache"));
    expect((await caller.consume({ userItemId: "cache-stack" })).success).toBe(true);
    expect((await db.query.userData.findFirst({ where: eq(userData.userId, "opener") }))?.reputationPoints).toBe((before?.reputationPoints ?? 0) + 5);
  });
});

describeWithDatabase("cache grant catalog races", () => {
  it("rolls back the opening if an item disappears between validation and delivery", async () => {
    const db = await getTestDatabase();
    await resetTables(actionLog, userItem, item, userData);
    await insertUsers([{ userId: "opener", username: "Opener", level: 50, status: "AWAKE", isOutlaw: true }]);
    await insertItems([{ id: "cache", itemType: "CONSUMABLE", effects: [cacheEffect()] }, { id: "pill", name: "Pill" }, { id: "gear", name: "Gear" }]);
    await insertUserItems([{ id: "cache-stack", userId: "opener", itemId: "cache", quantity: 1 }]);
    const racing = beforeTransaction(db, () => db.delete(item).where(eq(item.id, "pill")));
    await expect(callerForDatabase(itemRouter, "opener", racing).consume({ userItemId: "cache-stack", requestId: "deleted-during-delivery" })).rejects.toThrow("Cache reward became unavailable during delivery");
    expect((await db.select().from(userItem))).toHaveLength(1);
    expect((await db.select().from(userItem))[0]?.quantity).toBe(1);
    expect(await db.select().from(actionLog)).toHaveLength(0);
  });
});
