import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import { actionLog, aiProfile, battle, battleHistory, huntingHabitat, huntingProgress, huntingSession, item, sectorMap, userData, userItem } from "@/drizzle/schema";
import { Pusher } from "@/libs/pusher";
import { huntingRouter } from "@/routers/hunting";
import { IncreaseHuntingYield } from "@/validators/combat";
import { insertItems, insertUserItems, insertUsers } from "../../setup/factories";
import { huntingContract, huntingHabitatContent, huntingMap } from "../../setup/hunting";
import type { DrizzleClient } from "@/server/db";
import { beforeStatements, failStatements } from "../../setup/statements";
import { callerFor, callerForDatabase, describeWithDatabase, getTestDatabase, resetTables } from "../../setup/testDatabase";

describeWithDatabase("Hunting lifecycle", () => {
  beforeEach(async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json([{ result: [59, 60] }]));
    await resetTables(actionLog, aiProfile, battle, battleHistory, huntingHabitat, huntingProgress, huntingSession, item, sectorMap, userData, userItem);
    await insertUsers([{ userId: "hunter", occupation: "HUNTER", status: "AWAKE", huntingExperience: 123, sector: 1 }, { userId: "staff", role: "CODING-ADMIN" }, { userId: "enemy", isAi: true }]);
    await insertItems([{ id: "hide", canBeHunted: true }, { id: "tusk", canBeHunted: true }]);
    const db = await getTestDatabase();
    const content = huntingHabitatContent();
    content.contracts.push({ ...huntingContract(), id: "second" });
    await db.insert(huntingHabitat).values({ id: "forest", content, updatedAt: new Date() });
    await db.insert(sectorMap).values({ id: "map", sector: 1, name: "Forest", width: 1, height: 1, status: "PUBLISHED", normalizedJson: huntingMap() });
  });
  afterEach(() => vi.restoreAllMocks());
  const accept = async () => {
    const hunter = await callerFor(huntingRouter, "hunter");
    expect(await hunter.accept({ habitatId: "forest", contractId: "contract", version: null })).toMatchObject({ success: true, userPatch: {} });
    const session = (await hunter.getBoard()).session;
    if (!session) throw Error("Missing session");
    return { hunter, session };
  };
  it("persists a personal location on refresh and reserves only one session", async () => {
    const hunter = await callerFor(huntingRouter, "hunter");
    const results = await Promise.all(["contract", "second"].map((contractId) => hunter.accept({ habitatId: "forest", contractId, version: null })));
    expect(results.filter((r) => r.success)).toHaveLength(1);
    const first = (await hunter.getBoard()).session;
    expect((await hunter.getBoard()).session).toEqual(first);
    expect(await (await getTestDatabase()).query.huntingSession.findMany()).toHaveLength(1);
  });
  it("loads only the caller's accepted terms even after the habitat is disabled", async () => {
    const { hunter, session } = await accept();
    const staff = await callerFor(huntingRouter, "staff");
    expect(await staff.getSession()).toBeNull();
    expect(await hunter.getSession()).toMatchObject({ session: { id: session.id, sector: 1 }, contract: { name: "Forest boar" }, allowance: { used: 0, remaining: 3, cooling: false } });
    const db = await getTestDatabase();
    await db.update(huntingProgress).set({ used: 3, cooldownUntil: new Date(Date.now() + 60_000) });
    expect(await hunter.getSession()).toMatchObject({ allowance: { used: 3, remaining: 0, cooling: true } });
    await db.update(huntingHabitat).set({ content: { ...huntingHabitatContent(), enabled: false } });
    expect(await hunter.getSession()).toMatchObject({ session: { id: session.id }, contract: { name: "Forest boar" }, allowance: { used: 3, remaining: 0, cooling: true } });
    expect(await hunter.sessionAction({ id: session.id, version: session.version, action: "finish" })).toMatchObject({ success: true, userPatch: {} });
    expect(await hunter.getSession()).toBeNull();
  });
  it("limits acceptance map payloads to contract sectors and skips them for unchanged or rejected sessions", async () => {
    const db = await getTestDatabase();
    await db.insert(sectorMap).values({ id: "unrelated-map", sector: 2, name: "Other sector", width: 1, height: 1, status: "PUBLISHED", normalizedJson: { ...huntingMap(), sector: 2 } });
    const mapReads = vi.spyOn(db.query.sectorMap, "findMany");
    const hunter = await callerFor(huntingRouter, "hunter");
    expect((await hunter.accept({ habitatId: "forest", contractId: "contract", version: null })).success).toBe(true);
    expect(mapReads).toHaveBeenCalledTimes(1);
    expect(await mapReads.mock.results[0]?.value).toEqual([{ sector: 1, normalizedJson: huntingMap() }]);
    mapReads.mockClear();
    const session = (await hunter.getBoard()).session!;
    expect(await hunter.accept({ habitatId: "forest", contractId: "contract", version: session.version })).toMatchObject({ success: true, message: "Your existing encounter is still assigned." });
    expect((await hunter.accept({ habitatId: "forest", contractId: "second", version: null })).success).toBe(false);
    expect(await hunter.start({ id: session.id })).toMatchObject({ success: false, message: "Finish preparing before starting combat." });
    expect(mapReads).not.toHaveBeenCalled();
  });
  it("rejects unpublished encounter maps without loading another sector's published map", async () => {
    const { hunter, session } = await accept();
    const db = await getTestDatabase();
    await db.update(huntingSession).set({ readyAt: new Date(0) });
    await db.insert(sectorMap).values({ id: "unrelated-map", sector: 2, name: "Other sector", width: 1, height: 1, status: "PUBLISHED", normalizedJson: { ...huntingMap(), sector: 2 } });
    await db.update(sectorMap).set({ status: "DRAFT" }).where(eq(sectorMap.id, "map"));
    const mapReads = vi.spyOn(db.query.sectorMap, "findMany");
    expect(await hunter.accept({ habitatId: "forest", contractId: "second", version: session.version })).toMatchObject({ success: false, message: "There are no approved reachable locations for this contract." });
    expect(await hunter.start({ id: session.id })).toMatchObject({ success: false, message: "The encounter location is no longer approved. Select another contract." });
    expect(mapReads).toHaveBeenCalledTimes(2);
    for (const read of mapReads.mock.results) expect(await read.value).toEqual([]);
    expect(await db.query.battle.findMany()).toHaveLength(0);
    expect(await db.query.huntingSession.findFirst()).toMatchObject({ id: session.id, battleId: null });
  });
  it("returns only the creatures and materials referenced by visible contracts", async () => {
    await insertUsers([{ userId: "unlisted-ai", username: "unlisted-ai", isAi: true }]);
    await insertItems([{ id: "unlisted-material", name: "Unlisted material", canBeHunted: true }]);
    const hunter = await callerFor(huntingRouter, "hunter");
    const board = await hunter.getBoard();
    expect(board.creatures.map((c) => c.userId)).toEqual(["enemy"]);
    expect(board.materials.map((m) => m.id).sort()).toEqual(["hide", "tusk"]);
    const staff = await callerFor(huntingRouter, "staff");
    expect(await staff.getBoard()).toMatchObject({ habitats: [], creatures: [], materials: [] });
  });
  it("preserves partial allowances when switching or finishing, and prepares each new session once", async () => {
    const { hunter, session } = await accept();
    const db = await getTestDatabase();
    await db.update(huntingProgress).set({ used: 2 });
    expect((await hunter.sessionAction({ id: session.id, version: session.version, action: "prepare" })).success).toBe(true);
    const prepared = (await hunter.getBoard()).session;
    if (!prepared) throw Error("Missing prepared session");
    expect((await hunter.sessionAction({ id: prepared.id, version: prepared.version, action: "prepare" })).success).toBe(true);
    expect((await hunter.getBoard()).session?.readyAt).toEqual(prepared.readyAt);
    expect((await hunter.accept({ habitatId: "forest", contractId: "second", version: prepared.version })).success).toBe(true);
    const switched = (await hunter.getBoard()).session;
    expect(switched?.readyAt).toBeNull();
    expect((await db.query.huntingProgress.findFirst({ where: eq(huntingProgress.contractId, "contract") }))?.used).toBe(2);
    if (!switched) throw Error("Missing session");
    expect((await hunter.sessionAction({ id: switched.id, version: switched.version, action: "finish" })).success).toBe(true);
    expect((await db.query.huntingProgress.findFirst({ where: eq(huntingProgress.contractId, "contract") }))?.used).toBe(2);
    expect((await db.query.userData.findFirst({ where: eq(userData.userId, "hunter") }))?.huntingExperience).toBe(123);
  });
  it("rejects wrong sector, rank, occupation and unprepared encounter starts", async () => {
    const { hunter, session } = await accept();
    expect((await hunter.start({ id: session.id })).success).toBe(false);
    const db = await getTestDatabase();
    await db.update(userData).set({ sector: 2 }).where(eq(userData.userId, "hunter"));
    expect((await hunter.sessionAction({ id: session.id, version: session.version, action: "prepare" })).success).toBe(false);
    await db.update(userData).set({ occupation: "GATHERING", sector: 1 }).where(eq(userData.userId, "hunter"));
    expect((await hunter.accept({ habitatId: "forest", contractId: "second", version: session.version })).success).toBe(false);
  });
  it("snapshots the static yield at battle initiation without creating a combat effect", async () => {
    const { hunter, session } = await accept();
    const db = await getTestDatabase();
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    await db
      .insert(aiProfile)
      .values({ id: "Default", userId: "default-ai", rules: [] });
    await db
      .update(userData)
      .set({ rank: "JONIN", level: 50, isOutlaw: true, regeneration: 0 })
      .where(eq(userData.userId, "hunter"));
    await db.update(huntingSession).set({ readyAt: new Date(0) });
    await insertItems([
      {
        id: "hunt-gear",
        name: "Hunting bonus armor",
        itemType: "ARMOR",
        maxDurability: 100,
        effects: [IncreaseHuntingYield.parse({ power: 2 })],
      },
    ]);
    await insertUserItems([
      {
        id: "hunt-gear-owned",
        itemId: "hunt-gear",
        userId: "hunter",
        equipped: "CHEST",
        durability: 100,
      },
    ]);
    expect((await hunter.start({ id: session.id })).success).toBe(true);
    const snapshot = await db.query.battle.findFirst();
    expect(snapshot?.extraState.hunting?.huntingBonusQuantity).toBe(2);
    expect(
      snapshot?.usersEffects.some((effect) => effect.type === "increasehuntingyield"),
    ).toBe(false);
    await db
      .update(userItem)
      .set({ equipped: "NONE" })
      .where(eq(userItem.id, "hunt-gear-owned"));
    expect(
      (await db.query.battle.findFirst())?.extraState.hunting?.huntingBonusQuantity,
    ).toBe(2);
  });
  it("rejects an exhausted stale preload and permits a fresh allowance after cooldown", async () => {
    const { hunter, session } = await accept();
    const db = await getTestDatabase();
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    await db.insert(aiProfile).values({ id: "Default", userId: "default-ai", rules: [] });
    await db.update(userData).set({ rank: "JONIN", level: 50, isOutlaw: true, regeneration: 0 }).where(eq(userData.userId, "hunter"));
    await db.update(huntingSession).set({ readyAt: new Date(0) });
    await db.update(huntingProgress).set({ used: 2 });
    const cooldownUntil = new Date(Date.now() + 60_000);
    const query = new Proxy(db.query, { get(target, key, receiver) {
      if (key === "huntingProgress") return {
        findMany: async (...args: Parameters<typeof target.huntingProgress.findMany>) => {
          const stale = await target.huntingProgress.findMany(...args);
          // Advance the allowance after its parallel read, as a final victory does.
          await db.update(huntingProgress).set({ used: 3, version: 1, cooldownUntil });
          return stale;
        },
      };
      return Reflect.get(target, key, receiver);
    } });
    const client = new Proxy(db, { get(target, key, receiver) {
      return key === "query" ? query : Reflect.get(target, key, receiver);
    } });
    expect(await callerForDatabase(huntingRouter, "hunter", client).start({ id: session.id })).toMatchObject({ success: false, message: "Your hunting session changed. Refresh the board and try again." });
    expect(await db.query.battle.findMany()).toHaveLength(0);
    expect(await db.query.battleHistory.findMany()).toHaveLength(0);
    expect(await db.query.huntingSession.findFirst()).toMatchObject({ id: session.id, version: session.version, battleId: null });
    expect(await db.query.userData.findFirst({ where: eq(userData.userId, "hunter") })).toMatchObject({ status: "AWAKE", battleId: null });
    expect(await db.query.huntingProgress.findFirst()).toMatchObject({ used: 3, version: 1, cooldownUntil });
    await db.update(huntingProgress).set({ cooldownUntil: new Date(0) });
    const mapReads = vi.spyOn(db.query.sectorMap, "findMany");
    expect((await hunter.start({ id: session.id })).success).toBe(true);
    expect(await mapReads.mock.results[0]?.value).toEqual([{ sector: 1, normalizedJson: huntingMap() }]);
  });
  it("enforces staff authorization and validates published reachable locations", async () => {
    const hunter = await callerFor(huntingRouter, "hunter");
    const content = huntingHabitatContent();
    expect((await hunter.save({ id: "forest", content })).success).toBe(false);
    const staff = await callerFor(huntingRouter, "staff");
    expect((await staff.save({ id: "forest", content: { ...content, sectors: [2], contracts: [] } })).success).toBe(false);
    expect((await staff.save({ id: "forest", content })).success).toBe(true);
  });
  it("reports missing habitats on save or delete without logging a change", async () => {
    const staff = await callerFor(huntingRouter, "staff");
    const db = await getTestDatabase();
    await db.delete(huntingHabitat).where(eq(huntingHabitat.id, "forest"));
    expect(await staff.save({ id: "forest", content: huntingHabitatContent() })).toMatchObject({ success: false, message: "Habitat not found. Refresh the editor." });
    expect(await staff.delete({ id: "forest" })).toMatchObject({ success: false, message: "Habitat not found. Refresh the editor." });
    expect(await db.query.actionLog.findMany()).toHaveLength(0);
  });
  it("preserves habitats with active sessions and logs only successful deletion", async () => {
    const { hunter, session } = await accept();
    const staff = await callerFor(huntingRouter, "staff");
    const db = await getTestDatabase();
    expect(await staff.delete({ id: "forest" })).toMatchObject({ success: false, message: "This habitat has active sessions. Disable it instead." });
    expect(await db.query.huntingHabitat.findFirst()).toMatchObject({ id: "forest" });
    expect(await db.query.actionLog.findMany()).toHaveLength(0);
    expect((await hunter.sessionAction({ id: session.id, version: session.version, action: "finish" })).success).toBe(true);
    expect(await staff.delete({ id: "forest" })).toMatchObject({ success: true, message: "Habitat deleted." });
    expect(await db.query.huntingHabitat.findMany()).toHaveLength(0);
    expect(await db.query.actionLog.findMany()).toMatchObject([{ relatedId: "forest", relatedMsg: "Deleted hunting habitat" }]);
  });
  it.each(["finish", "switch"] as const)("keeps active allowances unchanged on edits and reconciles reduced limits on %s", async (action) => {
    const { hunter, session } = await accept();
    const db = await getTestDatabase();
    await db.update(huntingProgress).set({ used: 2 });
    const staff = await callerFor(huntingRouter, "staff");
    const content = huntingHabitatContent();
    content.contracts[0]!.hunts = 2;
    content.contracts.push({ ...huntingContract(), id: "second" });
    expect((await staff.save({ id: "forest", content })).success).toBe(true);
    expect(await db.query.huntingProgress.findFirst()).toMatchObject({ used: 2, cooldownUntil: null, version: 0 });
    expect(await hunter.getSession()).toMatchObject({ contract: { hunts: 3 }, allowance: { remaining: 1, cooling: false } });
    const result = action === "finish"
      ? await hunter.sessionAction({ id: session.id, version: session.version, action: "finish" })
      : await hunter.accept({ habitatId: "forest", contractId: "second", version: session.version });
    expect(result.success).toBe(true);
    const progress = await db.query.huntingProgress.findFirst({ where: eq(huntingProgress.contractId, "contract") });
    expect(progress?.cooldownUntil?.getTime()).toBeGreaterThan(Date.now());
    expect(progress?.version).toBe(1);
  });

  it("reconciles current limits when a staff save overlaps finishing the old contract", async () => {
    const { session } = await accept();
    const db = await getTestDatabase();
    await db.update(huntingProgress).set({ used: 2 });
    const client = withTransactionStatements(db, (client) => beforeStatements(client, huntingSession, [async () => {
      const content = huntingHabitatContent();
      content.contracts[0]!.hunts = 1;
      expect((await (await callerFor(huntingRouter, "staff")).save({ id: "forest", content })).success).toBe(true);
    }]));
    expect((await callerForDatabase(huntingRouter, "hunter", client).sessionAction({ id: session.id, version: session.version, action: "finish" })).success).toBe(true);
    expect((await db.query.huntingProgress.findFirst())?.cooldownUntil?.getTime()).toBeGreaterThan(Date.now());
  });

  it.each(["finish", "switch"] as const)("keeps the old session and allowance when %s fails", async (action) => {
    const { hunter, session } = await accept();
    const db = await getTestDatabase();
    await db.update(huntingProgress).set({ used: 2 });
    const content = huntingHabitatContent();
    content.contracts[0]!.hunts = 1;
    content.contracts.push({ ...huntingContract(), id: "second" });
    expect((await (await callerFor(huntingRouter, "staff")).save({ id: "forest", content })).success).toBe(true);
    const before = await db.query.huntingProgress.findFirst({ where: eq(huntingProgress.contractId, "contract") });
    const client = action === "finish"
      ? withTransactionStatements(db, (client) => failStatements(client, huntingProgress))
      : failStatements(db, huntingSession);
    const failing = callerForDatabase(huntingRouter, "hunter", client);
    const run = (caller: typeof hunter) => action === "finish"
      ? caller.sessionAction({ id: session.id, version: session.version, action: "finish" })
      : caller.accept({ habitatId: "forest", contractId: "second", version: session.version });
    await expect(run(failing)).rejects.toThrow("Statement failed on purpose");
    expect(await db.query.huntingSession.findFirst()).toEqual(session);
    expect(await db.query.huntingProgress.findFirst({ where: eq(huntingProgress.contractId, "contract") })).toEqual(before);
    expect((await run(hunter)).success).toBe(true);
    expect((await db.query.huntingProgress.findFirst({ where: eq(huntingProgress.contractId, "contract") }))?.cooldownUntil?.getTime()).toBeGreaterThan(Date.now());
  });

  it("rejects a stale switch without changing its accepted terms or allowance", async () => {
    const { session } = await accept();
    const db = await getTestDatabase();
    await db.update(huntingProgress).set({ used: 2 });
    const client = beforeStatements(db, huntingSession, [async () => {
      const content = huntingHabitatContent();
      content.contracts[0]!.hunts = 1;
      content.contracts.push({ ...huntingContract(), id: "second" });
      expect((await (await callerFor(huntingRouter, "staff")).save({ id: "forest", content })).success).toBe(true);
    }]);
    expect(await callerForDatabase(huntingRouter, "hunter", client).accept({ habitatId: "forest", contractId: "second", version: session.version })).toMatchObject({ success: false, message: "Your hunting session changed. Refresh the board." });
    expect(await db.query.huntingSession.findFirst()).toEqual(session);
    expect(await db.query.huntingProgress.findFirst({ where: eq(huntingProgress.contractId, "contract") })).toMatchObject({ used: 2, cooldownUntil: null, version: 0 });
  });

  it("prepares with accepted terms after contract removal and uses updated terms after finishing", async () => {
    const { hunter, session } = await accept();
    const staff = await callerFor(huntingRouter, "staff");
    const content = huntingHabitatContent();
    content.name = "Updated forest";
    content.contracts[0] = { ...content.contracts[0]!, name: "Updated boar", preparationSeconds: 30, hunts: 5, experience: 99 };
    expect((await staff.save({ id: "forest", content: { ...content, contracts: [] } })).success).toBe(true);
    expect((await hunter.getBoard()).session?.content?.name).toBe("Forest");
    expect((await hunter.getBoard()).creatures.map((c) => c.userId)).toContain("enemy");
    expect((await hunter.getBoard()).materials.map((m) => m.id)).toContain("hide");
    expect(await hunter.sessionAction({ id: session.id, version: session.version, action: "prepare" })).toMatchObject({ success: true });
    const prepared = (await hunter.getSession())!;
    expect(prepared.session.readyAt!.getTime() - Date.now()).toBeGreaterThan(8_000);
    expect(prepared.session.readyAt!.getTime() - Date.now()).toBeLessThanOrEqual(10_000);
    expect((await hunter.sessionAction({ id: session.id, version: prepared.session.version, action: "finish" })).success).toBe(true);
    const saved = await staff.save({ id: "forest", content });
    if (!("content" in saved)) throw Error("Habitat save failed");
    const updated = saved.content.contracts[0]!;
    expect((await hunter.accept({ habitatId: "forest", contractId: updated.id, version: null })).success).toBe(true);
    expect(await hunter.getSession()).toMatchObject({ contract: { name: "Updated boar", preparationSeconds: 30, hunts: 5, experience: 99 } });
  });
});

/** Apply statement fault/interleaving hooks to the short finish transaction as well. */
const withTransactionStatements = (database: DrizzleClient, wrap: (client: DrizzleClient) => DrizzleClient): DrizzleClient =>
  new Proxy(wrap(database), { get(target, key, receiver) {
    if (key === "transaction") return (...args: Parameters<typeof database.transaction>) =>
      database.transaction((tx) => args[0](wrap(tx as unknown as DrizzleClient) as typeof tx));
    return Reflect.get(target, key, receiver);
  } });
