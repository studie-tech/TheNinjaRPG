import { afterEach, beforeEach, expect, it, setSystemTime } from "bun:test";
import { eq } from "drizzle-orm";
import { gameSetting } from "@/drizzle/schema";
import * as gamesettings from "@/libs/gamesettings";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../setup/testDatabase";

const now = new Date("2026-10-21T10:30:10.123Z");
const previous = new Date("2026-09-01T00:00:00.456Z");
const name = "claim-regression";
const locks = [
  gamesettings.lockWithMinuteTimer,
  gamesettings.lockWithHourlyTimer,
  gamesettings.lockWithDailyTimer,
  gamesettings.lockWithWeeklyTimer,
  gamesettings.lockWithMonthlyTimer,
];

describeWithDatabase("periodic timer claims in MySQL", () => {
  beforeEach(async () => {
    setSystemTime(now);
    await resetTables(gameSetting);
    const db = await getTestDatabase();
    await db
      .insert(gameSetting)
      .values({ id: "claim-id", name, time: previous, value: 9 });
  });
  afterEach(() => setSystemTime());

  for (const lock of locks) {
    it(`${lock.name} admits one concurrent owner and releases with millisecond precision`, async () => {
      const db = await getTestDatabase();
      const results = await Promise.all([lock(db, name), lock(db, name)]);
      expect(results.filter((result) => result.isClaimed)).toHaveLength(1);
      const winner = results.find((result) => result.isClaimed)!;
      const loser = results.find((result) => !result.isClaimed)!;
      expect(await loser.release()).toBe(false);
      expect(await winner.release()).toBe(true);
      expect(await db.query.gameSetting.findFirst()).toEqual(
        expect.objectContaining({ time: previous, value: 0 }),
      );
    });
  }

  it("a failed minute worker cannot reset a later minute's marker", async () => {
    const db = await getTestDatabase();
    const first = await gamesettings.lockWithMinuteTimer(db, name);
    const later = new Date(now.getTime() + 60_000);
    setSystemTime(later);
    const second = await gamesettings.lockWithMinuteTimer(db, name);
    expect(second.isClaimed).toBe(true);
    expect(await first.release()).toBe(false);
    expect(await db.query.gameSetting.findFirst()).toEqual(
      expect.objectContaining({ time: later }),
    );
    expect(await second.update(17, later)).toBe(true);
    expect(await db.query.gameSetting.findFirst()).toEqual(
      expect.objectContaining({ time: later, value: 17 }),
    );
  });

  it("the generic timer also admits one concurrent owner", async () => {
    const db = await getTestDatabase();
    await db
      .update(gameSetting)
      .set({ name: "timer-1h" })
      .where(eq(gameSetting.name, name));
    const results = await Promise.all([
      gamesettings.lockWithGameTimer(db, "timer-1h", 60 * 60_000),
      gamesettings.lockWithGameTimer(db, "timer-1h", 60 * 60_000),
    ]);
    expect(results.filter((result) => result === false)).toHaveLength(1);
  });
});
