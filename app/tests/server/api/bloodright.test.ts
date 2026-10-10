import { COST_SKILL_RESET } from "@/drizzle/constants";
import { and, eq, ne } from "drizzle-orm";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { actionLog, bloodline, skillTree, userData, userSkill } from "@/drizzle/schema";
import * as socials from "@/libs/socials";
import { bloodrightSwapRefund, matchBloodrightSnapshot } from "@/libs/bloodright";
import { bloodlineRouter, updateBloodline } from "@/server/api/routers/bloodline";
import { staffRouter } from "@/server/api/routers/staff";
import { bloodrightRouter } from "@/server/api/routers/bloodright";
import { calcEnergy } from "@/libs/profile";
import { callerForDatabase } from "../../setup/testDatabase";
import { skillTreeRouter } from "@/server/api/routers/skillTree";
import { resetServerModuleStubs, stubProfile } from "../../setup/serverModules";
import { describeWithDatabase, getTestDatabase, resetTables } from "../../setup/testDatabase";

const userId = "bloodright-player";
const invoke = async (name: "purchase" | "refund" | "reset", input?: unknown) => {
  const db = await getTestDatabase();
  const procedure = bloodrightRouter._def.procedures[name];
  const { resolver } = procedure._def as unknown as { resolver: (args: { ctx: { drizzle: typeof db; userId: string }; input: unknown }) => Promise<{ success: boolean }> };
  return resolver({ ctx: { drizzle: db, userId }, input });
};
const read = async () => (await (await getTestDatabase()).query.userData.findFirst({ where: eq(userData.userId, userId) }))!;
const tier = (id: string, tier = 1, requiredSkillIds: string[] = []) => ({ id, name: id, image: "", description: "Bloodright fixture", effects: [], tier, requiredSkillIds, pathType: "BLOODRIGHT" as const, bloodlineId: "line", seichiSilverCost: 100 });

describeWithDatabase("Bloodright economy on MySQL", () => {
  beforeEach(async () => {
    const db = await getTestDatabase();
    await resetTables(actionLog, userSkill, skillTree, userData, bloodline);
    await db.insert(bloodline).values({id: "line", name: "Bloodright Line", rank: "D", image: "", description: "Fixture", effects: []});
    vi.spyOn(socials, "callDiscordContent").mockResolvedValue(undefined);
    await db.insert(userData).values({ userId, username: "BloodrightPlayer", gender: "Other", bloodlineId: "line", seichiSilver: 1000, reputationPoints: 100, rank: "JONIN" });
    await db.insert(skillTree).values([tier("root"), tier("child", 2, ["root"]), tier("grandchild", 3, ["child"]), tier("other"), tier("fifth"), tier("sixth")]);
    stubProfile("fetchUpdatedUser", async () => ({ user: await read() }));
    stubProfile("fetchUser", async (_client: unknown, id: string) => db.query.userData.findFirst({ where: eq(userData.userId, id) }));
  });
  afterEach(() => { resetServerModuleStubs(); vi.restoreAllMocks(); });

  it("charges once for concurrent duplicate purchases and refunds once", async () => {
    const purchases = await Promise.all([invoke("purchase", { skillId: "root" }), invoke("purchase", { skillId: "root" })]);
    expect(purchases.filter((entry) => entry.success)).toHaveLength(1);
    expect((await read()).seichiSilver).toBe(900);
    const refunds = await Promise.all([invoke("refund", { skillId: "root" }), invoke("refund", { skillId: "root" })]);
    expect(refunds.filter((entry) => entry.success)).toHaveLength(1);
    expect((await read()).seichiSilver).toBe(1000);
  });
  it("enforces prerequisites, balance and five active nodes", async () => {
    expect((await invoke("purchase", { skillId: "child" })).success).toBe(false);
    for (const skillId of ["root", "child", "grandchild", "other", "fifth"]) expect((await invoke("purchase", { skillId })).success).toBe(true);
    expect((await invoke("purchase", { skillId: "sixth" })).success).toBe(false);
    const db = await getTestDatabase();
    await db.update(userData).set({ seichiSilver: 0, bloodright: [], bloodrightSpent: 0 }).where(eq(userData.userId, userId));
    expect((await invoke("purchase", { skillId: "root" })).success).toBe(false);
    expect((await read()).seichiSilver).toBe(0);
  });
  it("refunds all dependents at their saved costs after a content price change", async () => {
    for (const skillId of ["root", "child", "grandchild", "other"]) await invoke("purchase", { skillId });
    const db = await getTestDatabase();
    await db.update(skillTree).set({ seichiSilverCost: 999 }).where(eq(skillTree.id, "root"));
    expect((await invoke("refund", { skillId: "root" })).success).toBe(true);
    const user = await read();
    expect(user.seichiSilver).toBe(900);
    expect(user.bloodrightSpent).toBe(100);
    expect(user.bloodright.map((entry) => entry.skillId)).toEqual(["other"]);
  });
  it("refunds a changed bloodline in one update and does not refund a same-line update", async () => {
    await invoke("purchase", { skillId: "root" });
    const db = await getTestDatabase();
    await db.update(userData).set({ ...bloodrightSwapRefund("line"), bloodlineId: "line" }).where(eq(userData.userId, userId));
    expect((await read()).seichiSilver).toBe(900);
    await db.update(userData).set({ ...bloodrightSwapRefund("other-line"), bloodlineId: "other-line" }).where(eq(userData.userId, userId));
    const user = await read();
    expect(user.seichiSilver).toBe(1000);
    expect(user.bloodright).toEqual([]);
    expect(user.bloodrightSpent).toBe(0);
    await db.update(userData).set({ ...bloodrightSwapRefund("line"), bloodlineId: "line" }).where(eq(userData.userId, userId));
    expect((await read()).bloodright).toEqual([]);
  });
  it("shares the one free reset with Skills and charges 30 reps afterward", async () => {
    await invoke("purchase", { skillId: "root" });
    expect((await invoke("reset")).success).toBe(true);
    expect((await read()).reputationPoints).toBe(100);
    const db = await getTestDatabase();
    const { resolver } = skillTreeRouter._def.procedures.resetSkillPoints._def as unknown as { resolver: (args: {ctx: {drizzle: typeof db; userId: string}; input: undefined}) => Promise<{success: boolean}> };
    expect((await resolver({ctx: {drizzle: db, userId}, input: undefined})).success).toBe(true);
    expect((await read()).reputationPoints).toBe(70);
    expect((await read()).monthlySkillResets.count).toBe(2);
  });
  it("returns reset capacity and exact allowance with one user read", async () => {
    const db = await getTestDatabase();
    await db.update(userData).set({ curEnergy: 999 }).where(eq(userData.userId, userId));
    await db.insert(userSkill).values({ id: "reset-skill", userId, skillId: "root", activated: true });
    let reads = 0;
    stubProfile("fetchUpdatedUser", async () => { reads++; return { user: await read(), requiresUserRefresh: false }; });
    const result = await callerForDatabase(skillTreeRouter, userId, db).resetSkillPoints();
    expect(result.success).toBe(true);
    expect(result.userDelta).toEqual({});
    const saved = await read();
    expect(result.userPatch?.monthlySkillResets).toEqual(saved.monthlySkillResets);
    expect(result.userPatch?.maxEnergy).toBe(calcEnergy(saved.level));
    expect(saved.curEnergy).toBe(999);
    expect(result.userPatch?.effectiveMasteries?.ninjutsuMastery).toBe(saved.ninjutsuMastery);
    expect(await db.query.userSkill.findMany({ where: eq(userSkill.userId, userId) })).toEqual([]);
    expect(reads).toBe(1);
    const paid = await callerForDatabase(skillTreeRouter, userId, db).resetSkillPoints();
    expect(paid.userDelta).toEqual({ reputationPoints: -COST_SKILL_RESET });
    expect(paid.userPatch?.monthlySkillResets).toEqual((await read()).monthlySkillResets);
    expect(reads).toBe(2);
  });
  it("keeps the reset refresh when fetching the user settled other progress", async () => {
    const db = await getTestDatabase();
    stubProfile("fetchUpdatedUser", async () => ({ user: await read(), requiresUserRefresh: true }));
    const result = await callerForDatabase(skillTreeRouter, userId, db).resetSkillPoints();
    expect(result.success).toBe(true);
    expect(result.userDelta).toBeUndefined();
    expect(result.userPatch?.monthlySkillResets).toEqual((await read()).monthlySkillResets);
  });
  it("gives Gold two free resets and cannot overspend reputation", async () => {
    const db = await getTestDatabase();
    await db.update(userData).set({ federalStatus: "GOLD", reputationPoints: 29 }).where(eq(userData.userId, userId));
    for (let i = 0; i < 2; i++) { await invoke("purchase", {skillId: "root"}); expect((await invoke("reset")).success).toBe(true); }
    await invoke("purchase", {skillId: "root"});
    expect((await invoke("reset")).success).toBe(false);
    expect((await read()).reputationPoints).toBe(29);
    expect((await read()).bloodright).toHaveLength(1);
  });
  it("serializes different purchases competing for the final active slot", async () => {
    for (const skillId of ["root", "child", "grandchild", "other"]) await invoke("purchase", { skillId });
    const results = await Promise.all([invoke("purchase", { skillId: "fifth" }), invoke("purchase", { skillId: "sixth" })]);
    expect(results.filter((entry) => entry.success)).toHaveLength(1);
    expect((await read()).bloodright).toHaveLength(5);
    expect((await read()).seichiSilver).toBe(500);
  });
  it("refunds once when a tier refund races a bloodline swap", async () => {
    await invoke("purchase", { skillId: "root" });
    const db = await getTestDatabase();
    await Promise.all([invoke("refund", { skillId: "root" }), db.update(userData).set({ ...bloodrightSwapRefund("other-line"), bloodlineId: "other-line" }).where(eq(userData.userId, userId))]);
    expect((await read()).seichiSilver).toBe(1000);
    expect((await read()).bloodrightSpent).toBe(0);
    expect((await read()).bloodright).toEqual([]);
  });
  it("supports repeated staff resets after allowance initialization", async () => {
    const db = await getTestDatabase();
    await db.update(userData).set({ role: "OWNER", staffAccount: true }).where(eq(userData.userId, userId));
    const { resolver } = skillTreeRouter._def.procedures.resetSkillPoints._def as unknown as { resolver: (args: {ctx: {drizzle: typeof db; userId: string}; input: undefined}) => Promise<{success: boolean}> };
    for (let i = 0; i < 2; i++) expect((await resolver({ctx: {drizzle: db, userId}, input: undefined})).success).toBe(true);
    expect((await read()).reputationPoints).toBe(100);
    expect((await read()).monthlySkillResets.count).toBe(0);
  });
  it("prevents content edits and deletion from stranding dependent tiers", async () => {
    const db = await getTestDatabase();
    await db.update(userData).set({role: "OWNER"}).where(eq(userData.userId, userId));
    const root = await db.query.skillTree.findFirst({where: eq(skillTree.id, "root")});
    const update = skillTreeRouter._def.procedures.update._def as unknown as { resolver: (args: {ctx: {drizzle: typeof db; userId: string}; input: unknown}) => Promise<{success: boolean}> };
    const deletion = skillTreeRouter._def.procedures.delete._def as unknown as { resolver: (args: {ctx: {drizzle: typeof db; userId: string}; input: unknown}) => Promise<{success: boolean}> };
    expect((await update.resolver({ctx: {drizzle: db, userId}, input: {id: "root", data: {...root, tier: 5}}})).success).toBe(false);
    expect((await deletion.resolver({ctx: {drizzle: db, userId}, input: {id: "root"}})).success).toBe(false);
    expect(await db.query.skillTree.findFirst({where: eq(skillTree.id, "root")})).toBeDefined();
  });
  it("rejects tiers of another bloodline and changes during battle", async () => {
    const db = await getTestDatabase();
    await db.update(userData).set({bloodlineId: "other-line"}).where(eq(userData.userId, userId));
    expect((await invoke("purchase", {skillId: "root"})).success).toBe(false);
    await db.update(userData).set({bloodlineId: "line", status: "BATTLE"}).where(eq(userData.userId, userId));
    expect((await invoke("purchase", {skillId: "root"})).success).toBe(false);
  });
  it("allows content-only edits to legacy skill hierarchies but validates hierarchy changes", async () => {
    const db = await getTestDatabase();
    await db.update(userData).set({ role: "OWNER" }).where(eq(userData.userId, userId));
    await db.update(skillTree).set({ pathType: "SKILL", bloodlineId: null });
    await db.update(skillTree).set({ tier: 5 }).where(eq(skillTree.id, "root"));
    const update = skillTreeRouter._def.procedures.update._def as unknown as { resolver: (args: {ctx: {drizzle: typeof db; userId: string}; input: unknown}) => Promise<{success: boolean}> };
    for (const id of ["root", "child"]) {
      const skill = await db.query.skillTree.findFirst({ where: eq(skillTree.id, id) });
      expect((await update.resolver({ ctx: { drizzle: db, userId }, input: { id, data: { ...skill, description: "Updated description" } } })).success).toBe(true);
    }
    const root = await db.query.skillTree.findFirst({ where: eq(skillTree.id, "root") });
    expect((await update.resolver({ ctx: { drizzle: db, userId }, input: { id: "root", data: { ...root, tier: 6 } } })).success).toBe(false);
  });
  it("rejects bloodline swaps and natural removals during battle without refunding", async () => {
    const db = await getTestDatabase();
    await invoke("purchase", { skillId: "root" });
    const awake = await read();
    await db.update(userData).set({ status: "BATTLE" }).where(eq(userData.userId, userId));
    for (const name of ["removeBloodline", "swapBloodline"] as const) {
      const { resolver } = bloodlineRouter._def.procedures[name]._def as unknown as { resolver: (args: { ctx: { drizzle: typeof db; userId: string }; input: unknown }) => Promise<{ success: boolean; message: string }> };
      const result = await resolver({ ctx: { drizzle: db, userId }, input: name === "swapBloodline" ? { bloodlineId: "line" } : undefined });
      expect(result).toMatchObject({ success: false, message: "You cannot change bloodline during battle" });
    }
    await expect(updateBloodline(db, awake, null, 0, "Bloodline Removed")).rejects.toThrow("Unable to update bloodline");
    expect(await read()).toMatchObject({ bloodlineId: "line", seichiSilver: 900, bloodrightSpent: 100, reputationPoints: 100 });
    expect(await db.query.actionLog.findMany()).toHaveLength(0);
  });
  it("rejects battle claims after a refund and refunds after a battle claim", async () => {
    const db = await getTestDatabase();
    await invoke("purchase", { skillId: "root" });
    const beforeRefund = await read();
    await invoke("refund", { skillId: "root" });
    const claim = (snapshot: typeof beforeRefund) => db.update(userData).set({ status: "BATTLE" }).where(and(ne(userData.status, "BATTLE"), matchBloodrightSnapshot(snapshot)));
    expect((await claim(beforeRefund)).rowsAffected).toBe(0);
    await invoke("purchase", { skillId: "root" });
    expect((await claim(await read())).rowsAffected).toBe(1);
    expect((await invoke("refund", { skillId: "root" })).success).toBe(false);
    expect(await read()).toMatchObject({ seichiSilver: 900, bloodrightSpent: 100, status: "BATTLE" });
  });
  it("clones Silver and saved Bloodright purchases as one debug snapshot without retaining the staff path", async () => {
    const db = await getTestDatabase();
    await db.update(userData).set({ role: "OWNER", staffAccount: true }).where(eq(userData.userId, userId));
    await invoke("purchase", { skillId: "root" });
    await db.insert(userData).values({ userId: "clone-target", username: "CloneTarget", gender: "Other", bloodlineId: "other-line", seichiSilver: 250, bloodright: [{ skillId: "target-tier", cost: 77 }], bloodrightSpent: 77 });
    stubProfile("fetchAttributes", async () => []);
    const { resolver } = staffRouter._def.procedures.cloneUserForDebug._def as unknown as { resolver: (args: { ctx: { drizzle: typeof db; userId: string }; input: { userId: string } }) => Promise<{ success: boolean }> };
    for (let i = 0; i < 2; i++) {
      expect((await resolver({ ctx: { drizzle: db, userId }, input: { userId: "clone-target" } })).success).toBe(true);
      expect(await read()).toMatchObject({ bloodlineId: "other-line", seichiSilver: 250, bloodright: [{ skillId: "target-tier", cost: 77 }], bloodrightSpent: 77 });
      expect((await invoke("reset")).success).toBe(true);
      expect((await read()).seichiSilver).toBe(327);
    }
    expect(await db.query.userData.findFirst({ where: eq(userData.userId, "clone-target") })).toMatchObject({ seichiSilver: 250, bloodrightSpent: 77 });
  });
  it("defers deletion refunds for battling users and lets them recover saved costs after battle", async () => {
    const db = await getTestDatabase();
    await invoke("purchase", { skillId: "root" });
    await db.update(userData).set({ role: "OWNER", isAi: true, status: "BATTLE" }).where(eq(userData.userId, userId));
    await db.insert(userData).values({ userId: "awake-ai", username: "AwakeAI", gender: "Other", isAi: true, bloodlineId: "line", seichiSilver: 250, bloodright: [{ skillId: "root", cost: 77 }], bloodrightSpent: 77 });
    const { resolver } = bloodlineRouter._def.procedures.delete._def as unknown as { resolver: (args: { ctx: { drizzle: typeof db; userId: string }; input: { id: string } }) => Promise<{ success: boolean }> };
    expect((await resolver({ ctx: { drizzle: db, userId }, input: { id: "line" } })).success).toBe(true);
    expect(await db.query.bloodline.findFirst({ where: eq(bloodline.id, "line") })).toBeUndefined();
    expect(await read()).toMatchObject({ bloodlineId: null, seichiSilver: 900, bloodright: [{ skillId: "root", cost: 100 }], bloodrightSpent: 100 });
    expect(await db.query.userData.findFirst({ where: eq(userData.userId, "awake-ai") })).toMatchObject({ bloodlineId: null, seichiSilver: 327, bloodright: [], bloodrightSpent: 0 });
    expect((await invoke("refund", { skillId: "root" })).success).toBe(false);
    await db.update(userData).set({ status: "AWAKE" }).where(eq(userData.userId, userId));
    expect((await invoke("refund", { skillId: "root" })).success).toBe(true);
    expect((await invoke("refund", { skillId: "root" })).success).toBe(false);
    expect(await read()).toMatchObject({ seichiSilver: 1000, bloodright: [], bloodrightSpent: 0 });
  });
});
