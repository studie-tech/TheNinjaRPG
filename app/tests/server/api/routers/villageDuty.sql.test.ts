import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import { VILLAGE_DUTY_VISIBLE_LIMIT } from "@/drizzle/constants";
import type { UserData } from "@/drizzle/schema";
import { userAttribute, userData, village } from "@/drizzle/schema";
import { isOnVillageDuty } from "@/libs/villageDuty";
import {
  countVillageDuty,
  findVillageDutyDefender,
  listVillageDutyPatrols,
  listVillageDutyRoster,
} from "@/queries/villageDuty";
import { villageDutyRouter } from "@/server/api/routers/villageDuty";
import { insertUsers } from "../../../setup/factories";
import { stubRateLimitTransport } from "../../../setup/rateLimit";
import { resetServerModuleStubs } from "../../../setup/serverModules";
import {
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  recordQueries,
  resetTables,
  resolverOf,
} from "../../../setup/testDatabase";

describeWithDatabase("village duty enrollment", () => {
  beforeEach(async () => {
    resetServerModuleStubs();
    stubRateLimitTransport();
    await resetTables(userAttribute, userData, village);
    const db = await getTestDatabase();
    await db.insert(village).values({
      id: "home",
      name: "Home",
      sector: 123,
      type: "VILLAGE",
      kageId: "leader",
    });
    await insertUsers([
      {
        userId: "protector",
        username: "Protector",
        villageId: "home",
        rank: "CHUNIN",
        status: "AWAKE",
        sector: 123,
        location: "Village",
        updatedAt: new Date("2026-01-01"),
        joinedVillageAt: new Date("2025-01-01"),
      },
    ]);
  });
  afterEach(() => {
    resetServerModuleStubs();
    vi.restoreAllMocks();
  });
  const load = async () =>
    (await getTestDatabase()).query.userData.findFirst({
      where: eq(userData.userId, "protector"),
    });
  const duty = async (enabled: boolean, villageId = "home") =>
    callerForDatabase(villageDutyRouter, "protector", await getTestDatabase()).setDuty({
      villageId,
      enabled,
    });

  it("keeps offline and hospitalized copies enrolled until cancellation without changing the owner", async () => {
    const db = await getTestDatabase();
    const before = await load();
    expect((await duty(true)).success).toBe(true);
    await db
      .update(userData)
      .set({ status: "HOSPITALIZED" })
      .where(eq(userData.userId, "protector"));
    const enrolled = await load();
    expect(enrolled && isOnVillageDuty(enrolled)).toBe(true);
    expect(enrolled?.updatedAt).toEqual(before?.updatedAt);
    expect(enrolled?.money).toBe(before?.money);
    expect(enrolled?.curHealth).toBe(before?.curHealth);
    expect((await findVillageDutyDefender(db, 123))?.userId).toBe("protector");
    expect((await duty(false)).success).toBe(true);
    expect(await findVillageDutyDefender(db, 123)).toBeUndefined();
  });
  it.each([
    { rank: "GENIN" as const },
    { isBanned: true },
    { isAi: true },
    { isOutlaw: true },
    { sector: 456 },
    { status: "BATTLE" as const },
    { location: "" },
  ])("rejects ineligible signup atomically: %j", async (patch) => {
    const db = await getTestDatabase();
    await db.update(userData).set(patch).where(eq(userData.userId, "protector"));
    expect((await duty(true)).success).toBe(false);
    expect((await load())?.villageDutyVillageId).toBeNull();
  });
  it("rejects foreign enrollment and excludes changed membership, bans and demotions from defenders", async () => {
    const db = await getTestDatabase();
    expect((await duty(true, "foreign")).success).toBe(false);
    expect((await duty(true)).success).toBe(true);
    expect((await countVillageDuty(db, "home"))[0]?.count).toBe(1);
    await db
      .update(userData)
      .set({ joinedVillageAt: new Date(Date.now() + 1000) })
      .where(eq(userData.userId, "protector"));
    expect(await findVillageDutyDefender(db, 123)).toBeUndefined();
    expect((await countVillageDuty(db, "home"))[0]?.count).toBe(0);
  });
  it("publishes the same bounded, ordered roster without loading map appearance relations", async () => {
    const db = await getTestDatabase();
    const enrolledAt = new Date("2026-01-01");
    const eligible = Array.from({ length: VILLAGE_DUTY_VISIBLE_LIMIT + 3 }, (_, i) => ({
      userId: `roster-${String(i).padStart(3, "0")}`,
      username: `Protector ${i}`,
      villageId: "home",
      rank: "CHUNIN" as const,
      status: i % 2 ? ("HOSPITALIZED" as const) : ("BATTLE" as const),
      joinedVillageAt: new Date("2025-01-01"),
      villageDutyVillageId: "home",
      // Ties exercise the user ID ordering independently of insertion order.
      villageDutyStartedAt: new Date(enrolledAt.getTime() + Math.floor(i / 2)),
      avatar: `portrait-${i}`,
      avatarLight: i % 3 === 0 ? null : i % 3 === 1 ? "" : `light-${i}`,
    }));
    const excluded: Partial<UserData>[] = [
      { isAi: true },
      { isBanned: true },
      { isOutlaw: true },
      { rank: "GENIN" },
      { villageId: "foreign" },
      { joinedVillageAt: new Date("2026-02-01") },
      { villageDutyVillageId: null },
      { villageDutyStartedAt: null },
    ];
    await insertUsers([
      ...[...eligible].reverse(),
      ...excluded.map((patch, i) => ({
        ...eligible[0]!,
        userId: `excluded-${i}`,
        username: `Excluded ${i}`,
        ...patch,
      })),
    ]);
    await db.insert(userAttribute).values({
      id: "roster-appearance",
      userId: eligible[0]!.userId,
      attribute: "appearance-hair",
    });
    const patrols = await listVillageDutyPatrols(db, "home");
    expect(patrols[0]?.attributes).toEqual([{ attribute: "appearance-hair" }]);
    const trace = await recordQueries(() =>
      resolverOf(villageDutyRouter.get)({
        ctx: { drizzle: db, userId: "protector" },
        input: { villageId: "home" },
      }),
    );
    const expected = eligible.slice(0, VILLAGE_DUTY_VISIBLE_LIMIT).map((p) => ({
      userId: p.userId,
      username: p.username,
      avatar: p.avatarLight ?? p.avatar,
      rank: p.rank,
    }));
    expect(trace.result?.protectors).toEqual(expected);
    expect(trace.result?.protectors).toEqual(
      patrols.map((p) => ({
        userId: p.userId,
        username: p.username,
        avatar: p.avatarLight ?? p.avatar,
        rank: p.rank,
      })),
    );
    expect(trace.result?.count).toBe(eligible.length);
    expect(trace.statements).toHaveLength(4);
    expect(trace.roundTrips).toBe(1);
    const rosterSql = trace.statements.find((statement) =>
      statement.startsWith(
        "select `userId`, `username`, `avatar`, `avatarLight`, `rank`",
      ),
    );
    expect(rosterSql).toBeDefined();
    for (const table of [
      "UserAttribute",
      "UserItem",
      "Item",
      "ItemVariant",
      "AnbuSquad",
    ])
      expect(rosterSql).not.toContain(`\`${table}\``);
  });
  it("keeps roster reads scoped to the requested village and excludes non-village homes", async () => {
    const db = await getTestDatabase();
    await duty(true);
    expect(await listVillageDutyRoster(db, "foreign")).toEqual([]);
    await db.update(village).set({ type: "OUTLAW" }).where(eq(village.id, "home"));
    expect(await listVillageDutyRoster(db, "home")).toEqual([]);
    expect(await listVillageDutyPatrols(db, "home")).toEqual([]);
    expect(
      await callerForDatabase(villageDutyRouter, "protector", db).get({
        villageId: "home",
      }),
    ).toBeNull();
  });
});
