import { timerClaimFixture } from "../../../setup/gameTimers";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import * as headers from "next/headers";
import { GET } from "@/app/api/hourly-maintainance/route";
import { bounty, bountyContribution, bountySignup, gameSetting, userData } from "@/drizzle/schema";
import * as gamesettings from "@/libs/gamesettings";
import { bountyRouter } from "@/server/api/routers/bounty";
import { addBountyMoneySchema } from "@/validators/bounty";
import { insertUsers } from "../../../setup/factories";
import { resetServerModuleStubs, stubCronAuth, stubDatabase } from "../../../setup/serverModules";
import { beforeStatements } from "../../../setup/statements";
import { callerFor, callerForDatabase, describeWithDatabase, getTestDatabase, resetTables } from "../../../setup/testDatabase";

const moneyOf = async (userId: string) =>
  (await (await getTestDatabase()).query.userData.findFirst({ where: eq(userData.userId, userId) }))?.money;

const amountOf = async () =>
  (await (await getTestDatabase()).query.bounty.findFirst({ where: eq(bounty.id, "bounty") }))?.amountRyo;

/** Seed an OPEN bounty funded by its creator, plus a hunter and a backer. */
const seedBounty = async (overrides: Partial<typeof bounty.$inferInsert> = {}) => {
  const db = await getTestDatabase();
  await insertUsers([
    { userId: "creator", username: "creator", money: 0 },
    { userId: "target", username: "target", money: 0, villageId: "elsewhere" },
    { userId: "hunter", username: "hunter", money: 0 },
    { userId: "backer", username: "backer", money: 100 },
  ]);
  await db.insert(bounty).values({
    id: "bounty", targetUserId: "target", creatorUserId: "creator",
    amountRyo: 500, originalAmountRyo: 500, status: "OPEN", ...overrides,
  });
  await db.insert(bountyContribution).values({
    id: "creator-contribution", bountyId: "bounty", contributorUserId: "creator", amountRyo: 500,
  });
  return db;
};

describeWithDatabase("Bounty money guards", () => {
  beforeEach(async () => resetTables(bounty, bountyContribution, bountySignup, userData));

  it("pays a claimed bounty once when the hunter collects twice at the same time", async () => {
    const db = await seedBounty({ status: "CLAIMED", claimedByUserId: "hunter", amountRyo: 1000 });
    await db.insert(bountySignup).values({ id: "signup", bountyId: "bounty", hunterUserId: "hunter" });
    const results: boolean[] = [];
    const raced = beforeStatements(db, bounty, [async () => {
      results.push((await (await callerFor(bountyRouter, "hunter")).collect({ bountyId: "bounty" })).success);
    }]);
    results.unshift((await callerForDatabase(bountyRouter, "hunter", raced).collect({ bountyId: "bounty" })).success);
    expect({ money: await moneyOf("hunter"), results }).toEqual({ money: 1000, results: [false, true] });
  });

  it("never drives the backer's money negative when two contributions race", async () => {
    const db = await seedBounty();
    const results: boolean[] = [];
    const raced = beforeStatements(db, userData, [async () => {
      results.push((await (await callerFor(bountyRouter, "backer")).addMoney({ bountyId: "bounty", amountRyo: 100 })).success);
    }]);
    results.unshift((await callerForDatabase(bountyRouter, "backer", raced).addMoney({ bountyId: "bounty", amountRyo: 100 })).success);
    expect({ money: await moneyOf("backer"), amountRyo: await amountOf(), results })
      .toEqual({ money: 0, amountRyo: 600, results: [false, true] });
  });

  it("refunds a contribution whose bounty is retracted before it is applied", async () => {
    const db = await seedBounty();
    const raced = beforeStatements(db, userData, [async () => {
      expect((await (await callerFor(bountyRouter, "creator")).retract({ bountyId: "bounty" })).success).toBe(true);
    }]);
    const result = await callerForDatabase(bountyRouter, "backer", raced).addMoney({ bountyId: "bounty", amountRyo: 100 });
    expect(result.success).toBe(false);
    expect({ backer: await moneyOf("backer"), creator: await moneyOf("creator") }).toEqual({ backer: 100, creator: 500 });
    expect(await db.query.bountyContribution.findMany()).toEqual([]);
  });

  it("refunds a recorded contribution exactly once when a retract lands before the bounty is raised", async () => {
    const db = await seedBounty();
    const raced = beforeStatements(db, bounty, [async () => {
      expect((await (await callerFor(bountyRouter, "creator")).retract({ bountyId: "bounty" })).success).toBe(true);
    }]);
    const result = await callerForDatabase(bountyRouter, "backer", raced).addMoney({ bountyId: "bounty", amountRyo: 100 });
    expect(result.success).toBe(false);
    expect({ backer: await moneyOf("backer"), creator: await moneyOf("creator") }).toEqual({ backer: 100, creator: 500 });
  });

  it("rejects fractional contributions", () => {
    expect(addBountyMoneySchema.safeParse({ bountyId: "bounty", amountRyo: 1.5 }).success).toBe(false);
  });

  it("does not expose staff-only creator and hunter identities on the board", async () => {
    const db = await seedBounty();
    await db.insert(bountySignup).values({ id: "signup", bountyId: "bounty", hunterUserId: "hunter" });
    const board = await (await callerFor(bountyRouter, "backer")).board({ status: "OPEN", limit: 30 });
    const [listing] = board.data;
    expect(listing).toMatchObject({ id: "bounty", huntersCount: 1, isCreator: false });
    for (const key of ["creator", "creatorUserId", "hunters", "creatorUser", "huntingUsers"]) {
      expect((listing as Record<string, unknown>)[key]).toBeUndefined();
    }
  });
});

describeWithDatabase("Bounty expiry", () => {
  const spies: { mockRestore: () => void }[] = [];
  beforeEach(async () => {
    await resetTables(bounty, bountyContribution, bountySignup, gameSetting, userData);
    stubCronAuth(() => null);
    spies.push(vi.spyOn(headers, "cookies").mockResolvedValue({} as never));
    spies.push(vi.spyOn(gamesettings, "lockWithHourlyTimer").mockResolvedValue({
      ...timerClaimFixture(), isNewHour: true, response: Response.json(null),
    } as never));
  });
  afterEach(() => {
    for (const spy of spies.splice(0)) spy.mockRestore();
    resetServerModuleStubs();
  });

  it("does not refund a bounty the creator retracted after the expiry listing", async () => {
    const db = await seedBounty({ createdAt: new Date(Date.now() - 8 * 86400_000) });
    stubDatabase(beforeStatements(db, bounty, [async () => {
      expect((await (await callerFor(bountyRouter, "creator")).retract({ bountyId: "bounty" })).success).toBe(true);
    }]));
    const response = await GET(new Request("https://example.com/api/hourly-maintainance"));
    expect(response.status).toBe(200);
    expect(await moneyOf("creator")).toBe(500);
    expect((await db.query.bounty.findFirst())?.status).toBe("CANCELLED");
  });

  it("expires a stale bounty and refunds its contributions", async () => {
    const db = await seedBounty({ createdAt: new Date(Date.now() - 8 * 86400_000) });
    const response = await GET(new Request("https://example.com/api/hourly-maintainance"));
    expect(response.status).toBe(200);
    expect(await moneyOf("creator")).toBe(500);
    expect((await db.query.bounty.findFirst())?.status).toBe("EXPIRED");
  });
});
