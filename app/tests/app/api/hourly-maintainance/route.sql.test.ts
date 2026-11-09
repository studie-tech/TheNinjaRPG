import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import * as Sentry from "@sentry/nextjs";
import { eq } from "drizzle-orm";
import { GET } from "@/app/api/hourly-maintainance/route";
import { VILLAGE_STRUCTURE_MONTHLY_COST } from "@/drizzle/constants";
import {
  bounty,
  bountyContribution,
  bountySignup,
  gameSetting,
  userData,
  village,
  villageStructure,
} from "@/drizzle/schema";
import * as dataQueries from "@/queries/data";
import { getUtcMonthKey } from "@/utils/time";
import { insertUsers } from "../../../setup/factories";
import { resetServerModuleStubs, stubCronAuth } from "../../../setup/serverModules";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";
import { pollUntil } from "../../../setup/statements";

const TOKENS = 1_000_000;
const previousHour = new Date(Date.now() - 2 * 3600_000);
const request = () => new Request("https://example.com/api/hourly-maintainance");
const previousMonth = (now = new Date()) =>
  getUtcMonthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1)));

const timer = async () => (await getTestDatabase()).query.gameSetting.findFirst();

const settled = async () => {
  const db = await getTestDatabase();
  const [creator, home] = await Promise.all([
    db.query.userData.findFirst({ where: eq(userData.userId, "creator") }),
    db.query.village.findFirst({ where: eq(village.id, "home") }),
  ]);
  return { money: creator?.money, tokens: home?.tokens };
};

/** Fail only once the guarded effects have landed, so a retry can repeat each of them. */
const failAfterEffects = async () => {
  const expected = { money: 500, tokens: TOKENS - VILLAGE_STRUCTURE_MONTHLY_COST };
  await pollUntil(
    async () => {
      const { money, tokens } = await settled();
      return money === expected.money && tokens === expected.tokens;
    },
    { attempts: 200, intervalMs: 10 },
  );
  throw new Error("analytics down");
};

describeWithDatabase("hourly maintenance claim", () => {
  beforeEach(async () => {
    await resetTables(
      bounty,
      bountyContribution,
      bountySignup,
      gameSetting,
      userData,
      village,
      villageStructure,
    );
    stubCronAuth(() => null);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(Sentry, "captureException").mockReturnValue("test-event");
    vi.spyOn(Sentry, "flush").mockResolvedValue(true);
    await insertUsers([
      { userId: "creator", username: "creator", money: 0 },
      { userId: "target", username: "target" },
    ]);
    const db = await getTestDatabase();
    await db.insert(gameSetting).values({
      id: "timer",
      name: "hourly-maintainance",
      time: previousHour,
      value: 9,
    });
    await db.insert(bounty).values({
      id: "bounty",
      targetUserId: "target",
      creatorUserId: "creator",
      amountRyo: 500,
      originalAmountRyo: 500,
      status: "OPEN",
      createdAt: new Date(Date.now() - 8 * 86400_000),
    });
    await db.insert(bountyContribution).values({
      id: "contribution",
      bountyId: "bounty",
      contributorUserId: "creator",
      amountRyo: 500,
    });
    await db.insert(village).values({
      id: "home",
      name: "Home",
      kageId: "creator",
      type: "VILLAGE",
      tokens: TOKENS,
      structureMaintenanceMonth: previousMonth(),
    });
    await db.insert(villageStructure).values({
      id: "bank",
      name: "Bank",
      route: "/bank",
      image: "",
      villageId: "home",
      level: 1,
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    resetServerModuleStubs();
  });

  it("hands the hour back on failure, and the retry repeats no refund or fee", async () => {
    const analytics = vi
      .spyOn(dataQueries, "deleteVisitorLogForDeleteExpiredVisitorAnalytics")
      .mockImplementation(failAfterEffects as never);

    expect((await GET(request())).status).toBe(500);
    expect(await timer()).toEqual(
      expect.objectContaining({ time: previousHour, value: 0 }),
    );

    analytics.mockRestore();
    expect((await GET(request())).status).toBe(200);
    expect(await settled()).toEqual({
      money: 500,
      tokens: TOKENS - VILLAGE_STRUCTURE_MONTHLY_COST,
    });
    const claimed = await timer();
    expect(claimed?.value).toBe(2);
    expect(claimed?.time.getTime()).toBeGreaterThan(previousHour.getTime());
  });

  it("keeps the hour after a successful run", async () => {
    expect((await GET(request())).status).toBe(200);
    expect(await (await GET(request())).json()).toBe(
      "Wait until the next hour to run this again",
    );
    expect((await timer())?.value).toBe(2);
  });
});
