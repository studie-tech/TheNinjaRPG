import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import { actionLog, huntingHabitat, huntingProgress, huntingSession, item, sectorMap, userData } from "@/drizzle/schema";
import { huntingRouter } from "@/routers/hunting";
import { insertItems, insertUsers } from "../../setup/factories";
import { huntingContract, huntingHabitatContent, huntingMap } from "../../setup/hunting";
import { callerFor, describeWithDatabase, getTestDatabase, resetTables } from "../../setup/testDatabase";

describeWithDatabase("Hunting lifecycle", () => {
  beforeEach(async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json([{ result: [59, 60] }]));
    await resetTables(actionLog, huntingHabitat, huntingProgress, huntingSession, item, sectorMap, userData);
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
    expect((await hunter.accept({ habitatId: "forest", contractId: "contract", version: null })).success).toBe(true);
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
  it("enforces staff authorization and validates published reachable locations", async () => {
    const hunter = await callerFor(huntingRouter, "hunter");
    const content = huntingHabitatContent();
    expect((await hunter.save({ id: "forest", content })).success).toBe(false);
    const staff = await callerFor(huntingRouter, "staff");
    expect((await staff.save({ id: "forest", content: { ...content, sectors: [2], contracts: [] } })).success).toBe(false);
    expect((await staff.save({ id: "forest", content })).success).toBe(true);
  });
  it("reconciles staff-reduced allowances into cooldown and rejects edits during fights", async () => {
    await accept();
    const db = await getTestDatabase();
    await db.update(huntingProgress).set({ used: 2 });
    const staff = await callerFor(huntingRouter, "staff");
    const content = huntingHabitatContent();
    content.contracts[0]!.hunts = 2;
    expect((await staff.save({ id: "forest", content })).success).toBe(true);
    expect((await db.query.huntingProgress.findFirst())?.cooldownUntil?.getTime()).toBeGreaterThan(Date.now());
    await db.update(huntingSession).set({ battleId: "battle" });
    expect((await staff.save({ id: "forest", content: { ...content, name: "Edited" } })).success).toBe(false);
    expect((await db.query.huntingHabitat.findFirst())?.content.name).toBe("Forest");
  });
});
