import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import { STRONGHOLD_REESTABLISH_COST } from "@/drizzle/constants";
import { actionLog, clan, userData, village } from "@/drizzle/schema";
import * as moderator from "@/libs/moderator";
import * as socialQueries from "@/queries/socialUserCache";
import { clanRouter } from "@/server/api/routers/clan";
import { profileRouter } from "@/server/api/routers/profile";
import type { DrizzleClient } from "@/server/db";
import { syncStrongholdMembership } from "@/server/utils/faction";
import { insertUsers } from "../../../../setup/factories";
import { callerFor, callerForDatabase, describeWithDatabase, getTestDatabase, resetTables, runRawSql } from "../../../../setup/testDatabase";

const legacyDowngradeBackfill = readFileSync(resolve(process.cwd(), "drizzle/migrations/0076_brave_nico_minoru.sql"), "utf8").split(";").find((statement) => statement.includes("SET `wasDowngraded` = 1"));

const seedFaction = async (type: "HIDEOUT" | "STRONGHOLD", wasDowngraded = true) => {
  const db = await getTestDatabase();
  await db.insert(village).values({ id: "stronghold", name: "Stronghold", sector: 301, kageId: "leader", type, wasDowngraded });
  await db.insert(clan).values({ id: "faction", name: "Faction", image: "/clan.webp", villageId: "stronghold", founderId: "leader", leaderId: "leader", leaderOrderId: "leader-order", hasHideout: true, bank: STRONGHOLD_REESTABLISH_COST * 2 });
  await insertUsers(Array.from({ length: 30 }, (_, i) => ({ userId: i === 0 ? "leader" : `member-${i}`, username: `Member${i}`, villageId: "stronghold", clanId: "faction", isOutlaw: true })) as never);
};

describeWithDatabase("Stronghold membership and restoration", () => {
  beforeEach(async () => { await resetTables(actionLog, clan, userData, village); });
  afterEach(() => vi.restoreAllMocks());

  it.each(["unavailable", "missing"] as const)("keeps a paid restoration successful and omits both cache fields when confirmation is %s", async (failure) => {
    await seedFaction("HIDEOUT");
    const db = await getTestDatabase();
    const caller = await callerFor(clanRouter, "leader");
    const confirmation = vi.spyOn(socialQueries, "findVillageUserCache");
    if (failure === "missing") confirmation.mockResolvedValueOnce(undefined);
    else confirmation.mockRejectedValueOnce(new Error("Stronghold confirmation unavailable"));
    const result = await caller.upgradeHideoutToStronghold({ clanId: "faction" });
    expect(result.success).toBe(true);
    expect(result.userPatch).toBeUndefined();
    expect(result.userDelta).toBeUndefined();
    expect((await caller.upgradeHideoutToStronghold({ clanId: "faction" })).success).toBe(false);
    expect(await db.query.clan.findFirst()).toMatchObject({ bank: STRONGHOLD_REESTABLISH_COST });
    expect(await db.query.village.findFirst()).toMatchObject({ type: "STRONGHOLD" });
  });

  it("starts immediately, resets on recovery, and downgrades after 72 hours", async () => {
    await seedFaction("STRONGHOLD", false);
    const db = await getTestDatabase();
    await db.update(userData).set({ villageId: null, clanId: null }).where(eq(userData.userId, "member-29"));
    await syncStrongholdMembership(db, "stronghold");
    let [settlement] = await db.select().from(village);
    expect(settlement?.type).toBe("STRONGHOLD");
    expect(settlement?.belowMemberMinimumSince).toBeInstanceOf(Date);
    await db.update(userData).set({ villageId: "stronghold", clanId: "faction" }).where(eq(userData.userId, "member-29"));
    await syncStrongholdMembership(db, "stronghold");
    [settlement] = await db.select().from(village);
    expect(settlement?.belowMemberMinimumSince).toBeNull();
    await db.update(userData).set({ villageId: null, clanId: null }).where(eq(userData.userId, "member-29"));
    await db.update(village).set({ belowMemberMinimumSince: new Date(Date.now() - 73 * 3600_000) }).where(eq(village.id, "stronghold"));
    await syncStrongholdMembership(db, "stronghold");
    [settlement] = await db.select().from(village);
    expect(settlement).toMatchObject({ type: "HIDEOUT", wasDowngraded: true });
  });

  it("counts faction members despite a staff-assigned unaffiliated resident and AI member", async () => {
    await seedFaction("STRONGHOLD", false);
    const db = await getTestDatabase();
    await db.insert(village).values({ id: "origin", name: "Origin", sector: 302, kageId: "staff" });
    await insertUsers([
      { userId: "staff", username: "Staff", role: "CODING-ADMIN", villageId: "origin" },
      { userId: "outsider", username: "Outsider", villageId: "origin", clanId: null, rank: "GENIN", status: "AWAKE" },
      { userId: "ai-member", username: "AiMember", villageId: "stronghold", clanId: "faction", isAi: true },
    ]);
    const approveReason = vi.spyOn(moderator, "validateUserUpdateReason").mockResolvedValue({ allowUpdate: true, comment: "" });
    try {
      const result = await (await callerFor(profileRouter, "staff")).updateUser({
        id: "outsider",
        data: { username: "Outsider", villageId: "stronghold", bloodlineId: null, sageModeId: null, role: "USER", rank: "GENIN", staffAccount: false, reason: "Repair the account's village assignment" },
      });
      expect(result.success).toBe(true);
    } finally {
      approveReason.mockRestore();
    }
    await db.update(userData).set({ clanId: null, villageId: null }).where(eq(userData.userId, "member-29"));
    await syncStrongholdMembership(db, "stronghold");
    let settlement = await db.query.village.findFirst({ where: eq(village.id, "stronghold") });
    expect(settlement?.belowMemberMinimumSince).toBeInstanceOf(Date);
    const graceStartedAt = new Date(Date.now() - 3600_000);
    await db.update(village).set({ belowMemberMinimumSince: graceStartedAt }).where(eq(village.id, "stronghold"));
    await syncStrongholdMembership(db, "stronghold");
    settlement = await db.query.village.findFirst({ where: eq(village.id, "stronghold") });
    expect(settlement?.belowMemberMinimumSince).toEqual(graceStartedAt);
    await db.update(village).set({ belowMemberMinimumSince: new Date(Date.now() - 73 * 3600_000) }).where(eq(village.id, "stronghold"));
    await syncStrongholdMembership(db, "stronghold");
    settlement = await db.query.village.findFirst({ where: eq(village.id, "stronghold") });
    expect(settlement).toMatchObject({ type: "HIDEOUT", wasDowngraded: true });
    const restore = await (await callerFor(clanRouter, "leader")).upgradeHideoutToStronghold({ clanId: "faction" });
    expect(restore.success).toBe(false);
    await db.update(userData).set({ clanId: "faction", villageId: "stronghold" }).where(eq(userData.userId, "member-29"));
    expect((await (await callerFor(clanRouter, "leader")).upgradeHideoutToStronghold({ clanId: "faction" })).success).toBe(true);
    settlement = await db.query.village.findFirst({ where: eq(village.id, "stronghold") });
    expect(settlement).toMatchObject({ type: "STRONGHOLD", belowMemberMinimumSince: null });
  });

  it("migrates legacy downgrades, disables new upgrades and charges only once for concurrent restoration", async () => {
    await seedFaction("HIDEOUT", false);
    const caller = await callerFor(clanRouter, "leader");
    expect(legacyDowngradeBackfill).toBeDefined();
    await runRawSql(legacyDowngradeBackfill!);
    expect((await caller.upgradeHideoutToStronghold({ clanId: "faction" })).success).toBe(false);
    const db = await getTestDatabase();
    expect((await db.query.village.findFirst())?.wasDowngraded).toBe(false);
    await db.update(village).set({ createdAt: new Date(Date.now() - 90 * 86400_000), lastMaintenancePaidAt: new Date(Date.now() - 31 * 86400_000) }).where(eq(village.id, "stronghold"));
    await runRawSql(legacyDowngradeBackfill!);
    expect((await db.query.village.findFirst())?.wasDowngraded).toBe(true);
    const results = await Promise.all([caller.upgradeHideoutToStronghold({ clanId: "faction" }), caller.upgradeHideoutToStronghold({ clanId: "faction" })]);
    expect(results.filter((result) => result.success)).toHaveLength(1);
    const [faction] = await db.select().from(clan);
    expect(faction?.bank).toBe(STRONGHOLD_REESTABLISH_COST);
    const [settlement] = await db.select().from(village);
    expect(settlement).toMatchObject({ type: "STRONGHOLD", belowMemberMinimumSince: null });
  });

  it.each(["bank", "members", "former", "leader", "owner"] as const)("rejects restoration when %s changes after prefetch", async (changed) => {
    await seedFaction("HIDEOUT");
    const db = await getTestDatabase();
    const before = await db.query.village.findFirst();
    const guarded = new Proxy(db, {
      get(target, property, receiver) {
        if (property !== "execute" && property !== "transaction") return Reflect.get(target, property, receiver);
        return async (...args: unknown[]) => {
          if (changed === "bank") await db.update(clan).set({ bank: STRONGHOLD_REESTABLISH_COST - 1 });
          if (changed === "members") await db.update(userData).set({ isAi: true }).where(eq(userData.userId, "member-29"));
          if (changed === "former") await db.update(village).set({ wasDowngraded: false });
          if (changed === "leader") await db.update(clan).set({ leaderId: "another" });
          if (changed === "owner") await db.update(clan).set({ villageId: "another" });
          return Reflect.apply(Reflect.get(target, property, receiver), target, args);
        };
      },
    });
    expect((await callerForDatabase(clanRouter, "leader", guarded).upgradeHideoutToStronghold({ clanId: "faction" })).success).toBe(false);
    expect(await db.query.village.findFirst()).toMatchObject({ type: "HIDEOUT", lastMaintenancePaidAt: before?.lastMaintenancePaidAt });
    expect((await db.query.clan.findFirst())?.bank).toBe(changed === "bank" ? STRONGHOLD_REESTABLISH_COST - 1 : STRONGHOLD_REESTABLISH_COST * 2);
  });

  it("uses the same pricing for faction boosts and rejects stale duplicate purchases", async () => {
    await seedFaction("HIDEOUT");
    const db = await getTestDatabase();
    const caller = callerForDatabase(clanRouter, "leader", holdClanSnapshots(db, 2));
    const results = await Promise.all([caller.purchaseBoost({ clanId: "faction", boostType: "trainingBoost" }), caller.purchaseBoost({ clanId: "faction", boostType: "trainingBoost" })]);
    expect(results.filter((result) => result.success)).toHaveLength(1);
    const [faction] = await db.select().from(clan);
    expect(faction?.trainingBoost).toBe(2);
    expect(faction?.bank).toBe(STRONGHOLD_REESTABLISH_COST * 2 - 100000);
  });
});

/** Competing purchases must read the same boost level before their guarded writes race. */
const holdClanSnapshots = (database: DrizzleClient, count: number): DrizzleClient => {
  let pending = 0;
  let release = () => {};
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  const clanQueries = new Proxy(database.query.clan, {
    get(target, property, receiver) {
      if (property !== "findFirst") return Reflect.get(target, property, receiver);
      return async (...args: Parameters<typeof target.findFirst>) => {
        const result = await target.findFirst(...args);
        pending += 1;
        if (pending >= count) release();
        await barrier;
        return result;
      };
    },
  });
  return new Proxy(database, { get(target, property, receiver) { return property === "query" ? { ...target.query, clan: clanQueries } : Reflect.get(target, property, receiver); } });
};
