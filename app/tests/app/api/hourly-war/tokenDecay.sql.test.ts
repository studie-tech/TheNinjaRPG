import { timerClaimFixture } from "../../../setup/gameTimers";
import { afterEach, beforeEach, expect, it, setSystemTime, vi } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { GET } from "@/app/api/hourly-war/route";
import { WAR_DAILY_TOKEN_DECAY_PERCENT_BASE } from "@/drizzle/constants";
import { gameSetting, village, villageStructure, war } from "@/drizzle/schema";
import * as gamesettings from "@/libs/gamesettings";
import { resetServerModuleStubs, stubCronAuth, stubDatabase } from "../../../setup/serverModules";
import { aroundStatements } from "../../../setup/statements";
import { describeWithDatabase, getTestDatabase, resetTables } from "../../../setup/testDatabase";

const now = new Date("2026-10-12T12:00:00.000Z");
const hours = (count: number) => new Date(now.getTime() - count * 3600_000);
const startingTokens = 10_000;
const decay = Math.floor(startingTokens * (WAR_DAILY_TOKEN_DECAY_PERCENT_BASE / 100));

describeWithDatabase("daily war token decay", () => {
  beforeEach(async () => {
    setSystemTime(now);
    await resetTables(gameSetting, village, villageStructure, war);
    stubCronAuth(() => null);
    vi.spyOn(gamesettings, "lockWithHourlyTimer").mockResolvedValue({ ...timerClaimFixture(), isNewHour: true, prevTime: new Date(0), response: Response.json("Ready") });
    vi.spyOn(gamesettings, "lockWithDailyTimer").mockResolvedValue({ ...timerClaimFixture(), isNewDay: true, prevTime: hours(24), response: Response.json(null) });
    const db = await getTestDatabase();
    await db.insert(village).values(["attacker", "defender"].map((id, index) => ({
      id, name: id, sector: 301 + index, kageId: `${id}-kage`, tokens: startingTokens,
    })));
    await db.insert(war).values({
      id: "war", attackerVillageId: "attacker", defenderVillageId: "defender", status: "ACTIVE",
      type: "VILLAGE_WAR", startedAt: hours(26), lastTokenReductionAt: hours(25),
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    resetServerModuleStubs();
    setSystemTime();
  });

  it("keeps tokens earned after the wars were loaded", async () => {
    const db = await getTestDatabase();
    const credit = async () => {
      await db.update(village).set({ tokens: sql`${village.tokens} + 500` }).where(eq(village.id, "attacker"));
    };
    // Credit the attacker just before the decay's war update, after the wars were loaded
    stubDatabase(aroundStatements(db, war, async (run) => {
      await credit();
      return run();
    }, { when: (set) => "lastTokenReductionAt" in set }));
    expect((await GET(new Request("http://localhost/api/hourly-war"))).status).toBe(200);
    const [attacker, defender] = await Promise.all([
      db.query.village.findFirst({ where: eq(village.id, "attacker") }),
      db.query.village.findFirst({ where: eq(village.id, "defender") }),
    ]);
    expect({ attacker: attacker?.tokens, defender: defender?.tokens }).toEqual({
      attacker: startingTokens - decay + 500,
      defender: startingTokens - decay,
    });
  });
});
