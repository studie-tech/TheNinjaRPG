import { timerClaimFixture } from "../../../setup/gameTimers";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { GET } from "@/app/api/shrine-maintenance/route";
import {
  MAP_RESERVED_SECTORS,
  SHRINE_BOOST_BASE_PERC,
  SHRINE_BOOST_COST,
} from "@/drizzle/constants";
import {
  mpvpBattleQueue,
  mpvpBattleUser,
  sector,
  village,
  war,
  warCamp,
} from "@/drizzle/schema";
import * as gamesettings from "@/libs/gamesettings";
import { getCurrentSlotBoundary, getSlotIndex } from "@/utils/time";
import { countBoostingShrines, getShrineBoost } from "@/utils/village";
import { resetServerModuleStubs, stubCronAuth } from "../../../setup/serverModules";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

describeWithDatabase("shrine boost template reserve locks", () => {
  beforeEach(async () => {
    await resetTables(mpvpBattleUser, mpvpBattleQueue, warCamp, war, sector, village);
    stubCronAuth(() => null);
    vi.spyOn(gamesettings, "lockWithMinuteTimer").mockImplementation(async () => ({
      ...timerClaimFixture(),
      isNewMinute: true,
      prevTime: new Date(getCurrentSlotBoundary(new Date()).getTime() - 60_000),
      response: Response.json("Ready"),
    }));
    vi.spyOn(gamesettings, "lockWithDailyTimer").mockResolvedValue({
      ...timerClaimFixture(),
      isNewDay: false,
      prevTime: new Date(),
      prevValue: 0,
      response: Response.json("Already maintained"),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetServerModuleStubs();
  });

  it.each([
    { name: "active reserve lock", lockDays: 7, canActivate: false },
    { name: "expired reserve lock", lockDays: -1, canActivate: true },
    { name: "unlocked shrine", lockDays: 0, canActivate: true },
  ])("only spends tokens on effective boosts with $name", async (fixture) => {
    const db = await getTestDatabase();
    const now = new Date();
    const tokens = SHRINE_BOOST_COST * 3;
    await db.insert(village).values({
      id: "reserve-village",
      name: "Reserve village",
      sector: MAP_RESERVED_SECTORS[0]!,
      kageId: "reserve-kage",
      tokens,
      shrineSettings: {
        unlockedAiIds: [],
        activeBoosts: {},
        activeAiIds: [],
        boostTemplate: [
          {
            boostType: "Training",
            dayOfWeek: now.getUTCDay(),
            slotIndex: getSlotIndex(now.getUTCHours()),
          },
        ],
      },
    });
    await db.insert(sector).values({
      sector: MAP_RESERVED_SECTORS[0]!,
      villageId: "reserve-village",
      shrineLevel: 3,
      boostLockedUntil: fixture.lockDays
        ? new Date(now.getTime() + fixture.lockDays * 86400000)
        : null,
    });

    const result = await GET(new Request("http://localhost/api/shrine-maintenance"));
    expect(result.status).toBe(200);
    expect(await result.text()).toContain(`${fixture.canActivate ? 1 : 0} activated`);
    const [stored, shrines] = await Promise.all([
      db.query.village.findFirst(),
      db.query.sector.findMany(),
    ]);
    expect(stored?.tokens).toBe(tokens - (fixture.canActivate ? SHRINE_BOOST_COST : 0));
    expect(stored?.shrineSettings?.activeBoosts?.Training !== undefined).toBe(
      fixture.canActivate,
    );
    expect(getShrineBoost(countBoostingShrines(shrines), "Training", stored)).toBe(
      fixture.canActivate ? SHRINE_BOOST_BASE_PERC / 100 : 0,
    );
  });
});
